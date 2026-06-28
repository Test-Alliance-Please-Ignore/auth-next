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
	EsiSovereigntyHub,
	EsiSovereigntySystem,
	EsiCorporationWallet,
	EsiCorporationWalletJournalEntry,
	EsiCorporationWalletTransaction,
} from '@repo/eve-corporation-data'
import type { EsiResponse, EveTokenStore } from '@repo/eve-token-store'

type RawUniverseStructureInfo = {
	name: string | null
	owner_id: number
	position: {
		x: number
		y: number
		z: number
	}
	solar_system_id: number
	type_id: number
}

function getUniverseStructureCorporationId(universe: RawUniverseStructureInfo): string {
	return String(universe.owner_id)
}

async function fetchUniverseStructureMetadata(
	tokenStore: EveTokenStore,
	structureId: string,
	characterId: string,
	context: 'sovereignty hub' | 'skyhook'
): Promise<RawUniverseStructureInfo | null> {
	try {
		const result = await tokenStore.fetchEsi<RawUniverseStructureInfo>(
			`/universe/structures/${structureId}`,
			characterId,
			{ cacheMode: 'no-store' }
		)
		return result.data
	} catch (error) {
		const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
		if (message.includes('403') || message.includes('404')) {
			logger.warn(`[ESI Fetch] Skipping ${context} enrichment for inaccessible universe metadata`, {
				structureId,
				characterId,
				error: error instanceof Error ? error.message : String(error),
			})
			return null
		}

		throw error
	}
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
	const response = await tokenStore.fetchPublicEsi<any>(`/corporations/${corporationId}`)

	return {
		corporationId: String(corporationId),
		...transformPublicInfo(response.data),
	}
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
	const response = await tokenStore.fetchEsi<number[]>(
		`/corporations/${corporationId}/members`,
		characterId,
		{ cacheMode: 'no-store' }
	)

	return transformMembers(response.data)
}

/**
 * Fetch member tracking data from ESI
 */
export async function fetchMemberTracking(
	tokenStore: EveTokenStore,
	corporationId: string,
	characterId: string
): Promise<EsiCorporationMemberTracking[]> {
	const response = await tokenStore.fetchEsi<
		Array<{
			character_id: number
			base_id?: number
			location_id?: number
			logoff_date?: string
			logon_date?: string
			ship_type_id?: number
			start_date?: string
		}>
	>(`/corporations/${corporationId}/membertracking`, characterId, { cacheMode: 'no-store' })

	return transformMemberTracking(response.data)
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
	const response = await tokenStore.fetchEsi<Array<{ division: number; balance: number }>>(
		`/corporations/${corporationId}/wallets`,
		characterId,
		{ cacheMode: 'no-store' }
	)

	return transformWallets(response.data)
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

	const result = await tokenStore.fetchEsiAllPages<RawJournalEntry>(
		`/corporations/${corporationId}/wallets/${division}/journal`,
		characterId,
		{ cacheMode: 'no-store' }
	)

	return transformWalletJournal(result.data)
}

/**
 * Fetch wallet transactions for a division from ESI
 */
export async function fetchWalletTransactions(
	tokenStore: EveTokenStore,
	corporationId: string,
	division: number,
	characterId: string
): Promise<EsiCorporationWalletTransaction[]> {
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
	>(
		`/corporations/${corporationId}/wallets/${division}/transactions`,
		characterId,
		{ cacheMode: 'no-store' }
	)

	return transformWalletTransactions(response.data)
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

	return transformAssets(result.data)
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

	return transformStructures(response.data, corporationId)
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
		'/sovereignty/systems'
	)

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
}

export async function fetchSovereigntyHubs(
	tokenStore: EveTokenStore,
	corporationId: string,
	characterId: string
): Promise<EsiSovereigntyHub[]> {
	type RawSovereigntyHubsListing = {
		sovereignty_hubs: Array<{
			id: number
			solar_system_id: number
		}>
	}

	type RawSovereigntyHubDetail = {
		id: number
		solar_system_id: number
		fuel_access_list_id?: number | null
		reagent_bay: {
			last_updated: string
			reagents: Array<{
				type_id: number
				secured_stock: number
				unsecured_stock: number
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
								amount: number
								solar_system_id?: number
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
								solar_system_id?: number
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

	const firstPage = await tokenStore.fetchEsi<RawSovereigntyHubsListing>(
		`/corporations/${corporationId}/structures/sovereignty-hubs?page=1`,
		characterId,
		{ cacheMode: 'no-store' }
	)
	const sovereigntyHubs = [...firstPage.data.sovereignty_hubs]

	for (let page = 2; page <= (firstPage.pages ?? 1); page += 1) {
		const pageResponse = await tokenStore.fetchEsi<RawSovereigntyHubsListing>(
			`/corporations/${corporationId}/structures/sovereignty-hubs?page=${page}`,
			characterId,
			{ cacheMode: 'no-store' }
		)
		sovereigntyHubs.push(...pageResponse.data.sovereignty_hubs)
	}

	if (sovereigntyHubs.length === 0) {
		return []
	}

	const details: Array<EsiSovereigntyHub | null> = await Promise.all(
		sovereigntyHubs.map(async (hub) => {
			const universe = await fetchUniverseStructureMetadata(
				tokenStore,
				String(hub.id),
				characterId,
				'sovereignty hub'
			)
			if (!universe) {
				return null
			}
			const universeCorporationId = getUniverseStructureCorporationId(universe)

			if (universeCorporationId !== corporationId) {
				logger.warn('[ESI Fetch] Skipping sovereignty hub enrichment for mismatched owner', {
					corporationId,
					structureId: String(hub.id),
					universeCorporationId,
				})
				return null
			}

			const detailResult = await tokenStore.fetchEsi<RawSovereigntyHubDetail>(
				`/corporations/${corporationId}/structures/sovereignty-hubs/${hub.id}`,
				characterId,
				{ cacheMode: 'no-store' }
			)

			const detail = detailResult.data

			return {
				structure_id: String(detail.id),
				corporation_id: universeCorporationId,
				system_id: String(detail.solar_system_id),
				name: universe.name ?? null,
				type_id: String(universe.type_id),
				fuel_access_list_id:
					detail.fuel_access_list_id !== undefined && detail.fuel_access_list_id !== null
						? String(detail.fuel_access_list_id)
						: null,
				reagent_bay: {
					last_updated: detail.reagent_bay.last_updated,
					reagents: detail.reagent_bay.reagents.map((reagent) => ({
						type_id: String(reagent.type_id),
						secured_stock: reagent.secured_stock,
						unsecured_stock: reagent.unsecured_stock,
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
					universe,
				},
			} as EsiSovereigntyHub
		})
	)

	return details.filter((hub): hub is EsiSovereigntyHub => hub !== null)
}

export async function fetchCorporationSkyhooks(
	tokenStore: EveTokenStore,
	corporationId: string,
	characterId: string
): Promise<EsiCorporationSkyhook[]> {
	type RawCorporationSkyhooksListing = {
		skyhooks: Array<{
			id: number
			planet_id: number
		}>
	}

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

	const listing = await tokenStore.fetchEsi<RawCorporationSkyhooksListing>(
		`/corporations/${corporationId}/structures/skyhooks?page=1`,
		characterId,
		{ cacheMode: 'no-store' }
	)

	const skyhookListing = [...listing.data.skyhooks]
	for (let page = 2; page <= (listing.pages ?? 1); page += 1) {
		const pageResponse = await tokenStore.fetchEsi<RawCorporationSkyhooksListing>(
			`/corporations/${corporationId}/structures/skyhooks?page=${page}`,
			characterId,
			{ cacheMode: 'no-store' }
		)
		skyhookListing.push(...pageResponse.data.skyhooks)
	}

	if (skyhookListing.length === 0) {
		return []
	}

	const nowMs = Date.now()

	const skyhooks: Array<EsiCorporationSkyhook | null> = await Promise.all(
		skyhookListing.map(async (skyhook) => {
			const detailResult = await tokenStore.fetchEsi<RawCorporationSkyhookDetail>(
				`/corporations/${corporationId}/structures/skyhooks/${skyhook.id}`,
				characterId,
				{ cacheMode: 'no-store' }
			)

			const detail = detailResult.data
			const theftVulnerability = detail.theft_vulnerability ?? null
			const becomesRaidableAt = theftVulnerability?.start
				? new Date(theftVulnerability.start)
				: null
			const vulnerableAt = theftVulnerability?.end ? new Date(theftVulnerability.end) : null
			const isRaidable =
				becomesRaidableAt !== null &&
				vulnerableAt !== null &&
				!Number.isNaN(becomesRaidableAt.getTime()) &&
				!Number.isNaN(vulnerableAt.getTime()) &&
				nowMs >= becomesRaidableAt.getTime() &&
				nowMs <= vulnerableAt.getTime()

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
				is_raidable: isRaidable,
				becomes_raidable_at: becomesRaidableAt?.toISOString() ?? null,
				vulnerable_at: vulnerableAt?.toISOString() ?? null,
				raw: {
					listing: skyhook,
					detail,
				},
			} as EsiCorporationSkyhook
		})
	)

	return skyhooks.filter((skyhook): skyhook is EsiCorporationSkyhook => skyhook !== null)
}

/**
 * Fetch corporation moon extraction timers from ESI.
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

	return result.data.map((extraction) => ({
		structure_id: String(extraction.structure_id),
		moon_id: String(extraction.moon_id),
		extraction_start_time: extraction.extraction_start_time,
		chunk_arrival_time: extraction.chunk_arrival_time,
		natural_decay_time: extraction.natural_decay_time,
		raw: extraction as Record<string, unknown>,
	}))
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

	return transformOrders(response.data)
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
	>(
		`/corporations/${corporationId}/contracts`,
		characterId,
		{ cacheMode: 'no-store' }
	)

	return transformContracts(response.data)
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
	>(
		`/corporations/${corporationId}/industry/jobs`,
		characterId,
		{ cacheMode: 'no-store' }
	)

	return transformIndustryJobs(response.data)
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

	return transformKillmails(response.data)
}
