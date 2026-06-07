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
	EsiCorporationOrder,
	EsiCorporationStructure,
	EsiCorporationWallet,
	EsiCorporationWalletJournalEntry,
	EsiCorporationWalletTransaction,
} from '@repo/eve-corporation-data'
import type { EsiResponse, EveTokenStore } from '@repo/eve-token-store'

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

	return transformStructures(response.data)
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
