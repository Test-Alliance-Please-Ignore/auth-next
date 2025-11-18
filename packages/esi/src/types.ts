/**
 * ESI Response Types
 *
 * Type definitions for ESI API responses.
 * These types match the EVE Online ESI API format (snake_case).
 */

/**
 * ESI Corporation Members Response
 * GET /corporations/{corporation_id}/members
 */
export type EsiCorporationMembers = number[]
export type CorporationMembers = string[]

/**
 * ESI Corporation Member Tracking Response
 * GET /corporations/{corporation_id}/membertracking
 */
export interface CorporationMemberTracking {
	character_id: string
	base_id?: string
	location_id?: string
	logoff_date?: string
	logon_date?: string
	ship_type_id?: string
	start_date?: string
}

export interface EsiCorporationMemberTracking {
	character_id: number
	base_id?: number
	location_id?: number
	logoff_date?: string
	logon_date?: string
	ship_type_id?: number
	start_date?: string
}

/**
 * ESI Corporation Wallets Response
 * GET /corporations/{corporation_id}/wallets
 */
export interface EsiCorporationWallet {
	division: number
	balance: number
}

export interface CorporationWallet {
	division: number
	balance: string // String to avoid bigint precision issues with large ISK amounts
}

/**
 * ESI Corporation Wallet Journal Entry
 * GET /corporations/{corporation_id}/wallets/{division}/journal
 */
export interface EsiCorporationWalletJournalEntry {
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

export interface CorporationWalletJournalEntry {
	id: string
	amount?: string // String to avoid bigint precision issues
	balance?: string // String to avoid bigint precision issues
	context_id?: string
	context_id_type?: string
	date: string
	description: string
	first_party_id?: string
	reason?: string
	ref_type: string
	second_party_id?: string
	tax?: string // String to avoid bigint precision issues
	tax_receiver_id?: string
}

/**
 * ESI Corporation Wallet Transaction
 * GET /corporations/{corporation_id}/wallets/{division}/transactions
 */
export interface EsiCorporationWalletTransaction {
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
}

export interface CorporationWalletTransaction {
	transaction_id: string
	client_id: string
	date: string
	is_buy: boolean
	is_personal: boolean
	journal_ref_id: string
	location_id: string
	quantity: number
	type_id: string
	unit_price: string
}

/**
 * ESI Corporation Asset
 * GET /corporations/{corporation_id}/assets
 */
export interface EsiCorporationAsset {
	item_id: number
	is_singleton: boolean
	location_flag: string
	location_id: number
	location_type: string
	quantity: number
	type_id: number
	is_blueprint_copy?: boolean
}

export interface CorporationAsset {
	item_id: string
	is_singleton: boolean
	location_flag: string
	location_id: string
	location_type: string
	quantity: number
	type_id: string
	is_blueprint_copy?: boolean
}

/**
 * ESI Corporation Structure
 * GET /corporations/{corporation_id}/structures
 */
export interface EsiCorporationStructure {
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
}

export interface CorporationStructure {
	structure_id: string
	type_id: string
	system_id: string
	profile_id: string
	fuel_expires?: string
	next_reinforce_apply?: string
	next_reinforce_hour?: number
	reinforce_hour?: number
	state: string
	state_timer_end?: string
	state_timer_start?: string
	unanchors_at?: string
	services?: Array<{
		name: string
		state: string
	}>
}

/**
 * ESI Corporation Market Order
 * GET /corporations/{corporation_id}/orders
 */
export interface EsiCorporationOrder {
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
}

export interface CorporationOrder {
	order_id: string
	duration: number
	escrow?: number
	is_buy_order: boolean
	issued: string
	issued_by: string
	location_id: string
	min_volume?: number
	price: number
	range: string
	region_id: string
	type_id: string
	volume_remain: number
	volume_total: number
	wallet_division: number
}

/**
 * ESI Corporation Contract
 * GET /corporations/{corporation_id}/contracts
 */
export interface EsiCorporationContract {
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
}

export interface CorporationContract {
	contract_id: string
	acceptor_id?: string
	assignee_id: string
	availability: string
	buyout?: number
	collateral?: number
	date_accepted?: string
	date_completed?: string
	date_expired: string
	date_issued: string
	days_to_complete?: number
	end_location_id?: string
	for_corporation: boolean
	issuer_corporation_id: string
	issuer_id: string
	price?: number
	reward?: number
	start_location_id?: string
	status: string
	title?: string
	type: string
	volume?: number
}

/**
 * ESI Corporation Industry Job
 * GET /corporations/{corporation_id}/industry/jobs
 */
export interface EsiCorporationIndustryJob {
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
}

export interface CorporationIndustryJob {
	job_id: string
	installer_id: string
	facility_id: string
	location_id: string
	activity_id: string
	blueprint_id: string
	blueprint_type_id: string
	blueprint_location_id: string
	output_location_id: string
	runs: number
	cost?: number
	licensed_runs?: number
	probability?: number
	product_type_id?: string
	status: string
	duration: number
	start_date: string
	end_date: string
	pause_date?: string
	completed_date?: string
	completed_character_id?: string
	successful_runs?: number
}

/**
 * ESI Corporation Killmail
 * GET /corporations/{corporation_id}/killmails/recent
 */
export interface EsiCorporationKillmail {
	killmail_id: number
	killmail_hash: string
}

export interface CorporationKillmail {
	killmail_id: string
	killmail_hash: string
}
