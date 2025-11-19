/**
 * Character-related ESI Response Types
 *
 * Type definitions for character-related ESI API responses.
 * These types match the EVE Online ESI API format (snake_case).
 */

// ============================================================================
// CHARACTER TYPES - ESI
// ============================================================================

/**
 * Character agent research from ESI
 * GET /characters/{character_id}/agents_research
 */
export interface EsiCharacterAgentResearch {
	agent_id: number
	points_per_day: number
	remainder_points: number
	skill_type_id: number
	started_at: string
}

/**
 * Character assets from ESI
 * GET /characters/{character_id}/assets
 */
export interface EsiCharacterAsset {
	is_blueprint_copy?: boolean
	is_singleton: boolean
	item_id: number
	location_flag: string
	location_id: number
	location_type: 'station' | 'solar_system' | 'item' | 'other'
	quantity: number
	type_id: number
}

/**
 * Character attributes from ESI
 * GET /characters/{character_id}/attributes
 */
export interface EsiCharacterAttributes {
	accrued_remap_cooldown_date?: string
	bonus_remaps?: number
	charisma: number
	intelligence: number
	last_remap_date?: string
	memory: number
	perception: number
	willpower: number
}

/**
 * Character blueprints from ESI
 * GET /characters/{character_id}/blueprints
 */
export interface EsiCharacterBlueprint {
	item_id: number
	location_flag: string
	location_id: number
	material_efficiency: number
	quantity: number
	runs: number
	time_efficiency: number
	type_id: number
}

/**
 * Character calendar from ESI
 * GET /characters/{character_id}/calendar
 */
export interface EsiCharacterCalendar {
	event_date: string
	event_id: number
	event_response?: 'declined' | 'not_responded' | 'accepted' | 'tentative'
	importance: number
	title: string
}

/**
 * Character contacts from ESI
 * GET /characters/{character_id}/contacts
 */
export interface EsiCharacterContact {
	contact_id: number
	contact_type: 'character' | 'corporation' | 'alliance' | 'faction'
	is_blocked?: boolean
	is_watched?: boolean
	label_ids?: number[]
	standing: number
}

/**
 * Character contracts from ESI
 * GET /characters/{character_id}/contracts
 */
export interface EsiCharacterContract {
	acceptor_id?: number
	assignee_id: number
	availability: 'public' | 'personal' | 'corporation' | 'alliance'
	buyout?: number
	collateral?: number
	contract_id: number
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
	status:
		| 'outstanding'
		| 'in_progress'
		| 'finished_issuer'
		| 'finished_contractor'
		| 'finished'
		| 'cancelled'
		| 'rejected'
		| 'failed'
		| 'deleted'
		| 'reversed'
	title?: string
	type: 'unknown' | 'item_exchange' | 'auction' | 'courier' | 'loan'
	volume?: number
}

/**
 * Character fittings from ESI
 * GET /characters/{character_id}/fittings
 */
export interface EsiCharacterFitting {
	description: string
	fitting_id: number
	items: Array<{
		flag: string
		quantity: number
		type_id: number
	}>
	name: string
	ship_type_id: number
}

/**
 * Character location from ESI
 * GET /characters/{character_id}/location
 */
export interface EsiCharacterLocation {
	solar_system_id: number
	station_id?: number
	structure_id?: number
}

/**
 * Character mail from ESI
 * GET /characters/{character_id}/mail
 */
export interface EsiCharacterMail {
	from?: number
	is_read?: boolean
	labels?: number[]
	mail_id?: number
	recipients?: Array<{
		recipient_id: number
		recipient_type: 'alliance' | 'character' | 'corporation' | 'mailing_list'
	}>
	subject?: string
	timestamp?: string
}

/**
 * Character mining ledger from ESI
 * GET /characters/{character_id}/mining
 */
export interface EsiCharacterMiningLedger {
	date: string
	quantity: number
	solar_system_id: number
	type_id: number
}

/**
 * Character notification from ESI
 * GET /characters/{character_id}/notifications
 */
export interface EsiCharacterNotification {
	is_read: boolean
	notification_id: number
	sender_id: number
	sender_type: 'character' | 'corporation' | 'alliance' | 'faction' | 'other'
	text?: string
	timestamp: string
	type: string
}

/**
 * Character planets from ESI
 * GET /characters/{character_id}/planets
 */
export interface EsiCharacterPlanet {
	last_update: string
	num_pins: number
	owner_id: number
	planet_id: number
	planet_type: 'temperate' | 'barren' | 'oceanic' | 'ice' | 'gas' | 'lava' | 'storm' | 'plasma'
	solar_system_id: number
	upgrade_level: number
}

/**
 * Character portrait URLs from ESI
 * GET /characters/{character_id}/portrait
 */
export interface EsiCharacterPortrait {
	px64x64?: string
	px128x128?: string
	px256x256?: string
	px512x512?: string
}

/**
 * Character public information from ESI
 * GET /characters/{character_id}
 */
export interface EsiCharacterPublicInfo {
	alliance_id?: number
	birthday: string
	bloodline_id: number
	corporation_id: number
	description?: string
	faction_id?: number
	gender: 'male' | 'female'
	name: string
	race_id: number
	security_status?: number
	title?: string
}

/**
 * Character corporation roles from ESI
 * GET /characters/{character_id}/roles
 */
export interface EsiCharacterRoles {
	roles?: string[]
	roles_at_hq?: string[]
	roles_at_base?: string[]
	roles_at_other?: string[]
}

/**
 * Character skill queue from ESI
 * GET /characters/{character_id}/skillqueue
 */
export interface EsiCharacterSkillQueue {
	finish_date?: string
	finished_level: number
	level_end_sp?: number
	level_start_sp?: number
	queue_position: number
	skill_id: number
	start_date?: string
	training_start_sp?: number
}

/**
 * Character ship from ESI
 * GET /characters/{character_id}/ship
 */
export interface EsiCharacterShip {
	ship_item_id: number
	ship_name: string
	ship_type_id: number
}

/**
 * Character skills from ESI
 * GET /characters/{character_id}/skills
 */
export interface EsiCharacterSkills {
	skills: Array<{
		active_skill_level: number
		skill_id: number
		skillpoints_in_skill: number
		trained_skill_level: number
	}>
	total_sp: number
	unallocated_sp?: number
}

/**
 * Character standings from ESI
 * GET /characters/{character_id}/standings
 */
export interface EsiCharacterStanding {
	from_id: number
	from_type: 'agent' | 'npc_corp' | 'faction'
	standing: number
}

/**
 * Character titles from ESI
 * GET /characters/{character_id}/titles
 */
export interface EsiCharacterTitle {
	name?: string
	title_id?: number
}

/**
 * Single corporation history entry from ESI
 * GET /characters/{character_id}/corporationhistory
 */
export interface EsiCorporationHistoryEntry {
	corporation_id: number
	is_deleted?: boolean
	record_id: number
	start_date: string
}

/**
 * Character market order from ESI
 * GET /characters/{character_id}/orders
 */
export interface EsiCharacterMarketOrder {
	order_id: number
	type_id: number
	location_id: number
	is_buy_order?: boolean
	price: number
	volume_total: number
	volume_remain: number
	issued: string
	state: 'open' | 'closed' | 'expired' | 'cancelled'
	min_volume?: number
	range: string
	duration: number
	escrow?: number
	region_id: number
}

/**
 * Character market transaction from ESI
 * GET /characters/{character_id}/wallet/transactions
 */
export interface EsiCharacterMarketTransaction {
	transaction_id: number
	date: string
	type_id: number
	quantity: number
	unit_price: number
	client_id: number
	location_id: number
	is_buy: boolean
	is_personal: boolean
	journal_ref_id: number
}

/**
 * Character wallet journal entry from ESI
 * GET /characters/{character_id}/wallet/journal
 */
export interface EsiCharacterWalletJournalEntry {
	id: number
	date: string
	ref_type: string
	amount: number
	balance?: number
	description: string
	first_party_id?: number
	second_party_id?: number
	reason?: string
	tax?: number
	tax_receiver_id?: number
	context_id?: number
	context_id_type?: string
}

// ============================================================================
// CHARACTER TYPES - TRANSFORMED
// ============================================================================

export interface CharacterNotification {
	is_read: boolean
	notification_id: string
	sender_id: string
	sender_type: 'character' | 'corporation' | 'alliance' | 'faction' | 'other'
	text?: string
	timestamp: string
	type: string
}

export interface CharacterPublicInfo {
	alliance_id?: string
	birthday: string
	bloodline_id: string
	corporation_id: string
	description?: string
	faction_id?: string
	gender: 'male' | 'female'
	name: string
	race_id: string
	security_status?: string
	title?: string
}

export interface CharacterAgentResearch {
	agent_id: string
	points_per_day: number
	remainder_points: number
	skill_type_id: string
	started_at: string
}

export interface CharacterAsset {
	is_blueprint_copy?: boolean
	is_singleton: boolean
	item_id: string
	location_flag: string
	location_id: string
	location_type: 'station' | 'solar_system' | 'item' | 'other'
	quantity: number
	type_id: string
}

export interface CharacterAttributes {
	accrued_remap_cooldown_date?: string
	bonus_remaps?: number
	charisma: number
	intelligence: number
	last_remap_date?: string
	memory: number
	perception: number
	willpower: number
}

export interface CharacterBlueprint {
	item_id: string
	location_flag: string
	location_id: string
	material_efficiency: number
	quantity: number
	runs: number
	time_efficiency: number
	type_id: string
}

export interface CharacterCalendar {
	event_date: string
	event_id: string
	event_response?: 'declined' | 'not_responded' | 'accepted' | 'tentative'
	importance: number
	title: string
}

export interface CharacterContact {
	contact_id: string
	contact_type: 'character' | 'corporation' | 'alliance' | 'faction'
	is_blocked?: boolean
	is_watched?: boolean
	label_ids?: string[]
	standing: number
}

export interface CharacterContract {
	acceptor_id?: string
	assignee_id: string
	availability: 'public' | 'personal' | 'corporation' | 'alliance'
	buyout?: number
	collateral?: number
	contract_id: string
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
	status:
		| 'outstanding'
		| 'in_progress'
		| 'finished_issuer'
		| 'finished_contractor'
		| 'finished'
		| 'cancelled'
		| 'rejected'
		| 'failed'
		| 'deleted'
		| 'reversed'
	title?: string
	type: 'unknown' | 'item_exchange' | 'auction' | 'courier' | 'loan'
	volume?: number
}

export interface CharacterFitting {
	description: string
	fitting_id: string
	items: Array<{
		flag: string
		quantity: number
		type_id: string
	}>
	name: string
	ship_type_id: string
}

export interface CharacterLocation {
	solar_system_id: string
	station_id?: string
	structure_id?: string
}

export interface CharacterMail {
	from?: string
	is_read?: boolean
	labels?: string[]
	mail_id?: string
	recipients?: Array<{
		recipient_id: string
		recipient_type: 'alliance' | 'character' | 'corporation' | 'mailing_list'
	}>
	subject?: string
	timestamp?: string
}

export interface CharacterMiningLedger {
	date: string
	quantity: number
	solar_system_id: string
	type_id: string
}

export interface CharacterPlanet {
	last_update: string
	num_pins: number
	owner_id: string
	planet_id: string
	planet_type: 'temperate' | 'barren' | 'oceanic' | 'ice' | 'gas' | 'lava' | 'storm' | 'plasma'
	solar_system_id: string
	upgrade_level: number
}

export interface CharacterPortrait {
	px64x64?: string
	px128x128?: string
	px256x256?: string
	px512x512?: string
}

export interface CharacterRoles {
	roles?: string[]
	roles_at_hq?: string[]
	roles_at_base?: string[]
	roles_at_other?: string[]
}

export interface CharacterSkillQueue {
	finish_date?: string
	finished_level: number
	level_end_sp?: number
	level_start_sp?: number
	queue_position: number
	skill_id: string
	start_date?: string
	training_start_sp?: number
}

export interface CharacterShip {
	ship_item_id: string
	ship_name: string
	ship_type_id: string
}

export interface CharacterSkills {
	skills: Array<{
		active_skill_level: number
		skill_id: string
		skillpoints_in_skill: number
		trained_skill_level: number
	}>
	total_sp: number
	unallocated_sp?: number
}

export interface CharacterStanding {
	from_id: string
	from_type: 'agent' | 'npc_corp' | 'faction'
	standing: number
}

export interface CharacterTitle {
	name?: string
	title_id?: string
}

export interface CorporationHistoryEntry {
	corporation_id: string
	is_deleted?: boolean
	record_id: string
	start_date: string
}

export interface CharacterMarketOrder {
	order_id: string
	type_id: string
	location_id: string
	is_buy_order?: boolean
	price: number
	volume_total: number
	volume_remain: number
	issued: string
	state: 'open' | 'closed' | 'expired' | 'cancelled'
	min_volume?: number
	range: string
	duration: number
	escrow?: number
	region_id: string
}

export interface CharacterMarketTransaction {
	transaction_id: string
	date: string
	type_id: string
	quantity: number
	unit_price: number
	client_id: string
	location_id: string
	is_buy: boolean
	is_personal: boolean
	journal_ref_id: string
}

export interface CharacterWalletJournalEntry {
	id: string
	date: string
	ref_type: string
	amount: string
	balance?: string
	description: string
	first_party_id?: string
	second_party_id?: string
	reason?: string
	tax?: string
	tax_receiver_id?: string
	context_id?: string
	context_id_type?: string
}
