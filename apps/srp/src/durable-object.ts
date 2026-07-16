import { DurableObject } from 'cloudflare:workers'

import { and, asc, desc, eq, gte, ilike, inArray, lte, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import type { CharacterKillmailBasic } from '@repo/esi'
import { buildPublicEsiUserKey, EsiRateLimitGuard, EsiRateLimitStore } from '@repo/esi-rate-limit'
import { createEveRegionId, createEveTypeId } from '@repo/eve-types'
import {
	buildKillmailItemMetadata,
	collectKillmailItemTypeIds,
	roundToMillion,
	MAX_SRP_LOSS_AGE_DAYS,
} from '@repo/srp'
import { parseJsonResponse } from '@repo/worker-utils'

import { createDb } from './db'
import { buildKillmailDetailFromCachedLoss } from './lib/cached-killmail'
import {
	srpComments,
	srpConfig,
	srpDismissedLosses,
	srpPaymentAlerts,
	srpPolicies,
	srpRequestHistory,
	srpRequests,
} from './db/schema'
import { buildEquippedByType } from './lib/equipment'
import { SrpKillmailEsiClient } from './lib/killmail-esi'
import { computeSrpPayout } from './lib/payout'
import {
	doesRecentLossCacheCoverCutoff,
	mergeRecentLosses,
	isRecentLossRequestable,
	selectRecentKillmailsUntilKnown,
	type RecentLossCacheRecord,
	type RecentLossCacheStorageRecord,
} from './lib/recent-loss-cache'
import {
	DEFAULT_NON_POD_SLOT_CAPACITIES,
	DEFAULT_POD_SLOT_CAPACITIES,
	parseShipSlotCapacitiesFromDogmaAttributes,
} from './lib/ship-slot-capacities'
import { isEquippedSlot } from './lib/slot-flags'
import { formatSrpRequest } from './lib/format-request'

import type { srpRequests as srpRequestsTable } from './db/schema'

type KillmailDataJson = NonNullable<typeof srpRequestsTable.$inferInsert.killmailData>

import type {
	CharacterKillmailData,
	CharacterKillmailUpsertData,
	CharacterLossData,
	CharacterLossItemData,
	EveCharacterData,
} from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { LatestMarketPrice, Markets } from '@repo/markets'
import type {
	AppliedModifier,
	CreateSRPPolicy,
	RecentLossRefreshCharacterFailure,
	RecentLossRefreshCharacterInput,
	RecentLossCacheBackfillResult,
	RecentLossRefreshCharacterResult,
	RecentLossesResponse,
	LossWithSRPStatus,
	RequestStatus,
	Srp,
	SRPCommentResponse,
	SRPConfigResponse,
	SRPPaymentMismatchAlert,
	SRPPolicy,
	SRPPolicyConfig,
	SRPRequestResponse,
	SRPPublicRequestSummaryResponse,
	SRPReviewSubmission,
	SRPStatsResponse,
	SRPValuationPreview,
	UpdateSRPConfig,
} from '@repo/srp'
import type { KillmailDetail, Universe } from '@repo/universe'
import type { Env } from './context'
import { logger } from '@repo/hono-helpers'

const SRP_REQUIRED_KILLMAIL_SCOPES = ['esi-killmails.read_killmails.v1']

function serializeLossItems(items?: KillmailDetail['victim']['items']): CharacterLossItemData[] | undefined {
	if (!items || items.length === 0) return undefined
	return items.map((item) => ({
		flag: item.flag,
		item_type_id: item.item_type_id,
		quantity_destroyed: item.quantity_destroyed,
		quantity_dropped: item.quantity_dropped,
		items: serializeLossItems(item.items),
	}))
}

type HydratedRecentLoss = {
	loss: CharacterLossData
	killmailData: KillmailDetail & { killmail_hash?: string }
}

/**
 * SRP Durable Object
 *
 * Manages the Ship Replacement Program database and business logic.
 * Uses PostgreSQL for persistent storage.
 */
export class SrpDO extends DurableObject<Env> implements Srp {
	private static readonly MS_PER_DAY = 86_400_000
	private static readonly REVIEW_QUEUE_COUNT_CACHE_TTL_MS = 60_000
	private static readonly RECENT_LOSS_CACHE_KEY_PREFIX = 'recent-losses:'
	private static readonly RECENT_LOSS_DETAIL_CONCURRENCY = 5
	private db: ReturnType<typeof createDb>
	private readonly storage: DurableObjectStorage
	private readonly esiRateLimits: EsiRateLimitGuard
	private readonly killmailEsi: SrpKillmailEsiClient
	private readonly shipSlotCapacityCache = new Map<
		string,
		{
			value: typeof DEFAULT_NON_POD_SLOT_CAPACITIES
			expiresAt: number
		}
	>()
	private readonly reviewQueueCountCache = new Map<
		string,
		{
			value: number
			expiresAt: number
		}
	>()

	constructor(state: DurableObjectState, env: Env) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
		this.storage = state.storage
		this.esiRateLimits = new EsiRateLimitGuard(new EsiRateLimitStore(env.ESI_RATE_LIMITS))
		this.killmailEsi = new SrpKillmailEsiClient(env)
	}

	private clearReviewQueueCountCache(): void {
		this.reviewQueueCountCache.clear()
	}

	private buildReviewQueueCountCacheKey(input: {
		status: RequestStatus
		characterName?: string
		shipTypeName?: string
		solarSystemName?: string
		dateFrom?: string
		dateTo?: string
	}): string {
		return JSON.stringify({
			status: input.status,
			characterName: input.characterName ?? '',
			shipTypeName: input.shipTypeName ?? '',
			solarSystemName: input.solarSystemName ?? '',
			dateFrom: input.dateFrom ?? '',
			dateTo: input.dateTo ?? '',
		})
	}

	private convertKillmailDetailToLoss(killmail: KillmailDetail & { killmail_hash?: string }): CharacterLossData | null {
		if (!killmail.killmail_hash) return null
		const victimCharacterId = killmail.victim.character_id
		if (!victimCharacterId) return null

		return {
			killmailId: String(killmail.killmail_id),
			killmailHash: killmail.killmail_hash,
			killmailTime: new Date(killmail.killmail_time),
			shipTypeId: killmail.victim.ship_type_id,
			totalValue: '0',
			solarSystemId: killmail.solar_system_id,
			victimCharacterId,
			victimItems: serializeLossItems(killmail.victim.items),
		}
	}

	private buildRecentLossCacheKey(characterId: string): string {
		return `${SrpDO.RECENT_LOSS_CACHE_KEY_PREFIX}${characterId}`
	}

	private async readRecentLossCache(characterId: string): Promise<RecentLossCacheRecord | null> {
		const record = await this.storage.get<RecentLossCacheStorageRecord>(this.buildRecentLossCacheKey(characterId))
		if (!record || !Array.isArray(record.losses)) {
			return null
		}
		return {
			losses: record.losses.map((loss) => ({
				...loss,
				killmailTime: new Date(loss.killmailTime),
			})),
			refreshedAtMs: record.refreshedAtMs,
			complete: record.complete === true,
			maxLossAgeDays: record.maxLossAgeDays,
		}
	}

	private async getCharacterDataInstance(characterId: string) {
		const charStub = getStub<EveCharacterData>(this.env.EVE_CHARACTER_DATA, characterId)
		return await charStub.getInstance(characterId)
	}

	private async readStoredKillmail(
		characterId: string,
		killmailId: string,
		killmailHash: string
	): Promise<CharacterKillmailData | null> {
		const charInstance = await this.getCharacterDataInstance(characterId)
		return await charInstance.getCharacterKillmail(killmailId, killmailHash).catch(() => null)
	}

	private async readMostRecentLoss(characterId: string): Promise<CharacterKillmailData | null> {
		const charInstance = await this.getCharacterDataInstance(characterId)
		return await charInstance.getMostRecentLoss().catch(() => null)
	}

	private async persistRecentLossesToCharacterData(
		characterId: string,
		hydratedLosses: HydratedRecentLoss[],
		cutoffMs?: number
	): Promise<void> {
		const persistable = [...hydratedLosses]
			.filter((entry) =>
				typeof cutoffMs === 'number'
					? new Date(entry.loss.killmailTime).getTime() >= cutoffMs
					: true
			)
			.sort((a, b) => new Date(b.loss.killmailTime).getTime() - new Date(a.loss.killmailTime).getTime())

		if (persistable.length === 0) return

		const charInstance = await this.getCharacterDataInstance(characterId)
		await charInstance.upsertCharacterKillmails(
			persistable.map((entry) => ({
				killmailId: entry.loss.killmailId,
				killmailHash: entry.loss.killmailHash,
				killmailTime: entry.loss.killmailTime,
				isLoss: true,
				shipTypeId: entry.loss.shipTypeId,
				totalValue: entry.loss.totalValue,
				solarSystemId: entry.loss.solarSystemId,
				victimCharacterId: entry.loss.victimCharacterId,
				killmailData: entry.killmailData,
			}))
		)
	}

	private async selfHealRequestItemMetadata(request: any): Promise<void> {
		const itemPrices: Array<{ typeId?: string; typeName?: string | null; [key: string]: unknown }> =
			Array.isArray(request?.srpItemPrices) ? request.srpItemPrices : []
		const killmailItems = Array.isArray((request?.killmailData as any)?.victim?.items)
			? ((request.killmailData as any)?.victim?.items as Array<{
					item_type_id?: number | string
					type_id?: number | string
					typeId?: number | string
					items?: Array<any>
			  }>)
			: []
		if (itemPrices.length === 0 && killmailItems.length === 0) return
		if (!request?.id) return

		const existingKillmailItemNames = (request.killmailItemNames ?? {}) as Record<string, string>
		const existingKillmailItemGroupIds = (request.killmailItemGroupIds ?? {}) as Record<string, string>
		const missingPriceTypeIds = itemPrices
			.filter((item) => Boolean(item.typeId) && (!item.typeName || item.typeName === item.typeId))
			.map((item) => String(item.typeId))
			.filter((typeId): typeId is string => Boolean(typeId))
		const killmailTypeIds = collectKillmailItemTypeIds(killmailItems)
		const missingKillmailTypeIds = killmailTypeIds.filter(
			(typeId) => !existingKillmailItemNames[typeId] || !existingKillmailItemGroupIds[typeId]
		)
		const typeIds = [...new Set([...missingPriceTypeIds, ...missingKillmailTypeIds])]
		if (typeIds.length === 0) return

		const universeStub = getStub<Universe>(this.env.UNIVERSE, 'default')
		const typeMap = await universeStub
			.resolveTypeNamesByIds(typeIds)
			.catch(() => ({}) as Record<string, null>)
		const resolvedNames = new Map<string, string>()
		for (const [typeId, type] of Object.entries(typeMap)) {
			if (type?.typeName && type.typeName !== typeId) {
				resolvedNames.set(typeId, type.typeName)
			}
		}

		let changed = false
		const nextItemPrices = itemPrices.map((item: { typeId?: string; typeName?: string | null }) => {
			const typeId = item?.typeId ? String(item.typeId) : ''
			const resolvedName = typeId ? resolvedNames.get(typeId) : undefined
			if (!resolvedName || item.typeName === resolvedName) return item
			changed = true
			return {
				...item,
				typeName: resolvedName,
			}
		})

		const resolvedKillmailItemMetadata =
			missingKillmailTypeIds.length > 0
				? buildKillmailItemMetadata(
						killmailItems,
						typeMap as Record<string, { typeName?: string | null; groupId?: string | null }>
					)
				: null
		const nextKillmailItemNames = resolvedKillmailItemMetadata
			? {
					...existingKillmailItemNames,
					...resolvedKillmailItemMetadata.killmailItemNames,
				}
			: existingKillmailItemNames
		const nextKillmailItemGroupIds = resolvedKillmailItemMetadata
			? {
					...existingKillmailItemGroupIds,
					...resolvedKillmailItemMetadata.killmailItemGroupIds,
				}
			: existingKillmailItemGroupIds
		const isSameStringMap = (left?: Record<string, string> | null, right?: Record<string, string>) => {
			const leftEntries = Object.entries(left ?? {})
			const rightEntries = Object.entries(right ?? {})
			if (leftEntries.length !== rightEntries.length) return false
			for (const [key, value] of rightEntries) {
				if (left?.[key] !== value) return false
			}
			return true
		}

		if (
			!isSameStringMap(request.killmailItemNames, nextKillmailItemNames) ||
			!isSameStringMap(request.killmailItemGroupIds, nextKillmailItemGroupIds)
		) {
			changed = true
		}

		if (!changed) return

		await this.db
			.update(srpRequests)
			.set({
				srpItemPrices: nextItemPrices as any,
				killmailItemNames:
					Object.keys(nextKillmailItemNames).length > 0 ? (nextKillmailItemNames as any) : null,
				killmailItemGroupIds:
					Object.keys(nextKillmailItemGroupIds).length > 0 ? (nextKillmailItemGroupIds as any) : null,
				updatedAt: new Date(),
			})
			.where(eq(srpRequests.id, request.id))

		request.srpItemPrices = nextItemPrices
		request.killmailItemNames = nextKillmailItemNames
		request.killmailItemGroupIds = nextKillmailItemGroupIds
	}

	private async fetchRecentLossesFromEsi(
		characterId: string,
		knownKillmailIds: ReadonlySet<string>
	): Promise<HydratedRecentLoss[]> {
		const losses: HydratedRecentLoss[] = []
		let page = 1
		let totalPages = 1

		while (page <= totalPages) {
			const pageResult = await this.killmailEsi.fetchCharacterKillmailPage(characterId, page)
			totalPages = Math.max(1, pageResult.pages)
			const selection = selectRecentKillmailsUntilKnown(pageResult.data, knownKillmailIds)
			const pageLosses = await this.fetchLossDetailsForKillmails(characterId, selection.killmails)
			losses.push(...pageLosses)
			if (selection.reachedKnownKillmail) break
			page += 1
		}

		return losses
	}

	private async findCachedRecentLoss(
		characterId: string,
		killmailId: string,
		killmailHash: string
	): Promise<CharacterLossData | null> {
		const cached = await this.readRecentLossCache(characterId)
		if (!cached?.losses?.length) {
			return null
		}

		return (
			cached.losses.find(
				(loss) => loss.killmailId === killmailId && loss.killmailHash === killmailHash
			) ?? null
		)
	}

	private flattenVictimItemsForPreview(
		items: Array<{
			item_type_id?: number | string
			flag?: number
			quantity_destroyed?: number
			quantity_dropped?: number
			items?: Array<any>
		}>,
		inheritedFlag?: number
	): Array<{
		typeId: string
		flag: number
		quantityDestroyed: number
		quantityDropped: number
	}> {
		const flattened: Array<{
			typeId: string
			flag: number
			quantityDestroyed: number
			quantityDropped: number
		}> = []

		for (const item of items) {
			const itemTypeId = item.item_type_id
			const flag = item.flag
			if (itemTypeId != null && flag != null) {
				const displayFlag = inheritedFlag ?? flag
				flattened.push({
					typeId: String(itemTypeId),
					flag: displayFlag,
					quantityDestroyed: item.quantity_destroyed ?? 0,
					quantityDropped: item.quantity_dropped ?? 0,
				})

				if (item.items?.length) {
					flattened.push(...this.flattenVictimItemsForPreview(item.items, displayFlag))
				}
				continue
			}

			if (item.items?.length) {
				flattened.push(...this.flattenVictimItemsForPreview(item.items, inheritedFlag))
			}
		}

		return flattened
	}

	private collectVictimItemTypeIds(
		items: Array<{
			item_type_id?: number | string
			items?: Array<any>
		}>
	): string[] {
		const typeIds = new Set<string>()

		const walk = (rows: Array<{ item_type_id?: number | string; items?: Array<any> }>) => {
			for (const row of rows) {
				if (row.item_type_id != null) {
					typeIds.add(String(row.item_type_id))
				}
				if (row.items?.length) {
					walk(row.items)
				}
			}
		}

		walk(items)
		return [...typeIds]
	}

	private async fetchLossDetailsForKillmails(
		characterId: string,
		killmails: CharacterKillmailBasic[]
	): Promise<HydratedRecentLoss[]> {
		if (killmails.length === 0) {
			return []
		}

		const losses: HydratedRecentLoss[] = []
		const concurrency = Math.min(
			SrpDO.RECENT_LOSS_DETAIL_CONCURRENCY,
			killmails.length
		)
		let nextIndex = 0

		const worker = async () => {
			while (nextIndex < killmails.length) {
				const currentIndex = nextIndex++
				const killmail = killmails[currentIndex]
				const detail = await this.killmailEsi.fetchCharacterKillmailDetail(
					characterId,
					String(killmail.killmail_id),
					killmail.killmail_hash
				)
				if (!detail || detail.victim.character_id !== characterId) {
					continue
				}
				const loss = this.convertKillmailDetailToLoss({
					...detail,
					killmail_hash: killmail.killmail_hash,
				})
				if (!loss) {
					continue
				}
				losses[currentIndex] = {
					loss,
					killmailData: {
						...detail,
						killmail_hash: killmail.killmail_hash,
					},
				}
			}
		}

		await Promise.all(Array.from({ length: concurrency }, () => worker()))
		return losses.filter((loss): loss is HydratedRecentLoss => Boolean(loss))
	}

	/**
	 * Create a new SRP request
	 */
	async createRequest(
		userId: string,
		characterId: string,
		killmailId: string,
		killmailHash: string,
		contextText: string
	): Promise<SRPRequestResponse> {
		const normalizedKillmailId = killmailId.trim()
		if (!/^\d+$/.test(normalizedKillmailId)) {
			throw new Error('Invalid killmail id')
		}

		// Check if request already exists for this killmail
		const existing = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, normalizedKillmailId),
		})

		if (existing) {
			if (existing.requestStatus !== 'withdrawn') {
				throw new Error('SRP request already exists for this killmail')
			}
			if (existing.userId !== userId) {
				throw new Error('SRP request already exists for this killmail')
			}

			const reactivated = await this.db
				.update(srpRequests)
				.set({
					requestStatus: 'pending',
					contextText,
					killmailHash,
					approvedAmount: null,
					reviewerId: null,
					reviewerCharacterName: null,
					reviewedAt: null,
					reviewNotes: null,
					appliedModifierPolicyId: null,
					appliedModifierPolicyName: null,
					appliedCapPolicyId: null,
					appliedCapPolicyName: null,
					appliedModifiers: null,
					reviewerOverrideMillions: null,
					paymentDate: null,
					paymentCharacterName: null,
					paymentScanCursorDate: null,
					updatedAt: new Date(),
				})
				.where(eq(srpRequests.id, normalizedKillmailId))
				.returning()
			this.clearReviewQueueCountCache()

			await this.logHistory(
				existing.id,
				userId,
				(existing.characterName ?? 'Unknown') as string,
				'request_reopened',
				{
					previousRequestStatus: existing.requestStatus,
					newRequestStatus: 'pending',
				},
				'public'
			)

			return await this.formatRequestWithShipSlotCapacities(reactivated[0])
		}

		const charInstance = await this.getCharacterDataInstance(characterId)
		const storedKillmail = await this.readStoredKillmail(
			characterId,
			normalizedKillmailId,
			killmailHash
		)

		let killmailData: KillmailDataJson | null = storedKillmail?.killmailData
			? (storedKillmail.killmailData as KillmailDataJson)
			: null

		if (!killmailData) {
			const cachedLoss = await this.findCachedRecentLoss(
				characterId,
				normalizedKillmailId,
				killmailHash
			)
			if (cachedLoss) {
				killmailData = buildKillmailDetailFromCachedLoss(
					characterId,
					normalizedKillmailId,
					killmailHash,
					cachedLoss
				) as KillmailDataJson
				void charInstance.upsertCharacterKillmails([
					{
						killmailId: normalizedKillmailId,
						killmailHash,
						killmailTime: cachedLoss.killmailTime,
						isLoss: true,
						shipTypeId: cachedLoss.shipTypeId,
						totalValue: cachedLoss.totalValue,
						solarSystemId: cachedLoss.solarSystemId,
						victimCharacterId: cachedLoss.victimCharacterId,
						killmailData,
					},
				]).catch((error) => {
					logger.warn('[createRequest] Failed to backfill cached killmail into character data', {
						characterId,
						killmailId: normalizedKillmailId,
						error: error instanceof Error ? error.message : String(error),
					})
				})
			}
		}

		if (!killmailData || String((killmailData as any).victim?.character_id) !== characterId) {
			throw new Error('Killmail not found or is not a loss')
		}

		// Get character info
		const characterInfo = await charInstance.getCharacterInfo()
		if (!characterInfo) {
			throw new Error('Character not found')
		}

		// Resolve corporation name from eve-corporation-data
		const corpId = characterInfo.corporationId
		const corpStub = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, String(corpId))
		const corpInfo = await corpStub.getCorporationInfo(String(corpId)).catch(() => null)
		const resolvedCorporationName = corpInfo?.name ?? 'Unknown'

		const solarSystemId = killmailData.solar_system_id ? String(killmailData.solar_system_id) : null

		const victim = killmailData.victim as any
		const universeStub = getStub<Universe>(this.env.UNIVERSE, 'default')
		const killmailItemTypeIds = collectKillmailItemTypeIds((victim.items ?? []) as Array<{
			item_type_id?: number | string
			type_id?: number | string
			typeId?: number | string
			items?: Array<any>
		}>)
		const [typeMap, systemMap] = await Promise.all([
			universeStub
				.resolveTypeNamesByIds(
					[...new Set([String(victim.ship_type_id), ...killmailItemTypeIds])]
				)
				.catch(() => ({}) as Record<string, null>),
			solarSystemId
				? universeStub
						.resolveSolarSystemsByIds([solarSystemId])
						.catch(() => ({}) as Record<string, null>)
				: Promise.resolve({} as Record<string, null>),
		])
		const shipTypeName =
			typeMap[String(victim.ship_type_id)]?.typeName ?? `Ship ${victim.ship_type_id}`
		const { killmailItemNames, killmailItemGroupIds } = buildKillmailItemMetadata(
			(victim.items ?? []) as Array<{
				item_type_id?: number | string
				type_id?: number | string
				typeId?: number | string
				items?: Array<any>
			}>,
			typeMap as Record<string, { typeName?: string | null; groupId?: string | null }>
		)
		const solarSystemName = solarSystemId
			? (systemMap[solarSystemId]?.solarSystemName ?? null)
			: null

		// Calculate SRP valuation from Jita prices at time of loss
		const killmailTime = killmailData.killmail_time
		if (typeof killmailTime !== 'string') {
			throw new Error('Killmail time is missing')
		}

		const config = await this.getConfig()
		const lossDate = new Date(killmailTime)
		const maxLossAgeDays = config?.maxLossAgeDays ?? 30
		const maxLossAgeMs = maxLossAgeDays * SrpDO.MS_PER_DAY
		if (Date.now() - lossDate.getTime() > maxLossAgeMs) {
			throw new Error(`Loss is older than the maximum allowed age of ${maxLossAgeDays} days`)
		}
		let valuation: Awaited<ReturnType<typeof this.calculateSrpValuation>> = null
		try {
			valuation = await this.calculateSrpValuation(killmailData as any, lossDate, String(victim.ship_type_id), config)
		} catch (err) {
			// Non-fatal — request is still created, valuation fields will be null
			logger.error('[createRequest] SRP valuation failed:', err)
		}

		// Create the request
		const result = await this.db
			.insert(srpRequests)
			.values({
				id: normalizedKillmailId,
				userId,
				characterId,
				characterName: characterInfo.name,
				corporationId: characterInfo.corporationId,
				corporationName: resolvedCorporationName,
				killmailHash,
				shipTypeId: victim.ship_type_id,
				shipTypeName,
				shipValue: valuation?.finalValue ?? valuation?.calculatedValue ?? '0',
				solarSystemId,
				solarSystemName,
				contextText,
				lossDate,
				killmailData: killmailData as any,
				killmailItemNames: Object.keys(killmailItemNames).length > 0 ? killmailItemNames : null,
				killmailItemGroupIds:
					Object.keys(killmailItemGroupIds).length > 0 ? killmailItemGroupIds : null,
				srpEquipmentValue: valuation?.equipmentValue ?? null,
				srpInsurancePremium: valuation?.insurancePremium ?? null,
				srpInsurancePayout: valuation?.insurancePayout ?? null,
				srpNetInsurance: valuation?.netInsurance ?? null,
				srpCalculatedValue: valuation?.calculatedValue ?? null,
				srpFinalValue: valuation?.finalValue ?? null,
				srpPriceSnapshotTime: valuation?.priceSnapshotTime ?? null,
				srpItemPrices: valuation?.itemPrices ?? null,
			})
			.returning()
		this.clearReviewQueueCountCache()

		const request = result[0]

		// Log history
		await this.logHistory(
			request.id,
			userId,
			characterInfo.name,
			'request_created',
			{ previousRequestStatus: null, newRequestStatus: 'pending' },
			'public'
		)

		return await this.formatRequestWithShipSlotCapacities(request)
	}

	/**
	 * Preview the SRP valuation for a killmail without creating a request.
	 * Returns null if the killmail has no equipped items (nothing to price).
	 */
	async previewValuation(
		characterId: string,
		killmailId: string,
		killmailHash: string
	): Promise<SRPValuationPreview | null> {
		const storedKillmail = await this.readStoredKillmail(characterId, killmailId, killmailHash)
		let killmailData: any = storedKillmail?.killmailData ?? null
		if (!killmailData) {
			const cachedLoss = await this.findCachedRecentLoss(characterId, killmailId, killmailHash)
			const cachedVictimItems = cachedLoss?.victimItems ?? []
			const canUseCachedLoss = cachedLoss !== null && cachedVictimItems.length > 0

			killmailData = canUseCachedLoss
				? ({
						killmail_time: cachedLoss.killmailTime.toISOString(),
						solar_system_id: Number(cachedLoss.solarSystemId),
						victim: {
							character_id: Number(characterId),
							ship_type_id: Number(cachedLoss.shipTypeId),
							items: cachedVictimItems as any,
						},
					} as any)
				: await this.killmailEsi.fetchCharacterKillmailDetail(
						characterId,
						killmailId,
						killmailHash
					)
		}

		const victim = killmailData.victim as any
		const killmailTime = killmailData.killmail_time as string | undefined
		if (!killmailData || !victim || !killmailTime || String(victim.character_id) !== characterId) {
			throw new Error('Killmail not found or is not a loss')
		}

		const config = await this.getConfig()
		const lossDate = new Date(killmailTime as string)
		const valuation = await this.calculateSrpValuation(
			killmailData as any,
			lossDate,
			String(victim.ship_type_id),
			config
		)

		if (!valuation) return null

		// Identify which type IDs had no market data (priced at 0)
		const missingPriceTypeIds = valuation.itemPrices
			.filter((item) => item.unitPrice === '0')
			.map((item) => item.typeId)

		const rawItems = victim.items ?? []
		const victimItems = this.flattenVictimItemsForPreview(rawItems)

		const allTypeIds = [
			...new Set([
				String(victim.ship_type_id),
				...this.collectVictimItemTypeIds(rawItems),
			]),
		]
		const universeStub = getStub<Universe>(this.env.UNIVERSE, 'default')
		const typeMap = await universeStub.resolveTypeNamesByIds(allTypeIds).catch(() => ({}) as Record<string, null>)
		const itemNames: Record<string, string> = {}
		for (const [id, type] of Object.entries(typeMap)) {
			if (type?.typeName) itemNames[id] = type.typeName
		}

		return {
			equipmentValue: valuation.equipmentValue,
			insurancePremium: valuation.insurancePremium,
			insurancePayout: valuation.insurancePayout,
			netInsurance: valuation.netInsurance,
			calculatedValue: valuation.calculatedValue,
			finalValue: valuation.finalValue,
			priceSnapshotTime: valuation.priceSnapshotTime?.toISOString() ?? null,
			pricingSource: valuation.pricingSource,
			insuranceSource: valuation.insuranceSource,
			itemPrices: valuation.itemPrices,
			victimItems,
			itemNames,
			missingPriceTypeIds,
		}
	}

	/**
	 * Get a single SRP request
	 */
	async getRequest(requestId: string, userId: string): Promise<SRPRequestResponse | null> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
				with: {
					comments: {
						orderBy: asc(srpComments.createdAt),
					},
					history: {
						orderBy: asc(srpRequestHistory.timestamp),
						limit: 50,
					},
				},
		})

		if (!request) return null

		// Check if user has access (owner, reviewer, or admin handled by core worker)
		if (request.userId !== userId) {
			// Only return public comments if not the owner
			request.comments = request.comments?.filter((c) => c.visibility === 'public')
		}

		return await this.formatRequestWithShipSlotCapacities(request)
	}

	/**
	 * Get a public summary for a single SRP request without exposing review details.
	 */
	async getPublicRequestSummary(
		requestId: string
	): Promise<SRPPublicRequestSummaryResponse | null> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
			columns: {
				id: true,
				userId: true,
				shipTypeId: true,
				shipTypeName: true,
				requestStatus: true,
				approvedAmount: true,
			},
		})

		if (!request) return null

		return {
			killmailId: request.id,
			userId: request.userId,
			shipTypeId: request.shipTypeId,
			shipTypeName: request.shipTypeName,
			requestStatus: request.requestStatus,
			approvedAmount: request.approvedAmount ?? null,
		}
	}

	/**
	 * Get all requests for a user
	 */
	async getUserRequests(userId: string, limit = 50, offset = 0): Promise<SRPRequestResponse[]> {
		const requests = await this.db.query.srpRequests.findMany({
			where: eq(srpRequests.userId, userId),
			orderBy: desc(srpRequests.createdAt),
			limit,
			offset,
		})

		return await Promise.all(requests.map((r) => this.formatRequest(r)))
	}

	// private async getLossesForCharacter(
	// 	characterId: string,
	// 	daysBack = 30,
	// 	excludeNonSrpEligible = true
	// ): Promise<LossWithSRPStatus[]> {
	// 	const esiInstance = getEsiInstanceForCharacter(this.env.ESI, characterId)
	// }

	/**
	 * Get recent losses for multiple characters with SRP status
	 */
	async getRecentLosses(
		characters: RecentLossRefreshCharacterInput[],
		userId: string,
		daysBack = 30,
		_excludeNonSrpEligible = true
	): Promise<RecentLossesResponse> {
		const config = await this.getConfig()
		const maxLossAgeDays = config?.maxLossAgeDays ?? daysBack
		const effectiveDaysBack = Math.max(1, Math.min(daysBack, maxLossAgeDays))
		const cutoffMs = Date.now() - effectiveDaysBack * SrpDO.MS_PER_DAY
		const cacheCutoffMs = Date.now() - maxLossAgeDays * SrpDO.MS_PER_DAY
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const universeStub = getStub<Universe>(this.env.UNIVERSE, 'default')
		const allLosses = new Map<string, CharacterLossData>()
		const failedCharacters: RecentLossRefreshCharacterFailure[] = []

		for (const character of characters) {
			const charInstance = await this.getCharacterDataInstance(character.characterId)
			const storedLosses = await charInstance.getRecentLosses(
				1000,
				new Date(cutoffMs)
			).catch(() => [])
			const cached = await this.readRecentLossCache(character.characterId)
			const mergedCharacterLosses = mergeRecentLosses(
				storedLosses,
				cached?.losses ?? [],
				cutoffMs
			)

			if (mergedCharacterLosses.length === 0) {
				const tokenValidation = await tokenStore.validateToken(
					character.characterId,
					SRP_REQUIRED_KILLMAIL_SCOPES
				)
				if (!tokenValidation.isValid) {
					failedCharacters.push({
						characterId: character.characterId,
						characterName: character.characterName,
						reason: 'invalid_token',
						message: 'ESI token is invalid or expired. Please re-authenticate this character.',
					})
				} else {
					failedCharacters.push({
						characterId: character.characterId,
						characterName: character.characterName,
						reason: 'cache_missing',
						message: 'Recent losses have not been refreshed yet. Use Refresh to fetch them.',
					})
				}
				continue
			}

			if (
				(cached?.losses?.length ?? 0) > 0 &&
				!doesRecentLossCacheCoverCutoff(cached, cacheCutoffMs, maxLossAgeDays)
			) {
				failedCharacters.push({
					characterId: character.characterId,
					characterName: character.characterName,
					reason: 'cache_incomplete',
					message:
						'Cached recent losses do not reach the current lookback window. Use Refresh to backfill older losses.',
				})
			}

			for (const loss of mergedCharacterLosses) {
				if (_excludeNonSrpEligible && !isRecentLossRequestable(loss)) {
					continue
				}
				allLosses.set(loss.killmailId, loss)
			}
		}

		const mergedLosses = [...allLosses.values()]
			.filter((loss) => new Date(loss.killmailTime).getTime() >= cutoffMs)
			.sort((a, b) => new Date(b.killmailTime).getTime() - new Date(a.killmailTime).getTime())

		const shipTypeIds = [...new Set(mergedLosses.map((l) => String(l.shipTypeId)))]
		const systemIds = [...new Set(mergedLosses.map((l) => String(l.solarSystemId)))]

		const [typeMap, systemMap, typeMetaMap] = await Promise.all([
			universeStub.resolveTypeNamesByIds(shipTypeIds),
			universeStub.resolveSolarSystemsByIds(systemIds),
			universeStub
				.resolveTypeMetadataByIds(shipTypeIds)
				.catch(
					() =>
						({}) as Record<
							string,
							{ categoryName: string; marketGroupId: string | null; marketGroupName: string | null }
						>
				),
		])

		const resolved: Record<string, string | undefined> = {}
		for (const [id, type] of Object.entries(typeMap)) {
			if (type?.typeName) resolved[id] = type.typeName
		}
		for (const [id, system] of Object.entries(systemMap)) {
			if (system?.solarSystemName) resolved[id] = system.solarSystemName
		}
		// Get existing SRP requests for these losses
		const killmailIds = mergedLosses.map((l) => String(l.killmailId))

		if (killmailIds.length === 0) {
			return {
				losses: [],
				failedCharacters,
			}
		}

		const existingRequests = await this.db.query.srpRequests.findMany({
			where: and(eq(srpRequests.userId, userId), inArray(srpRequests.id, killmailIds)),
		})
		const dismissedLosses = await this.db.query.srpDismissedLosses.findMany({
			where: and(eq(srpDismissedLosses.userId, userId), inArray(srpDismissedLosses.killmailId, killmailIds)),
			columns: { killmailId: true },
		})
		const dismissedKillmailIds = new Set(dismissedLosses.map((row) => row.killmailId))

		const requestMap = new Map(
			existingRequests.map((r) => [r.id, { id: r.id, status: r.requestStatus }])
		)
		const legacyPaidKillmailIds = new Set<string>()
		const paymentProcessorCorporationId = config?.paymentProcessorCorporationId?.trim()
		if (paymentProcessorCorporationId) {
			const oldestLossTimeMs = mergedLosses.reduce((oldest, loss) => {
				const lossMs = new Date(loss.killmailTime).getTime()
				if (!Number.isFinite(lossMs)) return oldest
				return Math.min(oldest, lossMs)
			}, Number.POSITIVE_INFINITY)
			const fromDate = Number.isFinite(oldestLossTimeMs)
				? new Date(oldestLossTimeMs)
				: new Date(cutoffMs)

			const legacyRows = await this.db.execute<{ reason: string | null }>(
				sql`select reason
					from corporation_wallet_journal
					where corporation_id = ${paymentProcessorCorporationId}
						and date >= ${fromDate}
						and reason is not null
						and reason like 'Payment for %'
					order by date desc
					limit 10000`
			)

			const killmailIdSet = new Set(killmailIds)
			for (const row of legacyRows.rows ?? []) {
				const legacyKillmailId = this.extractLegacyPaidKillmailId(row.reason)
				if (!legacyKillmailId) continue
				if (!killmailIdSet.has(legacyKillmailId)) continue
				legacyPaidKillmailIds.add(legacyKillmailId)
			}
		}

		// Annotate losses with SRP status and sort by time descending
		return {
			losses: mergedLosses
				.filter((loss) => !dismissedKillmailIds.has(String(loss.killmailId)))
				.filter((loss) => !legacyPaidKillmailIds.has(String(loss.killmailId)))
				.filter((loss) => {
					const shipTypeId = String(loss.shipTypeId)
					const marketGroupId = typeMetaMap[shipTypeId]?.marketGroupId ?? null
					const shipTypeName = resolved[shipTypeId] ?? ''
					const looksLikeShuttleByName = shipTypeName.toLowerCase().includes('shuttle')
					return !(this.isShuttleMarketGroupId(marketGroupId) || looksLikeShuttleByName)
				})
				.map((loss) => {
					const lossKillmailId = String(loss.killmailId)
					const request = requestMap.get(lossKillmailId)
					return {
						killmailId: lossKillmailId,
						killmailHash: loss.killmailHash ?? '',
						killmailTime: new Date(loss.killmailTime).toISOString(),
						shipTypeId: loss.shipTypeId,
						shipTypeName: resolved[String(loss.shipTypeId)],
						totalValue: loss.totalValue ?? '0',
						solarSystemId: loss.solarSystemId,
						solarSystemName: resolved[String(loss.solarSystemId)],
						victimCharacterId: String(loss.victimCharacterId ?? ''),
						victimItems: loss.victimItems,
						hasSRPRequest: !!request,
						srpRequestId: request?.id,
						srpRequestStatus: request?.status,
					}
				})
				.sort((a, b) => new Date(b.killmailTime).getTime() - new Date(a.killmailTime).getTime()),
			failedCharacters,
		}
	}

	async dismissLoss(userId: string, killmailId: string): Promise<void> {
		const normalizedKillmailId = killmailId.trim()
		if (!/^\d+$/.test(normalizedKillmailId)) {
			throw new Error('Invalid killmail id')
		}

		await this.db
			.insert(srpDismissedLosses)
			.values({
				userId,
				killmailId: normalizedKillmailId,
			})
			.onConflictDoNothing({
				target: [srpDismissedLosses.userId, srpDismissedLosses.killmailId],
			})
	}

	async refreshRecentLossesForCharacter(
		_userId: string,
		characterId: string,
		_characterName: string,
		maxLossAgeDays: number
	): Promise<RecentLossRefreshCharacterResult> {
		const cacheCutoffMs = Date.now() - maxLossAgeDays * SrpDO.MS_PER_DAY
		const mostRecentLoss = await this.readMostRecentLoss(characterId)
		const knownKillmailIds = new Set<string>()
		if (mostRecentLoss) {
			knownKillmailIds.add(mostRecentLoss.killmailId)
		}

		const freshLosses = await this.fetchRecentLossesFromEsi(characterId, knownKillmailIds)
		await this.persistRecentLossesToCharacterData(characterId, freshLosses, cacheCutoffMs)

		return {
			characterId,
			characterName: _characterName,
			success: true,
		}
	}

	async backfillRecentLossesFromCache(characterId: string): Promise<RecentLossCacheBackfillResult> {
		const cached = await this.readRecentLossCache(characterId)
		const cachedLosses = cached?.losses ?? []
		if (cachedLosses.length === 0) {
			return {
				characterId,
				cachedLosses: 0,
				persistedLosses: 0,
			}
		}

		const hydratedLosses = cachedLosses.map((loss) => ({
			loss,
			killmailData: buildKillmailDetailFromCachedLoss(characterId, loss.killmailId, loss.killmailHash, loss),
		}))

		await this.persistRecentLossesToCharacterData(characterId, hydratedLosses)

		return {
			characterId,
			cachedLosses: cachedLosses.length,
			persistedLosses: hydratedLosses.length,
		}
	}

	private extractLegacyPaidKillmailId(reason: string | null | undefined): string | null {
		if (!reason) return null
		const match = reason.match(/\bPayment for (\d+)\b/i)
		if (!match) return null
		return match[1] ?? null
	}

	private isShuttleMarketGroupId(marketGroupId: string | null): boolean {
		if (!marketGroupId) return false
		return this.SHUTTLE_MARKET_GROUP_IDS.has(marketGroupId)
	}

	/**
	 * Get pending requests for review
	 */
	async getPendingRequests(
		corporationId: string,
		limit = 50,
		offset = 0
	): Promise<SRPRequestResponse[]> {
		const requests = await this.db.query.srpRequests.findMany({
			where: and(
				eq(srpRequests.corporationId, corporationId),
				eq(srpRequests.requestStatus, 'pending')
			),
			orderBy: desc(srpRequests.createdAt),
			limit,
			offset,
		})

		return await Promise.all(requests.map((r) => this.formatRequest(r)))
	}

	/**
	 * Approve an SRP request
	 */
	async approveRequest(
		requestId: string,
		reviewerUserId: string,
		approvedAmount: string,
		reviewNotes?: string
	): Promise<SRPRequestResponse> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
		})

		if (!request) throw new Error('Request not found')

		// Get reviewer character name (using their main character)
		// TODO: Get actual reviewer character name from user data

		const updated = await this.db
			.update(srpRequests)
			.set({
				requestStatus: 'approved',
				approvedAmount,
				reviewerId: reviewerUserId,
				reviewerCharacterName: 'Reviewer',
				reviewedAt: new Date(),
				reviewNotes,
				updatedAt: new Date(),
			})
			.where(eq(srpRequests.id, requestId))
			.returning()
		this.clearReviewQueueCountCache()

		await this.logHistory(
			requestId,
			reviewerUserId,
			'Reviewer',
			'request_approved',
			{
				previousRequestStatus: request.requestStatus,
				previousApprovedAmount: request.approvedAmount ?? undefined,
				newRequestStatus: 'approved',
				newApprovedAmount: approvedAmount,
			},
			'public'
		)

		return await this.formatRequestWithShipSlotCapacities(updated[0])
	}

	/**
	 * Partially approve an SRP request (legacy — maps to approved)
	 */
	async partiallyApproveRequest(
		requestId: string,
		reviewerUserId: string,
		approvedAmount: string,
		rejectionReason: string,
		reviewNotes?: string
	): Promise<SRPRequestResponse> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
		})

		if (!request) throw new Error('Request not found')

		const updated = await this.db
			.update(srpRequests)
			.set({
				requestStatus: 'approved',
				approvedAmount,
				reviewerId: reviewerUserId,
				reviewerCharacterName: 'Reviewer',
				reviewedAt: new Date(),
				reviewNotes: reviewNotes ? `${rejectionReason}\n\n${reviewNotes}` : rejectionReason,
				updatedAt: new Date(),
			})
			.where(eq(srpRequests.id, requestId))
			.returning()
		this.clearReviewQueueCountCache()

		await this.logHistory(
			requestId,
			reviewerUserId,
			'Reviewer',
			'request_approved',
			{
				previousRequestStatus: request.requestStatus,
				previousApprovedAmount: request.approvedAmount ?? undefined,
				newRequestStatus: 'approved',
				newApprovedAmount: approvedAmount,
				metadata: { rejectionReason },
			},
			'public'
		)

		return await this.formatRequestWithShipSlotCapacities(updated[0])
	}

	/**
	 * Reject an SRP request
	 */
	async rejectRequest(
		requestId: string,
		reviewerUserId: string,
		rejectionReason: string,
		reviewNotes?: string
	): Promise<SRPRequestResponse> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
		})

		if (!request) throw new Error('Request not found')

		const updated = await this.db
			.update(srpRequests)
			.set({
				requestStatus: 'rejected',
				reviewerId: reviewerUserId,
				reviewerCharacterName: 'Reviewer',
				reviewedAt: new Date(),
				reviewNotes: reviewNotes ? `${rejectionReason}\n\n${reviewNotes}` : rejectionReason,
				updatedAt: new Date(),
			})
			.where(eq(srpRequests.id, requestId))
			.returning()
		this.clearReviewQueueCountCache()

		await this.logHistory(
			requestId,
			reviewerUserId,
			'Reviewer',
			'request_rejected',
			{
				previousRequestStatus: request.requestStatus,
				previousApprovedAmount: request.approvedAmount ?? undefined,
				newRequestStatus: 'rejected',
				metadata: { rejectionReason },
			},
			'public'
		)

		return await this.formatRequestWithShipSlotCapacities(updated[0])
	}

	/**
	 * Get comments for a request
	 */
	async getComments(
		requestId: string,
		userId: string,
		includeInternal: boolean
	): Promise<SRPCommentResponse[]> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
		})

		if (!request) throw new Error('Request not found')

			const comments = await this.db.query.srpComments.findMany({
			where: and(
				eq(srpComments.requestId, requestId),
				includeInternal ? undefined : eq(srpComments.visibility, 'public')
			),
				orderBy: asc(srpComments.createdAt),
			})

		return comments.map((c) => ({
			id: c.id,
			requestId: c.requestId,
			authorUserId: c.authorUserId,
			authorCharacterName: c.authorCharacterName,
			content: c.content,
			visibility: c.visibility,
			isEdited: c.isEdited,
			editedAt: c.editedAt?.toISOString(),
			createdAt: c.createdAt.toISOString(),
		}))
	}

	/**
	 * Add a comment to a request
	 */
	async addComment(
		requestId: string,
		userId: string,
		characterName: string,
		content: string,
		visibility: 'public' | 'internal' = 'public'
	): Promise<SRPCommentResponse> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
		})

		if (!request) throw new Error('Request not found')

		const result = await this.db
			.insert(srpComments)
			.values({
				requestId,
				authorUserId: userId,
				authorCharacterName: characterName,
				content,
				visibility,
			})
			.returning()

		const comment = result[0]

		return {
			id: comment.id,
			requestId: comment.requestId,
			authorUserId: comment.authorUserId,
			authorCharacterName: comment.authorCharacterName,
			content: comment.content,
			visibility: comment.visibility,
			isEdited: comment.isEdited,
			editedAt: comment.editedAt?.toISOString(),
			createdAt: comment.createdAt.toISOString(),
		}
	}

	/**
	 * Edit a comment
	 */
	async editComment(
		commentId: string,
		userId: string,
		content: string
	): Promise<SRPCommentResponse> {
		const comment = await this.db.query.srpComments.findFirst({
			where: eq(srpComments.id, commentId),
		})

		if (!comment) throw new Error('Comment not found')
		if (comment.authorUserId !== userId) throw new Error('Not authorized to edit this comment')

		const updated = await this.db
			.update(srpComments)
			.set({
				content,
				isEdited: true,
				editedAt: new Date(),
				originalContent: comment.originalContent || comment.content,
			})
			.where(eq(srpComments.id, commentId))
			.returning()

		const result = updated[0]

		return {
			id: result.id,
			requestId: result.requestId,
			authorUserId: result.authorUserId,
			authorCharacterName: result.authorCharacterName,
			content: result.content,
			visibility: result.visibility,
			isEdited: result.isEdited,
			editedAt: result.editedAt?.toISOString(),
			createdAt: result.createdAt.toISOString(),
		}
	}

	/**
	 * Delete a comment
	 */
	async deleteComment(commentId: string, userId: string): Promise<void> {
		const comment = await this.db.query.srpComments.findFirst({
			where: eq(srpComments.id, commentId),
		})

		if (!comment) throw new Error('Comment not found')
		if (comment.authorUserId !== userId) throw new Error('Not authorized to delete this comment')

		await this.db.delete(srpComments).where(eq(srpComments.id, commentId))
	}

	/**
	 * Get pending payments
	 */
	async getPendingPayments(
		corporationId?: string,
		limit = 50,
		offset = 0
	): Promise<SRPRequestResponse[]> {
		const requests = await this.db.query.srpRequests.findMany({
			where: and(
				corporationId ? eq(srpRequests.corporationId, corporationId) : undefined,
				eq(srpRequests.requestStatus, 'approved')
			),
			orderBy: [asc(srpRequests.createdAt)],
			limit,
			offset,
		})

		return await Promise.all(requests.map((r) => this.formatRequest(r)))
	}

	async getPendingPayoutTotal(corporationId?: string): Promise<string> {
		const [result] = await this.db
			.select({
				total: sql<string>`coalesce(sum(coalesce(nullif(${srpRequests.approvedAmount}, ''), '0')::numeric), 0)::text`,
			})
			.from(srpRequests)
			.where(
				and(
					corporationId ? eq(srpRequests.corporationId, corporationId) : undefined,
					eq(srpRequests.requestStatus, 'approved')
				)
			)

		return result?.total ?? '0'
	}

	/**
	 * Mark a request as payment pending (moves from 'approved' to 'payment_pending')
	 */
	async markPaid(
		requestId: string,
		payerUserId: string,
		payerCharacterName: string
	): Promise<SRPRequestResponse> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
		})

		if (!request) throw new Error('Request not found')
		if (request.requestStatus !== 'approved') throw new Error('Request is not in approved state')

		const updated = await this.db
			.update(srpRequests)
			.set({
				requestStatus: 'payment_pending',
				paymentDate: new Date(),
				paymentCharacterName: payerCharacterName,
				paymentScanCursorDate: null,
				updatedAt: new Date(),
			})
			.where(eq(srpRequests.id, requestId))
			.returning()

		await this.logHistory(
			requestId,
			payerUserId,
			payerCharacterName,
			'payment_submitted',
			{
				previousRequestStatus: 'approved',
				newRequestStatus: 'payment_pending',
			},
			'public'
		)

		return await this.formatRequestWithShipSlotCapacities(updated[0])
	}

	/**
	 * Get SRP configuration
	 */
	async getConfig(): Promise<SRPConfigResponse | null> {
		const config = await this.db.query.srpConfig.findFirst({
			where: eq(srpConfig.isActive, true),
			orderBy: desc(srpConfig.effectiveFrom),
		})

		if (!config) return null
		const metadata = (config.metadata as Record<string, unknown>) || {}
		const predefinedAdhocModifiers = Array.isArray(metadata.predefinedAdhocModifiers)
			? (metadata.predefinedAdhocModifiers as SRPConfigResponse['predefinedAdhocModifiers'])
			: undefined
		const paymentProcessorCorporationId =
			typeof metadata.paymentProcessorCorporationId === 'string' &&
			metadata.paymentProcessorCorporationId.trim().length > 0
				? metadata.paymentProcessorCorporationId.trim()
				: undefined
		const srpGroupId =
			typeof metadata.srpGroupId === 'string' && metadata.srpGroupId.trim().length > 0
				? metadata.srpGroupId.trim()
				: undefined

		return {
			id: config.id,
			isActive: config.isActive,
			defaultCoverageRate: config.defaultCoverageRate,
			maxPayoutAmount: config.maxPayoutAmount || undefined,
			maxLossAgeDays: Math.min(config.maxLossAgeDays, MAX_SRP_LOSS_AGE_DAYS),
			paymentProcessorCorporationId,
			srpGroupId,
			metadata,
			predefinedAdhocModifiers,
			createdBy: config.createdBy,
			effectiveFrom: config.effectiveFrom.toISOString(),
			effectiveTo: config.effectiveTo?.toISOString(),
			createdAt: config.createdAt.toISOString(),
		}
	}

	/**
	 * Update SRP configuration
	 */
	async updateConfig(
		userId: string,
		updates: UpdateSRPConfig
	): Promise<SRPConfigResponse> {
		// Get current config
		const current = await this.getConfig()

		if (current) {
			// Deactivate current config
			await this.db
				.update(srpConfig)
				.set({ isActive: false, effectiveTo: new Date() })
				.where(eq(srpConfig.id, current.id))
		}

		const mergedMetadata = {
			...((current?.metadata as Record<string, unknown> | undefined) ?? {}),
			...(updates.metadata ?? {}),
		}
		if (updates.predefinedAdhocModifiers !== undefined) {
			mergedMetadata.predefinedAdhocModifiers = updates.predefinedAdhocModifiers
		}
		if (updates.paymentProcessorCorporationId !== undefined) {
			if (updates.paymentProcessorCorporationId && updates.paymentProcessorCorporationId.trim()) {
				mergedMetadata.paymentProcessorCorporationId = updates.paymentProcessorCorporationId.trim()
			} else {
				delete mergedMetadata.paymentProcessorCorporationId
			}
		}
		if (updates.srpGroupId !== undefined) {
			if (updates.srpGroupId && updates.srpGroupId.trim()) {
				mergedMetadata.srpGroupId = updates.srpGroupId.trim()
			} else {
				delete mergedMetadata.srpGroupId
			}
		}

		// Create new config
		await this.db
			.insert(srpConfig)
			.values({
				isActive: true,
				defaultCoverageRate: updates.defaultCoverageRate || current?.defaultCoverageRate || '1.0',
				maxPayoutAmount: updates.maxPayoutAmount || current?.maxPayoutAmount || null,
				maxLossAgeDays: Math.min(
					updates.maxLossAgeDays || current?.maxLossAgeDays || 30,
					MAX_SRP_LOSS_AGE_DAYS
				),
				metadata: mergedMetadata,
				createdBy: userId,
				effectiveFrom: new Date(),
			})
			.returning()

		return this.getConfig() as Promise<SRPConfigResponse>
	}

	async listPaymentMismatchAlerts(
		options: { includeAcknowledged?: boolean; limit?: number; offset?: number } = {}
	): Promise<{ alerts: SRPPaymentMismatchAlert[]; total: number }> {
		const { includeAcknowledged = false, limit = 50, offset = 0 } = options
		const whereClause = includeAcknowledged ? undefined : eq(srpPaymentAlerts.state, 'open')

		const [alerts, [{ count }]] = await Promise.all([
			this.db.query.srpPaymentAlerts.findMany({
				where: whereClause,
				orderBy: desc(srpPaymentAlerts.detectedAt),
				limit,
				offset,
			}),
			this.db
				.select({ count: sql<number>`cast(count(*) as integer)` })
				.from(srpPaymentAlerts)
				.where(whereClause),
		])

		return {
			alerts: alerts.map((alert) => this.formatPaymentMismatchAlert(alert)),
			total: count,
		}
	}

	async acknowledgePaymentMismatchAlert(
		alertId: string,
		actorUserId: string,
		actorCharacterName: string
	): Promise<SRPPaymentMismatchAlert> {
		const existing = await this.db.query.srpPaymentAlerts.findFirst({
			where: eq(srpPaymentAlerts.id, alertId),
		})
		if (!existing) throw new Error('Payment alert not found')

		if (existing.state !== 'acknowledged' || !existing.acknowledgedAt) {
			await this.db
				.update(srpPaymentAlerts)
				.set({
					state: 'acknowledged',
					acknowledgedAt: new Date(),
					acknowledgedByUserId: actorUserId,
					acknowledgedByCharacterName: actorCharacterName,
				})
				.where(eq(srpPaymentAlerts.id, alertId))

			await this.logHistory(
				existing.requestId,
				actorUserId,
				actorCharacterName,
				'payment_alert_acknowledged',
				{
					metadata: {
						alertId: existing.id,
						journalId: existing.journalId,
						expectedAmount: existing.expectedAmount,
						observedAmount: existing.observedAmount,
					},
				},
				'internal'
			)
		}

		const updated = await this.db.query.srpPaymentAlerts.findFirst({
			where: eq(srpPaymentAlerts.id, alertId),
		})
		if (!updated) throw new Error('Payment alert not found after acknowledge')

		return this.formatPaymentMismatchAlert(updated)
	}

	/**
	 * Get SRP statistics
	 */
	async getStats(
		_startDate?: string,
		_endDate?: string,
		_corporationId?: string
	): Promise<SRPStatsResponse> {
		return {
			totalRequests: 0,
			totalRequestsByStatus: {
				pending: 0,
				needs_context: 0,
				approved: 0,
				payment_pending: 0,
				rejected: 0,
				paid: 0,
				withdrawn: 0,
			},
			totalIskApproved: '0',
			totalIskPaid: '0',
			averageApprovalTime: 0,
			topShipTypes: [],
			requestsByCorporation: [],
		}
	}

	// ========================================================================
	// SRP VALUATION
	// ========================================================================

	/**
	 * Pod type IDs — pods have no insurance so we skip the insurance lookup.
	 */
	private readonly POD_TYPE_IDS = new Set(['670', '33328'])
	/**
	 * Shuttle market group IDs from SDE marketGroups.jsonl.
	 * Includes direct shuttle groups used by ship hull types:
	 * 393, 394, 395, 396 (empire shuttles), 1618 (special edition), 1631 (faction),
	 * plus 391 top-level shuttle group.
	 */
	private readonly SHUTTLE_MARKET_GROUP_IDS = new Set([
		'391',
		'393',
		'394',
		'395',
		'396',
		'1618',
		'1631',
	])

	/**
	 * Calculate the SRP valuation for a loss using Jita prices at the time of loss.
	 *
	 * Formula:
	 *   equipmentValue = sum(Jita sell price × qty) for all equipped items
	 *   netInsurance   = max(0, platinumPayout - platinumPremium)  [0 for pods]
	 *   calculatedValue = max(0, equipmentValue - netInsurance)
	 *   finalValue      = floor_to_1M(calculatedValue × coverageRate, capped at maxPayoutAmount)
	 *
	 * @returns null if the killmail has no items (nothing to price)
	 */
	private async calculateSrpValuation(
		killmailData: KillmailDataJson,
		lossDate: Date,
		shipTypeId: string,
		config: SRPConfigResponse | null
	): Promise<{
		equipmentValue: string
		insurancePremium: string | null
		insurancePayout: string | null
		netInsurance: string
		calculatedValue: string
		finalValue: string
		priceSnapshotTime: Date | null
		pricingSource: 'historic' | 'fallback'
		insuranceSource?: 'historic' | 'fallback'
		itemPrices: Array<{ typeId: string; typeName: string; quantity: number; unitPrice: string; lineTotal: string; isConsumable?: boolean }>
	} | null> {
		const equippedByType = buildEquippedByType(killmailData?.victim?.items ?? [])

		// Always include the ship hull itself (qty 1)
		equippedByType.set(shipTypeId, (equippedByType.get(shipTypeId) ?? 0) + 1)

		// Fetch CCP universe average prices at time of loss from Markets DO
		const priceDate = lossDate.toISOString().slice(0, 10)
		const marketsStub = getStub<Markets>(this.env.MARKETS, 'universe')
		const { prices, missingTypeIds } = await marketsStub.getBatchMarketDataAtTime({
			regionId: createEveRegionId('universe'),
			typeIds: [...equippedByType.keys()].map(createEveTypeId),
			atTime: lossDate,
		})

		const priceMap = new Map(
			prices.map((p: LatestMarketPrice) => [p.typeId, p.bestSellPrice])
		)
		const priceSnapshotTime = prices[0]?.snapshotTime ?? null
		let pricingSource: 'historic' | 'fallback' = prices.length > 0 ? 'historic' : 'fallback'

		// Fill in any types missing from daily history using the DB-first/cache-fallback RPC
		if (missingTypeIds.length > 0) {
			try {
				const cached = await marketsStub.getMarketPricesForTypes(missingTypeIds.map(String), priceDate)
				for (const p of cached) {
					const avg = p.averagePrice
					if (avg && avg > 0) {
						priceMap.set(p.typeId, Math.round(avg).toString())
					}
					if (p.source === 'fallback') pricingSource = 'fallback'
				}
			} catch (err) {
				logger.warn('[calculateSrpValuation] Markets price fallback failed:', err)
				pricingSource = 'fallback'
			}
		}

		// Resolve type names and category metadata for all items
		const universeStub = getStub<Universe>(this.env.UNIVERSE, 'default')
		const allTypeIds = [...equippedByType.keys()]
		const [typeNameMap, typeMetaMap] = await Promise.all([
			universeStub.resolveTypeNamesByIds(allTypeIds).catch(() => ({}) as Record<string, null>),
			universeStub.resolveTypeMetadataByIds(allTypeIds).catch(
				() =>
					({}) as Record<
						string,
						{ categoryName: string; marketGroupId: string | null; marketGroupName: string | null }
					>
			),
		])

		// Build per-item breakdown
		const itemPrices: Array<{
			typeId: string
			typeName: string
			quantity: number
			unitPrice: string
			lineTotal: string
			isConsumable?: boolean
		}> = []
		let equipmentValueCents = 0n // work in integer ISK (prices are already ISK, not fractions)

		for (const [typeId, quantity] of equippedByType) {
			const rawPrice = priceMap.get(typeId)
			// Parse price as float then convert to integer ISK (truncate decimals)
			const unitPriceIsk = rawPrice != null ? BigInt(Math.floor(parseFloat(rawPrice))) : 0n
			const lineTotalIsk = unitPriceIsk * BigInt(quantity)
			// Charges (ammo, missiles, probes, etc.) are consumables — shown in fitting but not valued
			const isConsumable = typeMetaMap[typeId]?.categoryName === 'Charge'
			if (!isConsumable) {
				equipmentValueCents += lineTotalIsk
			}
			itemPrices.push({
				typeId,
				typeName: typeNameMap[typeId]?.typeName ?? typeId,
				quantity,
				unitPrice: String(unitPriceIsk),
				lineTotal: String(lineTotalIsk),
				...(isConsumable ? { isConsumable: true } : {}),
			})
		}

		const equipmentValue = String(equipmentValueCents)

		// Insurance lookup (skip for pods)
		let insurancePremium: string | null = null
		let insurancePayout: string | null = null
		let netInsurance = 0n
		let insuranceSource: 'historic' | 'fallback' | undefined

		if (!this.POD_TYPE_IDS.has(shipTypeId)) {
			try {
				const insResult = await marketsStub.getInsurancePricesForTypes([shipTypeId], priceDate)
				const ins = insResult[0]
				if (ins?.platinumCost != null && ins?.platinumPayout != null) {
					const cost = BigInt(Math.floor(ins.platinumCost))
					const payout = BigInt(Math.floor(ins.platinumPayout))
					insurancePremium = String(cost)
					insurancePayout = String(payout)
					netInsurance = payout - cost
					insuranceSource = ins.source
				}
			} catch (err) {
				logger.error('[calculateSrpValuation] Failed to fetch insurance prices:', err)
				// Non-fatal — proceed with no insurance credit
			}
		}

		const rawCalculated =
			equipmentValueCents > netInsurance ? equipmentValueCents - netInsurance : 0n
		const calculatedValue = String(rawCalculated)

		// Apply config modifiers
		const coverageRate = parseFloat(config?.defaultCoverageRate ?? '1.0')
		let finalIsk = BigInt(Math.floor(Number(rawCalculated) * coverageRate))

		if (config?.maxPayoutAmount) {
			const cap = BigInt(config.maxPayoutAmount)
			if (finalIsk > cap) finalIsk = cap
		}

		const finalValue = roundToMillion(String(finalIsk))

		return {
			equipmentValue,
			insurancePremium,
			insurancePayout,
			netInsurance: String(netInsurance),
			calculatedValue,
			finalValue,
			priceSnapshotTime,
			pricingSource,
			insuranceSource,
			itemPrices,
		}
	}

	/**
	 * Helper: Format request for response
	 */
	private async formatRequest(request: any): Promise<SRPRequestResponse> {
		await this.selfHealRequestItemMetadata(request)
		return formatSrpRequest(request)
	}

	private async formatRequestWithShipSlotCapacities(request: any): Promise<SRPRequestResponse> {
		const formatted = await this.formatRequest(request)
		formatted.shipSlotCapacities = await this.resolveShipSlotCapacities(formatted.shipTypeId)
		return formatted
	}

	private async resolveShipSlotCapacities(shipTypeId: string): Promise<{
		high: number
		mid: number
		low: number
		rig: number
		sub: number
		implant: number
	}> {
		if (!shipTypeId) {
			return DEFAULT_NON_POD_SLOT_CAPACITIES
		}
		if (this.POD_TYPE_IDS.has(shipTypeId)) {
			return DEFAULT_POD_SLOT_CAPACITIES
		}

		const now = Date.now()
		const cached = this.shipSlotCapacityCache.get(shipTypeId)
		if (cached && cached.expiresAt > now) {
			return cached.value
		}

		const fallback = DEFAULT_NON_POD_SLOT_CAPACITIES

		try {
			const data = await this.esiRateLimits.request({
				path: `/latest/universe/types/${encodeURIComponent(shipTypeId)}/?datasource=tranquility&language=en`,
				userKey: buildPublicEsiUserKey(),
				method: 'GET',
				timeoutMs: 10_000,
				parse: async (response) =>
					await parseJsonResponse<{
						dogma_attributes?: Array<{ attribute_id?: number; value?: number }>
					}>(response as Response, {
						context: `ESI universe type ${shipTypeId}`,
					}),
				buildError: ({ response, body, path }) =>
					new Error(
						`ESI request failed: ${response.status} ${response.statusText || 'Request Failed'} - ${body || 'Unknown ESI error'} | path=${path}`
					),
			})
			const resolved = parseShipSlotCapacitiesFromDogmaAttributes(data.dogma_attributes)

			this.shipSlotCapacityCache.set(shipTypeId, {
				value: resolved,
				expiresAt: now + SrpDO.MS_PER_DAY,
			})
			return resolved
		} catch {
			this.shipSlotCapacityCache.set(shipTypeId, {
				value: fallback,
				expiresAt: now + 10 * 60 * 1000,
			})
			return fallback
		}
	}

	private formatPaymentMismatchAlert(alert: any): SRPPaymentMismatchAlert {
		return {
			id: alert.id,
			requestId: alert.requestId,
			kind: alert.kind === 'payment_missing' ? 'payment_missing' : 'payment_mismatch',
			state: alert.state === 'acknowledged' ? 'acknowledged' : 'open',
			journalId: alert.journalId,
			expectedAmount: alert.expectedAmount,
			observedAmount: alert.observedAmount,
			expectedRecipientCharacterId: alert.expectedRecipientCharacterId,
			expectedRecipientCharacterName: alert.expectedRecipientCharacterName ?? undefined,
			actualRecipientCharacterId: alert.actualRecipientCharacterId ?? undefined,
			actualRecipientCharacterName: alert.actualRecipientCharacterName ?? undefined,
			actualPayerId: alert.actualPayerId ?? undefined,
			actualPayerName: alert.actualPayerName ?? undefined,
			reason: alert.reason ?? undefined,
			paymentProcessorCorporationId: alert.paymentProcessorCorporationId ?? undefined,
			metadata: (alert.metadata as Record<string, unknown>) ?? undefined,
			detectedAt: alert.detectedAt.toISOString(),
			lastSeenAt: alert.lastSeenAt.toISOString(),
			acknowledgedAt: alert.acknowledgedAt?.toISOString(),
			acknowledgedByUserId: alert.acknowledgedByUserId ?? undefined,
			acknowledgedByCharacterName: alert.acknowledgedByCharacterName ?? undefined,
		}
	}

	/**
	 * Helper: Log history entry
	 */
	private async logHistory(
		requestId: string,
		actorUserId: string,
		actorCharacterName: string,
		action: string,
		details: {
			previousRequestStatus?: RequestStatus | null
			newRequestStatus?: RequestStatus | null
			previousApprovedAmount?: string
			newApprovedAmount?: string
			metadata?: Record<string, unknown>
		},
		visibility: 'public' | 'internal' = 'internal'
	): Promise<void> {
		await this.db.insert(srpRequestHistory).values({
			requestId,
			actorUserId,
			actorCharacterName,
			action,
			previousRequestStatus: details.previousRequestStatus || null,
			newRequestStatus: details.newRequestStatus || null,
			previousApprovedAmount: details.previousApprovedAmount || null,
			newApprovedAmount: details.newApprovedAmount || null,
			metadata: details.metadata || {},
			visibility,
		})
	}

	// ========================================================================
	// REVIEW QUEUE
	// ========================================================================

	async getRequestsByStatus(
		status: RequestStatus,
		options: {
			limit?: number
			offset?: number
			characterName?: string
			shipTypeName?: string
			solarSystemName?: string
			dateFrom?: string
			dateTo?: string
		} = {}
	): Promise<{ requests: SRPRequestResponse[]; total: number }> {
		const { limit = 25, offset = 0, characterName, shipTypeName, solarSystemName, dateFrom, dateTo } = options

		const startDate = dateFrom
			? (dateFrom.includes('T')
				? new Date(dateFrom)
				: new Date(`${dateFrom}T00:00:00.000Z`))
			: null
		const endDate = dateTo
			? (dateTo.includes('T')
				? new Date(dateTo)
				: new Date(`${dateTo}T23:59:59.999Z`))
			: null

		const conditions =
			status === 'paid'
				? [inArray(srpRequests.requestStatus, ['payment_pending', 'paid'])]
				: [eq(srpRequests.requestStatus, status)]
		if (characterName) conditions.push(ilike(srpRequests.characterName, `%${characterName}%`))
		if (shipTypeName) conditions.push(ilike(srpRequests.shipTypeName, `%${shipTypeName}%`))
		if (solarSystemName) conditions.push(ilike(srpRequests.solarSystemName, `%${solarSystemName}%`))
		if (startDate) conditions.push(gte(srpRequests.lossDate, startDate))
		if (endDate) conditions.push(lte(srpRequests.lossDate, endDate))

		const where = and(...conditions)
		const oldestFirst = status === 'pending' || status === 'needs_context'

		const [requests, count] = await Promise.all([
			this.db.query.srpRequests.findMany({
				where,
				orderBy: oldestFirst ? srpRequests.createdAt : desc(srpRequests.createdAt),
				limit,
				offset,
			}),
			(async () => {
				const cacheKey = this.buildReviewQueueCountCacheKey({
					status,
					characterName,
					shipTypeName,
					solarSystemName,
					dateFrom,
					dateTo,
				})
				const cached = this.reviewQueueCountCache.get(cacheKey)
				const now = Date.now()
				if (cached && cached.expiresAt > now) return cached.value

				const [row] = await this.db
					.select({ count: sql<number>`count(*)::int` })
					.from(srpRequests)
					.where(where)
				const count = row?.count ?? 0
				this.reviewQueueCountCache.set(cacheKey, {
					value: count,
					expiresAt: now + SrpDO.REVIEW_QUEUE_COUNT_CACHE_TTL_MS,
				})
				return count
			})(),
		])

		return { requests: await Promise.all(requests.map((r) => this.formatRequest(r))), total: count }
	}

	async getSearchValues(
		status: RequestStatus,
		field: 'character' | 'ship' | 'system',
		query: string
	): Promise<Array<{ value: string }>> {
		const statusCond =
			status === 'paid'
				? inArray(srpRequests.requestStatus, ['payment_pending', 'paid'])
				: eq(srpRequests.requestStatus, status)

		if (field === 'character') {
			const rows = await this.db
				.selectDistinct({ characterName: srpRequests.characterName })
				.from(srpRequests)
				.where(and(statusCond, ilike(srpRequests.characterName, `%${query}%`)))
				.limit(20)
			return rows.map((r) => ({ value: r.characterName }))
		}

		if (field === 'ship') {
			const rows = await this.db
				.selectDistinct({ shipTypeName: srpRequests.shipTypeName })
				.from(srpRequests)
				.where(and(statusCond, ilike(srpRequests.shipTypeName, `%${query}%`)))
				.limit(20)
			return rows.map((r) => ({ value: r.shipTypeName }))
		}

		// system
		const rows = await this.db
			.selectDistinct({ solarSystemName: srpRequests.solarSystemName })
			.from(srpRequests)
			.where(and(statusCond, ilike(srpRequests.solarSystemName!, `%${query}%`), sql`${srpRequests.solarSystemName} is not null`))
			.limit(20)
		return rows.map((r) => ({ value: r.solarSystemName! }))
	}

	// ========================================================================
	// SUBMIT REVIEW
	// ========================================================================

	async submitReview(
		requestId: string,
		reviewerUserId: string,
		reviewerCharacterName: string,
		data: SRPReviewSubmission
	): Promise<SRPRequestResponse> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
		})

		if (!request) throw new Error('Request not found')

		// Load policies if referenced
		let modifierPolicy: typeof srpPolicies.$inferSelect | null = null
		let capPolicy: typeof srpPolicies.$inferSelect | null = null

		if (data.appliedModifierPolicyId) {
			modifierPolicy = await this.db.query.srpPolicies.findFirst({
				where: eq(srpPolicies.id, data.appliedModifierPolicyId),
			}) ?? null
			if (!modifierPolicy) throw new Error('Modifier policy not found')
		}

		if (data.appliedCapPolicyId) {
			capPolicy = await this.db.query.srpPolicies.findFirst({
				where: eq(srpPolicies.id, data.appliedCapPolicyId),
			}) ?? null
			if (!capPolicy) throw new Error('Cap policy not found')
		}

		const modifierPolicyName = modifierPolicy?.name ?? null
		const capPolicyName = capPolicy?.name ?? null

		// Compute approved amount
		let approvedAmount: string

		if (data.reviewerOverrideMillions != null) {
			// Override replaces the entire calculation
			approvedAmount = roundToMillion(
				String(BigInt(data.reviewerOverrideMillions) * 1_000_000n)
			)
		} else {
			approvedAmount = this.computeReviewPayout(request, data, modifierPolicy, capPolicy)
		}

		if (approvedAmount === '0' && data.outcome === 'approved') {
			throw Object.assign(new Error('Cannot approve a request with zero payout'), {
				status: 422,
			})
		}

		const updated = await this.db
			.update(srpRequests)
			.set({
				requestStatus: data.outcome,
				approvedAmount,
				reviewerId: reviewerUserId,
				reviewerCharacterName,
				reviewedAt: new Date(),
				appliedModifierPolicyId: data.appliedModifierPolicyId,
				appliedModifierPolicyName: modifierPolicyName,
				appliedCapPolicyId: data.appliedCapPolicyId,
				appliedCapPolicyName: capPolicyName,
				appliedModifiers: data.appliedModifiers.length > 0 ? data.appliedModifiers : null,
				reviewerOverrideMillions: data.reviewerOverrideMillions,
				updatedAt: new Date(),
			})
			.where(eq(srpRequests.id, requestId))
			.returning()
		this.clearReviewQueueCountCache()

		// Status transition is public; all other review details are internal
		await this.logHistory(
			requestId,
			reviewerUserId,
			reviewerCharacterName,
			'review_submitted',
			{
				previousRequestStatus: request.requestStatus,
				previousApprovedAmount: request.approvedAmount ?? undefined,
				newRequestStatus: data.outcome,
				newApprovedAmount: approvedAmount,
			},
			'public'
		)

		if (
			data.appliedModifiers.length > 0 ||
			data.appliedModifierPolicyId ||
			data.appliedCapPolicyId
		) {
			await this.logHistory(
				requestId,
				reviewerUserId,
				reviewerCharacterName,
				'review_details',
				{
					metadata: {
						modifierPolicyId: data.appliedModifierPolicyId,
						modifierPolicyName,
						capPolicyId: data.appliedCapPolicyId,
						capPolicyName,
						modifierCount: data.appliedModifiers.length,
						override: data.reviewerOverrideMillions,
					},
				},
				'internal'
			)
		}

		// Auto-post feedback as public comment
		if (data.feedbackText) {
			await this.addComment(requestId, reviewerUserId, reviewerCharacterName, data.feedbackText, 'public')
		}

		// Auto-post review notes as internal comment
		if (data.reviewNotes) {
			await this.addComment(requestId, reviewerUserId, reviewerCharacterName, data.reviewNotes, 'internal')
		}

		return await this.formatRequestWithShipSlotCapacities(updated[0])
	}

	/** Computes the payout amount from policy + modifiers. Does NOT apply override. */
	private computeReviewPayout(
		request: any,
		data: SRPReviewSubmission,
		modifierPolicy: typeof srpPolicies.$inferSelect | null,
		capPolicy: typeof srpPolicies.$inferSelect | null
	): string {
		// Use floating-point arithmetic to mirror the UI calculation, then convert at the end
		let current = parseFloat(request.srpEquipmentValue ?? '0')

		// Step 1: Insurance delta — applied by default unless policy explicitly disables it
		const modifierConfig = modifierPolicy?.config as { rate?: string; applyInsuranceDelta?: boolean } | null
		const applyInsuranceDelta = modifierConfig?.applyInsuranceDelta ?? true
		if (applyInsuranceDelta) {
			const netInsurance = parseFloat(request.srpNetInsurance ?? '0')
			current = Math.max(0, current - netInsurance)
		}

		// Step 2: Coverage rate from modifier policy (default 1.0)
		if (modifierConfig?.rate != null) {
			current = current * parseFloat(modifierConfig.rate)
		}

		// Step 3: Ad-hoc modifiers in order
		for (const mod of data.appliedModifiers) {
			if (mod.mode === 'percentage') {
				const factor = mod.modifierType === 'deduction' ? 1 - mod.amount / 100 : 1 + mod.amount / 100
				current = current * factor
			} else {
				const delta = mod.amount * 1_000_000
				current = mod.modifierType === 'deduction' ? current - delta : current + delta
			}
		}

		// Step 4: Clamp to 0
		current = Math.max(0, current)

		// Step 5: Cap policy
		if (capPolicy) {
			const capConfig = capPolicy.config as { maxPayoutMillions?: number } | null
			if (capConfig?.maxPayoutMillions != null) {
				current = Math.min(current, capConfig.maxPayoutMillions * 1_000_000)
			}
		}

		return roundToMillion(String(Math.round(current)))
	}

	// ========================================================================
	// STATE CHANGE
	// ========================================================================

	async updateReviewState(
		requestId: string,
		actorUserId: string,
		actorCharacterName: string,
		newState: RequestStatus,
		notes?: string
	): Promise<SRPRequestResponse> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
		})

		if (!request) throw new Error('Request not found')

		const updated = await this.db
			.update(srpRequests)
			.set({
				requestStatus: newState,
				...(newState === 'payment_pending'
					? {
							paymentDate: new Date(),
							paymentCharacterName: actorCharacterName,
							paymentScanCursorDate: null,
					  }
					: {}),
				updatedAt: new Date(),
			})
			.where(eq(srpRequests.id, requestId))
			.returning()

		await this.logHistory(
			requestId,
			actorUserId,
			actorCharacterName,
			'state_changed',
			{
				previousRequestStatus: request.requestStatus,
				newRequestStatus: newState,
				metadata: notes ? { notes } : undefined,
			},
			'public'
		)

		return await this.formatRequestWithShipSlotCapacities(updated[0])
	}

	async withdrawRequest(
		requestId: string,
		userId: string,
		actorCharacterName: string,
		notes?: string
	): Promise<SRPRequestResponse> {
		const request = await this.db.query.srpRequests.findFirst({
			where: eq(srpRequests.id, requestId),
		})

		if (!request) throw new Error('Request not found')
		if (request.userId !== userId) throw new Error('Not authorized to withdraw this request')
		if (!['pending', 'needs_context'].includes(request.requestStatus)) {
			throw new Error('Only pending or needs_context requests can be withdrawn')
		}

		const updated = await this.db
			.update(srpRequests)
			.set({
				requestStatus: 'withdrawn',
				updatedAt: new Date(),
			})
			.where(eq(srpRequests.id, requestId))
			.returning()

		await this.logHistory(
			requestId,
			userId,
			actorCharacterName,
			'request_withdrawn',
			{
				previousRequestStatus: request.requestStatus,
				newRequestStatus: 'withdrawn',
				metadata: notes ? { notes } : undefined,
			},
			'public'
		)

		return await this.formatRequestWithShipSlotCapacities(updated[0])
	}

	// ========================================================================
	// POLICY CRUD
	// ========================================================================

	async listPolicies(): Promise<SRPPolicy[]> {
		const rows = await this.db.query.srpPolicies.findMany({
			orderBy: srpPolicies.displayOrder,
		})
		return rows.map(this.formatPolicy)
	}

	async createPolicy(
		userId: string,
		data: CreateSRPPolicy
	): Promise<SRPPolicy> {
		const [row] = await this.db
			.insert(srpPolicies)
			.values({
				name: data.name,
				description: data.description ?? null,
				effect: data.effect,
				config: data.config,
				displayOrder: data.displayOrder ?? 0,
				...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
				createdBy: userId,
			})
			.returning()
		return this.formatPolicy(row)
	}

	async updatePolicy(
		id: string,
		userId: string,
		data: Partial<CreateSRPPolicy>
	): Promise<SRPPolicy> {
		const existing = await this.db.query.srpPolicies.findFirst({
			where: eq(srpPolicies.id, id),
		})
		if (!existing) throw new Error('Policy not found')

		const [row] = await this.db
			.update(srpPolicies)
			.set({
				...(data.name !== undefined ? { name: data.name } : {}),
				...(data.description !== undefined ? { description: data.description } : {}),
				...(data.config !== undefined ? { config: data.config } : {}),
				...(data.displayOrder !== undefined ? { displayOrder: data.displayOrder } : {}),
				...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
				updatedAt: new Date(),
			})
			.where(eq(srpPolicies.id, id))
			.returning()
		return this.formatPolicy(row)
	}

	async deletePolicy(id: string, _userId: string): Promise<void> {
		// Soft-delete: set isActive = false
		await this.db
			.update(srpPolicies)
			.set({ isActive: false, updatedAt: new Date() })
			.where(eq(srpPolicies.id, id))
	}

	private formatPolicy(row: any): SRPPolicy {
		return {
			id: row.id,
			name: row.name,
			description: row.description ?? undefined,
			effect: row.effect,
			config: row.config as SRPPolicyConfig,
			isActive: row.isActive,
			displayOrder: row.displayOrder,
			createdBy: row.createdBy,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
		}
	}
}
