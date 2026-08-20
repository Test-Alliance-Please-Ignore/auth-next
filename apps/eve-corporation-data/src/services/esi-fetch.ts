/**
 * ESI Fetch Service
 *
 * Contains all ESI fetching logic extracted from the Durable Object.
 * These functions are pure business logic that can be called from workflows or DO methods.
 *
 * This separation allows:
 * - Workflows to orchestrate fetching without coupling to DO
 * - DO to focus on data storage operations
 * - Easy testing of fetch logic
 * - Reusability across different contexts
 */

import { logger } from '@repo/hono-helpers'
import { parseDateOrNull } from '@repo/worker-utils'
import { parseEsiErrorMetadata } from '@repo/workflow-utils'

import { transformAssets } from '../lib/esi-transforms'

import type { Esi } from '@repo/esi'
import type {
	CorporationPublicData,
	EsiCorporationAsset,
	EsiCorporationContract,
	EsiCorporationIndustryJob,
	EsiCorporationKillmail,
	EsiCorporationMembers,
	EsiCorporationMemberTracking,
	EsiCorporationMiningExtraction,
	EsiCorporationOrder,
	EsiCorporationSkyhook,
	EsiCorporationStructure,
	EsiCorporationWallet,
	EsiCorporationWalletJournalEntry,
	EsiCorporationWalletTransaction,
	EsiSovereigntyHub,
	EsiSovereigntySystem,
	WalletJournalWatermark,
	WalletTransactionWatermark,
} from '@repo/eve-corporation-data'

const SOVEREIGNTY_HUB_TYPE_ID = '32458'
const SOVEREIGNTY_HUB_DETAIL_BATCH_SIZE = 4
const SKYHOOK_DETAIL_BATCH_SIZE = 4
const MAX_WALLET_TRANSACTION_PAGES = 100

function compareNumericStrings(left: string, right: string): number {
	try {
		const leftBigInt = BigInt(left)
		const rightBigInt = BigInt(right)
		if (leftBigInt === rightBigInt) {
			return 0
		}
		return leftBigInt > rightBigInt ? 1 : -1
	} catch {
		return left.localeCompare(right, 'en')
	}
}

export interface WalletTransactionsFetchResult {
	transactions: EsiCorporationWalletTransaction[]
	pagesFetched: number
	stoppedAtWatermark: boolean
	truncated: boolean
}

export interface StructureEnrichmentFailure {
	structureId: string
	failureReason: string
}

// ========================================================================
// PUBLIC DATA FETCHING
// ========================================================================

/**
 * Fetch public corporation information from ESI
 */
export async function fetchPublicInfo(
	esi: Esi,
	corporationId: string
): Promise<CorporationPublicData> {
	const data = await esi.fetchCorporationPublicInfo(corporationId)

	return {
		corporationId,
		name: data.name,
		ticker: data.ticker,
		ceoId: data.ceo_id,
		creatorId: data.creator_id,
		dateFounded: parseDateOrNull(data.date_founded),
		description: data.description ?? null,
		homeStationId: data.home_station_id ?? null,
		memberCount: Number(data.member_count ?? 0),
		shares: data.shares ?? null,
		taxRate: data.tax_rate,
		url: data.url ?? null,
		allianceId: data.alliance_id ?? null,
		factionId: data.faction_id ?? null,
		warEligible: data.war_eligible ?? false,
		updatedAt: new Date(),
	}
}

// ========================================================================
// CORE DATA FETCHING
// ========================================================================

/**
 * Fetch corporation members from ESI
 */
export async function fetchMembers(
	esi: Esi,
	corporationId: string,
	_characterId: string
): Promise<EsiCorporationMembers> {
	return await esi.fetchCorporationMembers(corporationId)
}

/**
 * Fetch member tracking data from ESI
 */
export async function fetchMemberTracking(
	esi: Esi,
	corporationId: string,
	_characterId: string
): Promise<EsiCorporationMemberTracking[]> {
	return await esi.fetchCorporationMemberTracking(corporationId)
}

// ========================================================================
// FINANCIAL DATA FETCHING
// ========================================================================

/**
 * Fetch corporation wallets from ESI
 */
export async function fetchWallets(
	esi: Esi,
	corporationId: string,
	_characterId: string
): Promise<EsiCorporationWallet[]> {
	return await esi.fetchCorporationWallets(corporationId)
}

/**
 * Fetch wallet journal for a division from ESI
 */
export async function fetchWalletJournal(
	esi: Esi,
	corporationId: string,
	division: number,
	_characterId: string,
	watermark?: WalletJournalWatermark
): Promise<EsiCorporationWalletJournalEntry[]> {
	if (!watermark?.maxJournalId) {
		return await esi.fetchCorporationWalletJournal(corporationId, division)
	}
	const result = await esi.fetchCorporationWalletJournalUntilWatermark(corporationId, division, {
		maxId: watermark.maxJournalId,
		maxDate: watermark.maxJournalDate?.toISOString() ?? null,
	})
	return result.data
}

/**
 * Fetch wallet transactions for a division from ESI
 */
export async function fetchWalletTransactions(
	esi: Esi,
	corporationId: string,
	division: number,
	_characterId: string,
	watermark?: WalletTransactionWatermark
): Promise<WalletTransactionsFetchResult> {
	return await fetchWalletTransactionsPages(esi, corporationId, division, watermark)
}

async function fetchWalletTransactionsPages(
	esi: Esi,
	corporationId: string,
	division: number,
	watermark?: WalletTransactionWatermark
): Promise<WalletTransactionsFetchResult> {
	const transactions = new Map<string, EsiCorporationWalletTransaction>()
	let pageData = await esi.fetchCorporationWalletTransactionsPage(corporationId, division)
	let pagesFetched = 1
	let fromId: string | undefined
	let watermarkSeen = false
	let stoppedAtWatermark = false
	let completed = pageData.length === 0
	let truncated = false

	const addPage = (entries: EsiCorporationWalletTransaction[]) => {
		for (const entry of entries) {
			transactions.set(entry.transaction_id, entry)
		}
	}

	const hasWatermarkRow = (entries: EsiCorporationWalletTransaction[]) =>
		watermark?.maxTransactionId !== null && watermark?.maxTransactionId !== undefined
			? entries.some((entry) => entry.transaction_id === watermark.maxTransactionId)
			: false

	const hasRowsAtOrBeyondWatermark = (
		entries: EsiCorporationWalletTransaction[],
		cursorId?: string
	) => {
		if (!watermark?.maxTransactionId) {
			return true
		}

		return entries.some((entry) => {
			if (entry.transaction_id === cursorId) {
				return false
			}
			if (compareNumericStrings(entry.transaction_id, watermark.maxTransactionId!) > 0) {
				return true
			}
			const transactionDate = parseDateOrNull(entry.date)
			return (
				watermark.maxTransactionDate !== null &&
				transactionDate !== null &&
				transactionDate >= watermark.maxTransactionDate
			)
		})
	}

	addPage(pageData)
	if (hasWatermarkRow(pageData)) {
		watermarkSeen = true
		if (!hasRowsAtOrBeyondWatermark(pageData)) {
			stoppedAtWatermark = true
		}
	} else {
		for (let page = 1; page < MAX_WALLET_TRANSACTION_PAGES; page += 1) {
			if (pageData.length === 0) {
				completed = true
				break
			}

			const nextFromId = pageData.reduce(
				(min, entry) => (BigInt(entry.transaction_id) < BigInt(min) ? entry.transaction_id : min),
				pageData[0].transaction_id
			)
			if (nextFromId === fromId) {
				completed = true
				break
			}
			fromId = nextFromId

			pageData = await esi.fetchCorporationWalletTransactionsPage(corporationId, division, fromId)
			pagesFetched += 1
			addPage(pageData)

			if (hasWatermarkRow(pageData)) {
				watermarkSeen = true
			}
			if (watermarkSeen && !hasRowsAtOrBeyondWatermark(pageData, fromId)) {
				stoppedAtWatermark = true
				completed = true
				break
			}

			// ESI includes the cursor row in a from_id response. A singleton cursor
			// response means there is no older data left to request.
			if (pageData.length === 1 && pageData[0]?.transaction_id === fromId) {
				completed = true
				break
			}
		}

		if (!completed && !stoppedAtWatermark) {
			truncated = true
			logger.warn('[WalletTransactionsFetch] Page safety limit reached', {
				corporationId,
				division,
				pagesFetched,
			})
		}
	}

	return {
		transactions: [...transactions.values()],
		pagesFetched,
		stoppedAtWatermark,
		truncated,
	}
}

// ========================================================================
// ASSETS DATA FETCHING
// ========================================================================

/**
 * Fetch corporation assets from ESI (paginated)
 */
export async function fetchAssets(
	esi: Esi,
	corporationId: string,
	_characterId: string
): Promise<EsiCorporationAsset[]> {
	return transformAssets(await esi.fetchCorporationAssets(corporationId))
}

/**
 * Fetch corporation structures from ESI
 */
export async function fetchStructures(
	esi: Esi,
	corporationId: string,
	_characterId: string
): Promise<EsiCorporationStructure[]> {
	return (await esi.fetchCorporationStructures(corporationId)).map((structure) => ({
		...structure,
		corporation_id: corporationId,
	}))
}

export async function fetchSovereigntySystems(esi: Esi): Promise<EsiSovereigntySystem[]> {
	const response = await esi.fetchSovereigntySystems()
	return response.solar_systems.map((system) => {
		if ('alliance' in system.claim) {
			const claim = system.claim.alliance
			return {
				system_id: String(system.solar_system_id),
				claim_type: 'alliance' as const,
				alliance_id: String(claim.alliance_id),
				corporation_id: String(claim.corporation_id),
				claimed_since: claim.claimed_since,
				is_capital_system: claim.is_capital_system,
				sovereignty_hub_structure_id: String(claim.sovereignty_hub.id),
				vulnerability_window: claim.sovereignty_hub.vulnerability_window ?? null,
				activity_defense_multiplier: String(claim.development.activity_defense_multiplier),
				military_level: claim.development.military_level,
				industrial_level: claim.development.industrial_level,
				strategic_level: claim.development.strategic_level,
				raw: system as Record<string, unknown>,
			}
		}

		if ('faction' in system.claim) {
			return {
				system_id: String(system.solar_system_id),
				claim_type: 'faction' as const,
				faction_id: String(system.claim.faction.faction_id),
				raw: system as Record<string, unknown>,
			}
		}

		return {
			system_id: String(system.solar_system_id),
			claim_type: 'unclaimed' as const,
			raw: system as Record<string, unknown>,
		}
	})
}

function isRateLimitEsiError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error)
	const metadata = parseEsiErrorMetadata(message)
	return metadata?.status === 429 || message.includes('429 Too Many Requests')
}

export async function fetchSovereigntyHubs(
	esi: Esi,
	corporationId: string,
	options: {
		prioritizedEntries: ReadonlyArray<{
			index: number
			entry: { id: number; solar_system_id: number }
		}>
		pruneCandidateIds?: readonly string[]
	}
): Promise<{
	sovereigntyHubs: EsiSovereigntyHub[]
	pruneCandidateIds: string[]
	failures: StructureEnrichmentFailure[]
	failureCount: number
	rateLimitFailureCount: number
	nonRateLimitFailureCount: number
}> {
	const prioritizedHubs = options.prioritizedEntries
	if (prioritizedHubs.length === 0) {
		return {
			sovereigntyHubs: [],
			pruneCandidateIds: [...(options.pruneCandidateIds ?? [])],
			failures: [],
			failureCount: 0,
			rateLimitFailureCount: 0,
			nonRateLimitFailureCount: 0,
		}
	}

	const hubs: Array<{ index: number; hub: EsiSovereigntyHub }> = []
	const failures: Array<{ structureId: string; error: string }> = []
	let rateLimitFailureCount = 0
	let nonRateLimitFailureCount = 0

	for (let index = 0; index < prioritizedHubs.length; index += SOVEREIGNTY_HUB_DETAIL_BATCH_SIZE) {
		const batch = prioritizedHubs.slice(index, index + SOVEREIGNTY_HUB_DETAIL_BATCH_SIZE)
		let rateLimitEncountered = false
		const settled = await Promise.allSettled(
			batch.map(async ({ entry }) => {
				const detail = await esi.fetchCorporationSovereigntyHubDetail(
					corporationId,
					String(entry.id)
				)

				return {
					structure_id: String(detail.id),
					corporation_id: corporationId,
					system_id: String(detail.solar_system_id),
					name: null,
					type_id: SOVEREIGNTY_HUB_TYPE_ID,
					fuel_access_list_id:
						detail.fuel_access_list_id !== undefined && detail.fuel_access_list_id !== null
							? String(detail.fuel_access_list_id)
							: null,
					reagent_bay: {
						last_updated: detail.reagent_bay.last_updated,
						reagents: detail.reagent_bay.reagents.map((reagent) => ({
							type_id: String(reagent.type_id),
							amount: reagent.amount,
							burning_per_hour: reagent.burning_per_hour,
							last_cycle: reagent.last_cycle,
						})),
					},
					resources: detail.resources,
					upgrades: detail.upgrades.map((upgrade) => ({
						type_id: String(upgrade.type_id),
						power_state: upgrade.power_state,
					})),
					vulnerability_window: detail.vulnerability_window ?? null,
					workforce_transport: {
						configuration: detail.workforce_transport.configuration,
						state: detail.workforce_transport.state,
					},
					raw: {
						detail,
					},
				} as EsiSovereigntyHub
			})
		)

		for (let resultIndex = 0; resultIndex < settled.length; resultIndex += 1) {
			const result = settled[resultIndex]
			const source = batch[resultIndex]
			if (result.status === 'fulfilled') {
				hubs.push({
					index: source.index,
					hub: result.value,
				})
				continue
			}

			if (isRateLimitEsiError(result.reason)) {
				rateLimitFailureCount += 1
				rateLimitEncountered = true
			} else {
				nonRateLimitFailureCount += 1
			}
			failures.push({
				structureId: String(source.entry.id),
				error: result.reason instanceof Error ? result.reason.message : String(result.reason),
			})
		}

		if (rateLimitEncountered) {
			break
		}
	}

	if (failures.length > 0) {
		logger.warn('[ESI Fetch] Sovereignty hub detail fetch completed with partial failures', {
			corporationId,
			successCount: hubs.length,
			failureCount: failures.length,
			failures: failures.slice(0, 10),
		})
	}

	return {
		sovereigntyHubs: hubs.sort((a, b) => a.index - b.index).map((entry) => entry.hub),
		pruneCandidateIds: [...(options.pruneCandidateIds ?? [])],
		failures: failures.map(({ structureId, error }) => ({
			structureId,
			failureReason: error.slice(0, 1000),
		})),
		failureCount: failures.length,
		rateLimitFailureCount,
		nonRateLimitFailureCount,
	}
}

export async function fetchCorporationSkyhooks(
	esi: Esi,
	corporationId: string,
	options: {
		prioritizedEntries: ReadonlyArray<{
			index: number
			entry: { id: number; planet_id: number }
		}>
		pruneCandidateIds?: readonly string[]
	}
): Promise<{
	skyhooks: EsiCorporationSkyhook[]
	pruneCandidateIds: string[]
	failures: StructureEnrichmentFailure[]
	failureCount: number
	rateLimitFailureCount: number
	nonRateLimitFailureCount: number
}> {
	const prioritizedListing = options.prioritizedEntries

	if (prioritizedListing.length === 0) {
		return {
			skyhooks: [],
			pruneCandidateIds: [...(options.pruneCandidateIds ?? [])],
			failures: [],
			failureCount: 0,
			rateLimitFailureCount: 0,
			nonRateLimitFailureCount: 0,
		}
	}

	const skyhooks: Array<{ index: number; skyhook: EsiCorporationSkyhook }> = []
	const failures: Array<{ structureId: string; error: string }> = []
	let rateLimitFailureCount = 0
	let nonRateLimitFailureCount = 0

	for (let index = 0; index < prioritizedListing.length; index += SKYHOOK_DETAIL_BATCH_SIZE) {
		const batch = prioritizedListing.slice(index, index + SKYHOOK_DETAIL_BATCH_SIZE)
		let rateLimitEncountered = false
		const settled = await Promise.allSettled(
			batch.map(async ({ entry }) => {
				const detail = await esi.fetchCorporationSkyhookDetail(corporationId, String(entry.id))
				const theftVulnerability = detail.theft_vulnerability ?? null

				return {
					structure_id: String(detail.id),
					planet_id: String(detail.planet_id),
					corporation_id: String(corporationId),
					state: detail.state,
					is_active: detail.is_active,
					effective_workforce: detail.effective_workforce ?? null,
					reagents:
						detail.reagents?.map((reagent) => ({
							type_id: String(reagent.type_id),
							secured_stock: reagent.secured_stock,
							unsecured_stock: reagent.unsecured_stock,
							last_cycle: reagent.last_cycle,
						})) ?? [],
					reinforcement_timer: detail.reinforcement_timer ?? null,
					theft_vulnerability: theftVulnerability,
					raw: {
						listing: entry,
						detail,
					},
				} as EsiCorporationSkyhook
			})
		)

		for (let resultIndex = 0; resultIndex < settled.length; resultIndex += 1) {
			const result = settled[resultIndex]
			const source = batch[resultIndex]
			if (result.status === 'fulfilled') {
				skyhooks.push({
					index: source.index,
					skyhook: result.value,
				})
				continue
			}

			if (isRateLimitEsiError(result.reason)) {
				rateLimitFailureCount += 1
				rateLimitEncountered = true
			} else {
				nonRateLimitFailureCount += 1
			}
			failures.push({
				structureId: String(source.entry.id),
				error: result.reason instanceof Error ? result.reason.message : String(result.reason),
			})
		}

		if (rateLimitEncountered) {
			break
		}
	}

	if (failures.length > 0) {
		logger.warn('[ESI Fetch] Skyhook detail fetch completed with partial failures', {
			corporationId,
			successCount: skyhooks.length,
			failureCount: failures.length,
			failures: failures.slice(0, 10),
		})
	}

	return {
		skyhooks: skyhooks.sort((a, b) => a.index - b.index).map((entry) => entry.skyhook),
		pruneCandidateIds: [...(options.pruneCandidateIds ?? [])],
		failures: failures.map(({ structureId, error }) => ({
			structureId,
			failureReason: error.slice(0, 1000),
		})),
		failureCount: failures.length,
		rateLimitFailureCount,
		nonRateLimitFailureCount,
	}
}

/**
 * Fetch corporation mining extraction timers from ESI for mining citadels.
 */
export async function fetchCorporationMiningExtractions(
	esi: Esi,
	corporationId: string,
	_characterId: string
): Promise<EsiCorporationMiningExtraction[]> {
	const result = await esi.fetchCorporationMiningExtractions(corporationId)
	return result.map((extraction) => {
		return {
			structure_id: String(extraction.structure_id),
			moon_id: String(extraction.moon_id),
			extraction_start_time: extraction.extraction_start_time,
			chunk_arrival_time: extraction.chunk_arrival_time,
			natural_decay_time: extraction.natural_decay_time,
			raw: extraction as unknown as Record<string, unknown>,
		}
	})
}

// ========================================================================
// MARKET DATA FETCHING
// ========================================================================

/**
 * Fetch corporation market orders from ESI
 */
export async function fetchOrders(
	esi: Esi,
	corporationId: string,
	_characterId: string
): Promise<EsiCorporationOrder[]> {
	return await esi.fetchCorporationOrders(corporationId)
}

/**
 * Fetch corporation contracts from ESI
 */
export async function fetchContracts(
	esi: Esi,
	corporationId: string,
	_characterId: string
): Promise<EsiCorporationContract[]> {
	return await esi.fetchCorporationContracts(corporationId)
}

/**
 * Fetch corporation industry jobs from ESI
 */
export async function fetchIndustryJobs(
	esi: Esi,
	corporationId: string,
	_characterId: string
): Promise<EsiCorporationIndustryJob[]> {
	return await esi.fetchCorporationIndustryJobs(corporationId)
}

// ========================================================================
// COMBAT DATA FETCHING
// ========================================================================

/**
 * Fetch corporation killmails from ESI
 */
export async function fetchKillmails(
	esi: Esi,
	corporationId: string,
	_characterId: string
): Promise<EsiCorporationKillmail[]> {
	return await esi.fetchCorporationKillmails(corporationId)
}
