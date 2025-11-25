/**
 * Corporation-related ESI Response Types
 *
 * Type definitions for corporation-related ESI API responses.
 * These types match the EVE Online ESI API format (snake_case).
 */

// ============================================================================
// CORPORATION TYPES - ESI
// ============================================================================

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

/**
 * ESI Corporation Contact
 * GET /corporations/{corporation_id}/contacts
 */
export interface EsiCorporationContact {
	contact_id: number
	contact_type: 'character' | 'corporation' | 'alliance' | 'faction'
	is_watched?: boolean
	label_ids?: number[]
	standing: number
}

/**
 * ESI Corporation Division
 * GET /corporations/{corporation_id}/divisions
 */
export interface EsiCorporationDivision {
	hangar?: Array<{
		division: number
		name: string
	}>
	wallet?: Array<{
		division: number
		name: string
	}>
}

/**
 * ESI Corporation Facility
 * GET /corporations/{corporation_id}/facilities
 */
export interface EsiCorporationFacility {
	facility_id: number
	system_id: number
	type_id: number
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

/**
 * ESI Corporation Icon
 * GET /corporations/{corporation_id}/icons
 */
export interface EsiCorporationIcon {
	px64x64?: string
	px128x128?: string
	px256x256?: string
}

/**
 * ESI Corporation Public Info
 * GET /corporations/{corporation_id}
 */
export interface EsiCorporationPublicInfo {
	alliance_id?: number
	ceo_id: number
	creator_id: number
	date_founded?: string
	description?: string
	faction_id?: number
	home_station_id?: number
	member_count?: number
	name: string
	shares?: number
	tax_rate: number
	ticker: string
	url?: string
	war_eligible?: boolean
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

/**
 * ESI Corporation Killmail
 * GET /corporations/{corporation_id}/killmails/recent
 */
export interface EsiCorporationKillmail {
	killmail_id: number
	killmail_hash: string
}

/**
 * ESI Corporation Medal
 * GET /corporations/{corporation_id}/medals
 */
export interface EsiCorporationMedal {
	created_at: string
	creator_id: number
	description: string
	medal_id: number
	title: string
}

/**
 * ESI Corporation Members Response
 * GET /corporations/{corporation_id}/members
 */
export type EsiCorporationMembers = number[]

/**
 * ESI Corporation Member Tracking Response
 * GET /corporations/{corporation_id}/membertracking
 */
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

/**
 * ESI Corporation Role
 * GET /corporations/{corporation_id}/roles
 */
export interface EsiCorporationRole {
	character_id: number
	grantable_roles?: string[]
	roles?: string[]
	roles_at_base?: string[]
	roles_at_hq?: string[]
	roles_at_other?: string[]
}

export interface EsiCorporationMemberRole extends EsiCorporationRole {
	grantable_roles_at_base?: string[]
	grantable_roles_at_hq?: string[]
	grantable_roles_at_other?: string[]
}

/**
 * ESI Corporation Shareholder
 * GET /corporations/{corporation_id}/shareholders
 */
export interface EsiCorporationShareholder {
	share_count: number
	shareholder_id: number
	shareholder_type: 'character' | 'corporation'
}

/**
 * ESI Corporation Standing
 * GET /corporations/{corporation_id}/standings
 */
export interface EsiCorporationStanding {
	from_id: number
	from_type: 'agent' | 'npc_corp' | 'faction'
	standing: number
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

/**
 * ESI Corporation Wallets Response
 * GET /corporations/{corporation_id}/wallets
 */
export interface EsiCorporationWallet {
	division: number
	balance: number
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

/**
 * ESI Corporation Title
 * GET /corporations/{corporation_id}/titles
 */
export interface EsiCorporationTitle {
	grantable_roles?: string[]
	name?: string
	roles?: string[]
	roles_at_base?: string[]
	roles_at_hq?: string[]
	roles_at_other?: string[]
	title_id?: number
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

// ============================================================================
// CORPORATION TYPES - TRANSFORMED
// ============================================================================

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

export interface CorporationKillmail {
	killmail_id: string
	killmail_hash: string
}

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

export interface CorporationWallet {
	division: number
	balance: string // String to avoid bigint precision issues with large ISK amounts
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

export interface CorporationPublicInfo {
	alliance_id?: string
	ceo_id: string
	creator_id: string
	date_founded?: string
	description?: string
	faction_id?: string
	home_station_id?: string
	member_count?: string
	name: string
	shares?: string
	tax_rate: string
	ticker: string
	url?: string
	war_eligible?: boolean
}

export interface CorporationContact {
	contact_id: string
	contact_type: 'character' | 'corporation' | 'alliance' | 'faction'
	is_watched?: boolean
	label_ids?: string[]
	standing: number
}

export interface CorporationDivision {
	hangar?: Array<{
		division: number
		name: string
	}>
	wallet?: Array<{
		division: number
		name: string
	}>
}

export interface CorporationFacility {
	facility_id: string
	system_id: string
	type_id: string
}

export interface CorporationIcon {
	px64x64?: string
	px128x128?: string
	px256x256?: string
}

export interface CorporationMedal {
	created_at: string
	creator_id: string
	description: string
	medal_id: string
	title: string
}

export interface CorporationRole {
	character_id: string
	grantable_roles?: string[]
	roles?: string[]
	roles_at_base?: string[]
	roles_at_hq?: string[]
	roles_at_other?: string[]
}

export interface CorporationMemberRole extends CorporationRole {
	grantable_roles_at_base?: string[]
	grantable_roles_at_hq?: string[]
	grantable_roles_at_other?: string[]
}

export interface CorporationShareholder {
	share_count: number
	shareholder_id: string
	shareholder_type: 'character' | 'corporation'
}

export interface CorporationStanding {
	from_id: string
	from_type: 'agent' | 'npc_corp' | 'faction'
	standing: number
}

export interface CorporationTitle {
	grantable_roles?: string[]
	name?: string
	roles?: string[]
	roles_at_base?: string[]
	roles_at_hq?: string[]
	roles_at_other?: string[]
	title_id?: string
}
