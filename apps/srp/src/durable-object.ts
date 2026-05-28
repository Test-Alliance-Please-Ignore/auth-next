import { DurableObject } from 'cloudflare:workers'

import { and, asc, desc, eq, gte, ilike, inArray, lte, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { createEveRegionId, createEveTypeId } from '@repo/eve-types'
import { generateKillmailUrl, roundToMillion } from '@repo/srp'
import { parseJsonResponse } from '@repo/worker-utils'

import { createDb } from './db'
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
import { computeSrpPayout } from './lib/payout'
import {
	DEFAULT_NON_POD_SLOT_CAPACITIES,
	DEFAULT_POD_SLOT_CAPACITIES,
	parseShipSlotCapacitiesFromDogmaAttributes,
} from './lib/ship-slot-capacities'
import { isEquippedSlot } from './lib/slot-flags'

import type { srpRequests as srpRequestsTable } from './db/schema'

type KillmailDataJson = NonNullable<typeof srpRequestsTable.$inferInsert.killmailData>

import type { CharacterLossData, EveCharacterData } from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { LatestMarketPrice, Markets } from '@repo/markets'
import type {
	AppliedModifier,
	CreateSRPPolicy,
	LossWithSRPStatus,
	RequestStatus,
	Srp,
	SRPCommentResponse,
	SRPConfigResponse,
	SRPPaymentMismatchAlert,
	SRPPolicy,
	SRPPolicyConfig,
	SRPRequestResponse,
	SRPReviewSubmission,
	SRPStatsResponse,
	SRPValuationPreview,
	UpdateSRPConfig,
} from '@repo/srp'
import type { Universe } from '@repo/universe'
import type { Env } from './context'

/**
 * SRP Durable Object
 *
 * Manages the Ship Replacement Program database and business logic.
 * Uses PostgreSQL for persistent storage.
 */
export class SrpDO extends DurableObject<Env> implements Srp {
	private static readonly MS_PER_DAY = 86_400_000
	private static readonly REVIEW_QUEUE_COUNT_CACHE_TTL_MS = 60_000
	private db: ReturnType<typeof createDb>
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

		// Fetch killmail details from eve-character-data using instance pattern
		const charStub = getStub<EveCharacterData>(this.env.EVE_CHARACTER_DATA, characterId)
		const charInstance = await charStub.getInstance(characterId)
		const killmailData = await charInstance.fetchKillmailDetails(normalizedKillmailId, killmailHash)

		if (!killmailData || !killmailData.isLoss) {
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

		const rawSolarSystemId = (killmailData.killmailData as any)?.solar_system_id
		const solarSystemId = rawSolarSystemId ? String(rawSolarSystemId) : null

		const universeStub = getStub<Universe>(this.env.UNIVERSE, 'default')
		const [typeMap, systemMap] = await Promise.all([
			universeStub
				.resolveTypeNamesByIds([String(killmailData.shipTypeId)])
				.catch(() => ({}) as Record<string, null>),
			solarSystemId
				? universeStub
						.resolveSolarSystemsByIds([solarSystemId])
						.catch(() => ({}) as Record<string, null>)
				: Promise.resolve({} as Record<string, null>),
		])
		const shipTypeName =
			typeMap[String(killmailData.shipTypeId)]?.typeName ?? `Ship ${killmailData.shipTypeId}`
		const solarSystemName = solarSystemId
			? (systemMap[solarSystemId]?.solarSystemName ?? null)
			: null

		// Calculate SRP valuation from Jita prices at time of loss
		const config = await this.getConfig()
		const lossDate = new Date(killmailData.killmailTime)
		const maxLossAgeDays = config?.maxLossAgeDays ?? 30
		const maxLossAgeMs = maxLossAgeDays * SrpDO.MS_PER_DAY
		if (Date.now() - lossDate.getTime() > maxLossAgeMs) {
			throw new Error(`Loss is older than the maximum allowed age of ${maxLossAgeDays} days`)
		}
		let valuation: Awaited<ReturnType<typeof this.calculateSrpValuation>> = null
		try {
			valuation = await this.calculateSrpValuation(
				killmailData.killmailData as any,
				lossDate,
				String(killmailData.shipTypeId),
				config
			)
		} catch (err) {
			// Non-fatal — request is still created, valuation fields will be null
			console.error('[createRequest] SRP valuation failed:', err)
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
				shipTypeId: killmailData.shipTypeId!,
				shipTypeName,
				shipValue: killmailData.totalValue!,
				solarSystemId,
				solarSystemName,
				contextText,
				lossDate: killmailData.killmailTime,
				killmailData: killmailData.killmailData as any,
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
		const charStub = getStub<EveCharacterData>(this.env.EVE_CHARACTER_DATA, characterId)
		const charInstance = await charStub.getInstance(characterId)
		const killmailData = await charInstance.fetchKillmailDetails(killmailId, killmailHash)

		if (!killmailData || !killmailData.isLoss) {
			throw new Error('Killmail not found or is not a loss')
		}

		const config = await this.getConfig()
		const lossDate = new Date(killmailData.killmailTime)
		const valuation = await this.calculateSrpValuation(
			killmailData.killmailData as any,
			lossDate,
			String(killmailData.shipTypeId),
			config
		)

		if (!valuation) return null

		// Identify which type IDs had no market data (priced at 0)
		const missingPriceTypeIds = valuation.itemPrices
			.filter((item) => item.unitPrice === '0')
			.map((item) => item.typeId)

		const rawItems = (killmailData.killmailData as any)?.victim?.items ?? []
		const victimItems = rawItems
			.filter((i: any) => i.item_type_id != null && i.flag != null)
			.map((i: any) => ({
				typeId: String(i.item_type_id),
				flag: i.flag as number,
				quantityDestroyed: i.quantity_destroyed ?? 0,
				quantityDropped: i.quantity_dropped ?? 0,
			}))

		const allTypeIds = [
			...new Set([
				String(killmailData.shipTypeId),
				...victimItems.map((i: { typeId: string }) => i.typeId),
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
	 * Get all requests for a user
	 */
	async getUserRequests(userId: string, limit = 50, offset = 0): Promise<SRPRequestResponse[]> {
		const requests = await this.db.query.srpRequests.findMany({
			where: eq(srpRequests.userId, userId),
			orderBy: desc(srpRequests.createdAt),
			limit,
			offset,
		})

		return requests.map((r) => this.formatRequest(r))
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
		characterIds: string[],
		userId: string,
		daysBack = 30,
		_excludeNonSrpEligible = true
	): Promise<LossWithSRPStatus[]> {
		const config = await this.getConfig()
		const maxLossAgeDays = config?.maxLossAgeDays ?? daysBack
		const effectiveDaysBack = Math.max(1, Math.min(daysBack, maxLossAgeDays))
		const cutoffMs = Date.now() - effectiveDaysBack * SrpDO.MS_PER_DAY

		// Fetch losses cache-first from eve-character-data, then refresh from ESI with cursor-stop pagination.
		const allLosses = new Map<string, CharacterLossData>()

		const universeStub = getStub<Universe>(this.env.UNIVERSE, 'default')
		for (const characterId of characterIds) {
			const characterDataStub = getStub<EveCharacterData>(this.env.EVE_CHARACTER_DATA, characterId)
			const cachedLosses = await characterDataStub.getRecentLosses(characterId, effectiveDaysBack, false)
			for (const loss of cachedLosses) {
				allLosses.set(loss.killmailId, loss)
			}

			try {
				await characterDataStub.fetchKillmails(characterId)
			} catch (error) {
				console.warn(`[SrpDO.getRecentLosses] Failed to refresh killmails for ${characterId}`, error)
			}

			const refreshedLosses = await characterDataStub.getRecentLosses(characterId, effectiveDaysBack, false)
			for (const loss of refreshedLosses) {
				allLosses.set(loss.killmailId, loss)
			}
		}
		const mergedLosses = [...allLosses.values()]

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
			return []
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
		return mergedLosses
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
					hasSRPRequest: !!request,
					srpRequestId: request?.id,
					srpRequestStatus: request?.status,
				}
			})
			.sort((a, b) => new Date(b.killmailTime).getTime() - new Date(a.killmailTime).getTime())
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

		return requests.map((r) => this.formatRequest(r))
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

		return requests.map((r) => this.formatRequest(r))
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
			maxLossAgeDays: config.maxLossAgeDays,
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
				maxLossAgeDays: updates.maxLossAgeDays || current?.maxLossAgeDays || 30,
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
				console.warn('[calculateSrpValuation] Markets price fallback failed:', err)
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
				console.error('[calculateSrpValuation] Failed to fetch insurance prices:', err)
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
	private formatRequest(request: any): SRPRequestResponse {
		const effectiveApprovedAmount =
			request.requestStatus === 'rejected' ? '0' : request.approvedAmount

		return {
			id: request.id,
			userId: request.userId,
			characterId: request.characterId,
			characterName: request.characterName,
			corporationId: request.corporationId,
			corporationName: request.corporationName,
			killmailHash: request.killmailHash,
			killmailUrl: generateKillmailUrl(request.id),
			lossDate: request.lossDate.toISOString(),
			shipTypeId: request.shipTypeId,
			shipTypeName: request.shipTypeName,
			shipValue: request.shipValue,
			solarSystemId: request.solarSystemId ?? undefined,
			solarSystemName: request.solarSystemName ?? undefined,
			contextText: request.contextText ?? undefined,
			requestStatus: request.requestStatus,
			approvedAmount: effectiveApprovedAmount ?? undefined,
			reviewerId: request.reviewerId ?? undefined,
			reviewerCharacterName: request.reviewerCharacterName ?? undefined,
			reviewedAt: request.reviewedAt?.toISOString(),
			reviewNotes: request.reviewNotes ?? undefined,
			paymentDate: request.paymentDate?.toISOString(),
			paymentCharacterName: request.paymentCharacterName ?? undefined,
			appliedModifierPolicyId: request.appliedModifierPolicyId ?? undefined,
			appliedModifierPolicyName: request.appliedModifierPolicyName ?? undefined,
			appliedCapPolicyId: request.appliedCapPolicyId ?? undefined,
			appliedCapPolicyName: request.appliedCapPolicyName ?? undefined,
			appliedModifiers: (request.appliedModifiers as AppliedModifier[] | null) ?? undefined,
			reviewerOverrideMillions: request.reviewerOverrideMillions ?? undefined,
			fleetId: request.fleetId ?? undefined,
			srpEquipmentValue: request.srpEquipmentValue ?? undefined,
			srpInsurancePremium: request.srpInsurancePremium ?? undefined,
			srpInsurancePayout: request.srpInsurancePayout ?? undefined,
			srpNetInsurance: request.srpNetInsurance ?? undefined,
			srpCalculatedValue: request.srpCalculatedValue ?? undefined,
			srpFinalValue: request.srpFinalValue ?? undefined,
			srpPriceSnapshotTime: request.srpPriceSnapshotTime?.toISOString() ?? undefined,
			srpItemPrices: (request.srpItemPrices as any) ?? undefined,
			killmailItems: (request.killmailData as any)?.victim?.items ?? undefined,
			createdAt: request.createdAt.toISOString(),
			updatedAt: request.updatedAt.toISOString(),
			comments: request.comments?.map((c: any) => ({
				id: c.id,
				requestId: c.requestId,
				authorUserId: c.authorUserId,
				authorCharacterName: c.authorCharacterName,
				content: c.content,
				visibility: c.visibility,
				isEdited: c.isEdited,
				editedAt: c.editedAt?.toISOString(),
				createdAt: c.createdAt.toISOString(),
			})),
			history: request.history
				?.filter((h: any) => h.action !== 'payment_scan_cursor_updated')
				.map((h: any) => ({
					id: h.id,
					requestId: h.requestId,
					actorUserId: h.actorUserId,
					actorCharacterName: h.actorCharacterName,
					action: h.action,
					previousRequestStatus: h.previousRequestStatus,
					newRequestStatus: h.newRequestStatus,
					previousApprovedAmount: h.previousApprovedAmount,
					newApprovedAmount: h.newApprovedAmount,
					metadata: h.metadata as Record<string, unknown>,
					visibility: h.visibility,
					timestamp: h.timestamp.toISOString(),
				})),
		}
	}

	private async formatRequestWithShipSlotCapacities(request: any): Promise<SRPRequestResponse> {
		const formatted = this.formatRequest(request)
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
			const response = await fetch(
				`https://esi.evetech.net/latest/universe/types/${encodeURIComponent(shipTypeId)}/?datasource=tranquility&language=en`,
				{ signal: AbortSignal.timeout(10_000) }
			)
			if (!response.ok) {
				this.shipSlotCapacityCache.set(shipTypeId, {
					value: fallback,
					expiresAt: now + 10 * 60 * 1000,
				})
				return fallback
			}

			const data = await parseJsonResponse<{
				dogma_attributes?: Array<{ attribute_id?: number; value?: number }>
			}>(response, {
				context: `ESI universe type ${shipTypeId}`,
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

		return { requests: requests.map((r) => this.formatRequest(r)), total: count }
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
