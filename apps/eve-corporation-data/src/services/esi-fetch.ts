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

	// ESI returns numeric IDs at runtime despite our type definitions
	const data = response.data as any

	return {
		corporationId: String(corporationId),
		name: data.name,
		ticker: data.ticker,
		ceoId: String(data.ceo_id),
		creatorId: String(data.creator_id),
		dateFounded: data.date_founded ? new Date(data.date_founded) : null,
		description: data.description || null,
		homeStationId: data.home_station_id ? String(data.home_station_id) : null,
		memberCount: data.member_count,
		shares: data.shares ? data.shares.toString() : null,
		taxRate: data.tax_rate.toString(),
		url: data.url || null,
		allianceId: data.alliance_id ? String(data.alliance_id) : null,
		factionId: data.faction_id ? String(data.faction_id) : null,
		warEligible: data.war_eligible,
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
		characterId
	)

	// Convert numeric IDs to strings
	return response.data.map(String)
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
	>(`/corporations/${corporationId}/membertracking`, characterId)

	// Convert numeric IDs to strings
	return response.data.map((member) => ({
		character_id: String(member.character_id),
		base_id: member.base_id ? String(member.base_id) : undefined,
		location_id: member.location_id ? String(member.location_id) : undefined,
		logoff_date: member.logoff_date,
		logon_date: member.logon_date,
		ship_type_id: member.ship_type_id ? String(member.ship_type_id) : undefined,
		start_date: member.start_date,
	}))
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
	const response: EsiResponse<EsiCorporationWallet[]> = await tokenStore.fetchEsi(
		`/corporations/${corporationId}/wallets`,
		characterId
	)

	return response.data
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

	using result = await tokenStore.fetchEsiAllPages<RawJournalEntry>(
		`/corporations/${corporationId}/wallets/${division}/journal`,
		characterId
	)

	// Return in the format expected by the storage layer
	// The storage layer will handle string conversions
	return result.data as any
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
	>(`/corporations/${corporationId}/wallets/${division}/transactions`, characterId)

	// Convert numeric IDs to strings
	return response.data.map((tx) => ({
		transaction_id: String(tx.transaction_id),
		client_id: String(tx.client_id),
		date: tx.date,
		is_buy: tx.is_buy,
		is_personal: tx.is_personal,
		journal_ref_id: String(tx.journal_ref_id),
		location_id: String(tx.location_id),
		quantity: tx.quantity,
		type_id: String(tx.type_id),
		unit_price: String(tx.unit_price),
	}))
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

	using result = await tokenStore.fetchEsiAllPages<RawAsset>(
		`/corporations/${corporationId}/assets`,
		characterId
	)

	// Convert numeric IDs to strings
	return result.data.map((asset) => ({
		item_id: String(asset.item_id),
		is_singleton: asset.is_singleton,
		location_flag: asset.location_flag,
		location_id: String(asset.location_id),
		location_type: asset.location_type,
		quantity: asset.quantity,
		type_id: String(asset.type_id),
		is_blueprint_copy: asset.is_blueprint_copy,
	}))
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

	// Convert numeric IDs to strings
	return response.data.map((structure) => ({
		structure_id: String(structure.structure_id),
		type_id: String(structure.type_id),
		system_id: String(structure.system_id),
		profile_id: String(structure.profile_id),
		fuel_expires: structure.fuel_expires,
		next_reinforce_apply: structure.next_reinforce_apply,
		next_reinforce_hour: structure.next_reinforce_hour,
		reinforce_hour: structure.reinforce_hour,
		state: structure.state,
		state_timer_end: structure.state_timer_end,
		state_timer_start: structure.state_timer_start,
		unanchors_at: structure.unanchors_at,
		services: structure.services,
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
	>(`/corporations/${corporationId}/orders`, characterId)

	// Convert numeric IDs to strings
	return response.data.map((order) => ({
		order_id: String(order.order_id),
		duration: order.duration,
		escrow: order.escrow,
		is_buy_order: order.is_buy_order,
		issued: order.issued,
		issued_by: String(order.issued_by),
		location_id: String(order.location_id),
		min_volume: order.min_volume,
		price: order.price,
		range: order.range,
		region_id: String(order.region_id),
		type_id: String(order.type_id),
		volume_remain: order.volume_remain,
		volume_total: order.volume_total,
		wallet_division: order.wallet_division,
	}))
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
	>(`/corporations/${corporationId}/contracts`, characterId)

	// Convert numeric IDs to strings
	return response.data.map((contract) => ({
		contract_id: String(contract.contract_id),
		acceptor_id: contract.acceptor_id ? String(contract.acceptor_id) : undefined,
		assignee_id: String(contract.assignee_id),
		availability: contract.availability,
		buyout: contract.buyout,
		collateral: contract.collateral,
		date_accepted: contract.date_accepted,
		date_completed: contract.date_completed,
		date_expired: contract.date_expired,
		date_issued: contract.date_issued,
		days_to_complete: contract.days_to_complete,
		end_location_id: contract.end_location_id ? String(contract.end_location_id) : undefined,
		for_corporation: contract.for_corporation,
		issuer_corporation_id: String(contract.issuer_corporation_id),
		issuer_id: String(contract.issuer_id),
		price: contract.price,
		reward: contract.reward,
		start_location_id: contract.start_location_id
			? String(contract.start_location_id)
			: undefined,
		status: contract.status,
		title: contract.title,
		type: contract.type,
		volume: contract.volume,
	}))
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
	>(`/corporations/${corporationId}/industry/jobs`, characterId)

	// Convert numeric IDs to strings
	return response.data.map((job) => ({
		job_id: String(job.job_id),
		installer_id: String(job.installer_id),
		facility_id: String(job.facility_id),
		location_id: String(job.location_id),
		activity_id: String(job.activity_id),
		blueprint_id: String(job.blueprint_id),
		blueprint_type_id: String(job.blueprint_type_id),
		blueprint_location_id: String(job.blueprint_location_id),
		output_location_id: String(job.output_location_id),
		runs: job.runs,
		cost: job.cost,
		licensed_runs: job.licensed_runs,
		probability: job.probability,
		product_type_id: job.product_type_id ? String(job.product_type_id) : undefined,
		status: job.status,
		duration: job.duration,
		start_date: job.start_date,
		end_date: job.end_date,
		pause_date: job.pause_date,
		completed_date: job.completed_date,
		completed_character_id: job.completed_character_id
			? String(job.completed_character_id)
			: undefined,
		successful_runs: job.successful_runs,
	}))
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

	// Convert numeric IDs to strings
	return response.data.map((km) => ({
		killmail_id: String(km.killmail_id),
		killmail_hash: km.killmail_hash,
	}))
}
