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

import { disposeRpcResult, withRpcResult } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'
import { parseDateOrNull } from '@repo/worker-utils'
import { parseEsiErrorMetadata } from '@repo/workflow-utils'

import {
	transformAssets,
	transformContracts,
	transformIndustryJobs,
	transformKillmails,
	transformMembers,
	transformMemberTracking,
	transformOrders,
	transformPublicInfo,
	transformStructures,
	transformWalletJournal,
	transformWallets,
	transformWalletTransactions,
} from '../lib/esi-transforms'

import type {
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
	WalletTransactionWatermark,
} from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'

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
	tokenStore: EveTokenStore,
	corporationId: string
): Promise<any> {
	return withRpcResult(
		tokenStore.fetchPublicEsi<any>(`/corporations/${corporationId}`, {
			cacheMode: 'no-store',
		}),
		(response) => ({
			corporationId: String(corporationId),
			...transformPublicInfo(response.data),
		})
	)
}

// ========================================================================
// CORE DATA FETCHING
// ========================================================================

/**
 * Fetch corporation members from ESI
 */
export async function fetchMembers(
	tokenStore: EveTokenStore,
	corporationId: string,
	characterId: string
): Promise<EsiCorporationMembers> {
	return withRpcResult(
		tokenStore.fetchEsi<number[]>(`/corporations/${corporationId}/members`, characterId, {
			cacheMode: 'no-store',
		}),
		(response) => transformMembers(response.data)
	)
}

/**
 * Fetch member tracking data from ESI
 */
export async function fetchMemberTracking(
	tokenStore: EveTokenStore,
	corporationId: string,
	characterId: string
): Promise<EsiCorporationMemberTracking[]> {
	return withRpcResult(
		tokenStore.fetchEsi<
			Array<{
				character_id: number
				base_id?: number
				location_id?: number
				logoff_date?: string
				logon_date?: string
				ship_type_id?: number
				start_date?: string
			}>
		>(`/corporations/${corporationId}/membertracking`, characterId, { cacheMode: 'no-store' }),
		(response) => transformMemberTracking(response.data)
	)
}

// ========================================================================
// FINANCIAL DATA FETCHING
// ========================================================================

/**
 * Fetch corporation wallets from ESI
 */
export async function fetchWallets(
	tokenStore: EveTokenStore,
	corporationId: string,
	characterId: string
): Promise<EsiCorporationWallet[]> {
	return withRpcResult(
		tokenStore.fetchEsi<Array<{ division: number; balance: number }>>(
			`/corporations/${corporationId}/wallets`,
			characterId,
			{ cacheMode: 'no-store' }
		),
		(response) => transformWallets(response.data)
	)
}

/**
 * Fetch wallet journal for a division from ESI
 */
export async function fetchWalletJournal(
	tokenStore: EveTokenStore,
	corporationId: string,
	division: number,
	characterId: string
): Promise<EsiCorporationWalletJournalEntry[]> {
	type RawJournalEntry = {
		id: number
		amount?: number
		balance?: number
		context_id?: number
		context_id_type?: string
		date: string
		description: string
		first_party_id?: number
		reason?: string
		ref_type: string
		second_party_id?: number
		tax?: number
		tax_receiver_id?: number
	}

	return withRpcResult(
		tokenStore.fetchEsiAllPages<RawJournalEntry>(
			`/corporations/${corporationId}/wallets/${division}/journal`,
			characterId,
			{ cacheMode: 'no-store' }
		),
		(result) => transformWalletJournal(result.data)
	)
}

/**
 * Fetch wallet transactions for a division from ESI
 */
export async function fetchWalletTransactions(
	tokenStore: EveTokenStore,
	corporationId: string,
	division: number,
	characterId: string,
	watermark?: WalletTransactionWatermark
): Promise<WalletTransactionsFetchResult> {
	const response = await tokenStore.fetchEsi<
		Array<{
			transaction_id: number
			client_id: number
			date: string
			is_buy: boolean
			is_personal: boolean
			journal_ref_id: number
			location_id: number
			quantity: number
			type_id: number
			unit_price: number
		}>
	>(`/corporations/${corporationId}/wallets/${division}/transactions`, characterId, {
		cacheMode: 'no-store',
	})

	try {
		return await fetchWalletTransactionsPages(
			tokenStore,
			corporationId,
			division,
			characterId,
			response,
			watermark
		)
	} finally {
		disposeRpcResult(response)
	}
}

async function fetchWalletTransactionsPages(
	tokenStore: EveTokenStore,
	corporationId: string,
	division: number,
	characterId: string,
	response: {
		data: Array<{
			transaction_id: number
			client_id: number
			date: string
			is_buy: boolean
			is_personal: boolean
			journal_ref_id: number
			location_id: number
			quantity: number
			type_id: number
			unit_price: number
		}>
	},
	watermark?: WalletTransactionWatermark
): Promise<WalletTransactionsFetchResult> {
	const basePath = `/corporations/${corporationId}/wallets/${division}/transactions`
	const transactions = new Map<string, EsiCorporationWalletTransaction>()
	let pageData = transformWalletTransactions(response.data)
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

			const nextResponse = await tokenStore.fetchEsi<typeof response.data>(
				`${basePath}?from_id=${encodeURIComponent(fromId)}`,
				characterId,
				{ cacheMode: 'no-store' }
			)
			try {
				pageData = transformWalletTransactions(nextResponse.data)
			} finally {
				disposeRpcResult(nextResponse)
			}
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
	tokenStore: EveTokenStore,
	corporationId: string,
	characterId: string
): Promise<EsiCorporationAsset[]> {
	type RawAsset = {
		item_id: number
		is_singleton: boolean
		location_flag: string
		location_id: number
		location_type: string
		quantity: number
		type_id: number
		is_blueprint_copy?: boolean
	}

	const result = await tokenStore.fetchEsiAllPages<RawAsset>(
		`/corporations/${corporationId}/assets`,
		characterId,
		{ cacheMode: 'no-store' }
	)

	try {
		return transformAssets(result.data)
	} finally {
		disposeRpcResult(result)
	}
}

/**
 * Fetch corporation structures from ESI
 */
export async function fetchStructures(
	tokenStore: EveTokenStore,
	corporationId: string,
	characterId: string
): Promise<EsiCorporationStructure[]> {
	const response = await tokenStore.fetchEsi<
		Array<{
			structure_id: number
			type_id: number
			system_id: number
			profile_id: number
			fuel_expires?: string
			next_reinforce_apply?: string
			next_reinforce_hour?: number
			reinforce_hour?: number
			state: string
			state_timer_end?: string
			state_timer_start?: string
			unanchors_at?: string
			services?: Array<{ name: string; state: string }>
		}>
	>(`/corporations/${corporationId}/structures`, characterId)

	try {
		return transformStructures(response.data, corporationId)
	} finally {
		disposeRpcResult(response)
	}
}

export async function fetchSovereigntySystems(
	tokenStore: EveTokenStore
): Promise<EsiSovereigntySystem[]> {
	type RawSovereigntySystemsResponse = {
		solar_systems: Array<
			| {
					solar_system_id: number
					claim: {
						alliance: {
							alliance_id: number
							corporation_id: number
							claimed_since: string
							is_capital_system: boolean
							sovereignty_hub: {
								id: number
								vulnerability_window?: {
									start: string
									end: string
								}
							}
							development: {
								activity_defense_multiplier: number
								military_level: number
								industrial_level: number
								strategic_level: number
							}
						}
					}
			  }
			| {
					solar_system_id: number
					claim: {
						faction: {
							faction_id: number
						}
					}
			  }
			| {
					solar_system_id: number
					claim: {
						unclaimed: boolean
					}
			  }
		>
	}

	const response = await tokenStore.fetchPublicEsi<RawSovereigntySystemsResponse>(
		'/sovereignty/systems',
		{ cacheMode: 'no-store' }
	)

	try {
		return response.data.solar_systems.map((system) => {
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
	} finally {
		disposeRpcResult(response)
	}
}

function isRateLimitEsiError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error)
	const metadata = parseEsiErrorMetadata(message)
	return metadata?.status === 429 || message.includes('429 Too Many Requests')
}

export async function fetchSovereigntyHubs(
	tokenStore: EveTokenStore,
	corporationId: string,
	characterId: string,
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
	type RawSovereigntyHubDetail = {
		id: number
		solar_system_id: number
		fuel_access_list_id?: number | null
		reagent_bay: {
			last_updated: string
			reagents: Array<{
				type_id: number
				amount: number
				burning_per_hour: number
				last_cycle: string
			}>
		}
		resources: {
			power: {
				allocated: number
				available: number
			}
			workforce: {
				allocated: number
				available: number
			}
		}
		upgrades: Array<{
			type_id: number
			power_state: string
		}>
		vulnerability_window?: {
			start: string
			end: string
		} | null
		workforce_transport: {
			configuration:
				| {
						import: {
							sources: Array<{
								solar_system_id: number
							}>
						}
				  }
				| {
						export: {
							amount: number
							solar_system_id?: number
						}
				  }
				| {
						transit: boolean | null
				  }
			state:
				| {
						import: {
							sources: Array<{
								amount: number
								solar_system_id: number
							}>
						}
				  }
				| {
						export: {
							amount: number
							solar_system_id?: number
						}
				  }
				| {
						transit: boolean | null
				  }
		}
	}

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
				const detailResult = await tokenStore.fetchEsi<RawSovereigntyHubDetail>(
					`/corporations/${corporationId}/structures/sovereignty-hubs/${entry.id}`,
					characterId,
					{ cacheMode: 'no-store' }
				)
				try {
					const detail = detailResult.data

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
				} finally {
					disposeRpcResult(detailResult)
				}
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
	tokenStore: EveTokenStore,
	corporationId: string,
	characterId: string,
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
	type RawCorporationSkyhookDetail = {
		id: number
		planet_id: number
		state: string
		is_active: boolean
		effective_workforce?: number | null
		reagents?: Array<{
			type_id: number
			secured_stock: number
			unsecured_stock: number
			last_cycle: string
		}>
		reinforcement_timer?: {
			end: string
		} | null
		theft_vulnerability?: {
			start: string
			end: string
		} | null
	}

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
				const detailResult = await tokenStore.fetchEsi<RawCorporationSkyhookDetail>(
					`/corporations/${corporationId}/structures/skyhooks/${entry.id}`,
					characterId,
					{ cacheMode: 'no-store' }
				)

				try {
					const detail = detailResult.data
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
				} finally {
					disposeRpcResult(detailResult)
				}
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
	tokenStore: EveTokenStore,
	corporationId: string,
	characterId: string
): Promise<EsiCorporationMiningExtraction[]> {
	type RawCorporationMiningExtraction = {
		structure_id: number
		moon_id: number
		extraction_start_time: string
		chunk_arrival_time: string
		natural_decay_time: string
	}

	const result = await tokenStore.fetchEsiAllPages<RawCorporationMiningExtraction>(
		`/corporation/${corporationId}/mining/extractions`,
		characterId,
		{ cacheMode: 'no-store' }
	)

	try {
		return result.data.map((extraction) => ({
			structure_id: String(extraction.structure_id),
			moon_id: String(extraction.moon_id),
			extraction_start_time: extraction.extraction_start_time,
			chunk_arrival_time: extraction.chunk_arrival_time,
			natural_decay_time: extraction.natural_decay_time,
			raw: extraction as Record<string, unknown>,
		}))
	} finally {
		disposeRpcResult(result)
	}
}

// ========================================================================
// MARKET DATA FETCHING
// ========================================================================

/**
 * Fetch corporation market orders from ESI
 */
export async function fetchOrders(
	tokenStore: EveTokenStore,
	corporationId: string,
	characterId: string
): Promise<EsiCorporationOrder[]> {
	const response = await tokenStore.fetchEsi<
		Array<{
			order_id: number
			duration: number
			escrow?: number
			is_buy_order: boolean
			issued: string
			issued_by: number
			location_id: number
			min_volume?: number
			price: number
			range: string
			region_id: number
			type_id: number
			volume_remain: number
			volume_total: number
			wallet_division: number
		}>
	>(`/corporations/${corporationId}/orders`, characterId, { cacheMode: 'no-store' })

	try {
		return transformOrders(response.data)
	} finally {
		disposeRpcResult(response)
	}
}

/**
 * Fetch corporation contracts from ESI
 */
export async function fetchContracts(
	tokenStore: EveTokenStore,
	corporationId: string,
	characterId: string
): Promise<EsiCorporationContract[]> {
	const response = await tokenStore.fetchEsi<
		Array<{
			contract_id: number
			acceptor_id?: number
			assignee_id: number
			availability: string
			buyout?: number
			collateral?: number
			date_accepted?: string
			date_completed?: string
			date_expired: string
			date_issued: string
			days_to_complete?: number
			end_location_id?: number
			for_corporation: boolean
			issuer_corporation_id: number
			issuer_id: number
			price?: number
			reward?: number
			start_location_id?: number
			status: string
			title?: string
			type: string
			volume?: number
		}>
	>(`/corporations/${corporationId}/contracts`, characterId, { cacheMode: 'no-store' })

	try {
		return transformContracts(response.data)
	} finally {
		disposeRpcResult(response)
	}
}

/**
 * Fetch corporation industry jobs from ESI
 */
export async function fetchIndustryJobs(
	tokenStore: EveTokenStore,
	corporationId: string,
	characterId: string
): Promise<EsiCorporationIndustryJob[]> {
	const response = await tokenStore.fetchEsi<
		Array<{
			job_id: number
			installer_id: number
			facility_id: number
			location_id: number
			activity_id: number
			blueprint_id: number
			blueprint_type_id: number
			blueprint_location_id: number
			output_location_id: number
			runs: number
			cost?: number
			licensed_runs?: number
			probability?: number
			product_type_id?: number
			status: string
			duration: number
			start_date: string
			end_date: string
			pause_date?: string
			completed_date?: string
			completed_character_id?: number
			successful_runs?: number
		}>
	>(`/corporations/${corporationId}/industry/jobs`, characterId, { cacheMode: 'no-store' })

	try {
		return transformIndustryJobs(response.data)
	} finally {
		disposeRpcResult(response)
	}
}

// ========================================================================
// COMBAT DATA FETCHING
// ========================================================================

/**
 * Fetch corporation killmails from ESI
 */
export async function fetchKillmails(
	tokenStore: EveTokenStore,
	corporationId: string,
	characterId: string
): Promise<EsiCorporationKillmail[]> {
	const response = await tokenStore.fetchEsi<
		Array<{
			killmail_id: number
			killmail_hash: string
		}>
	>(`/corporations/${corporationId}/killmails/recent`, characterId)

	try {
		return transformKillmails(response.data)
	} finally {
		disposeRpcResult(response)
	}
}
