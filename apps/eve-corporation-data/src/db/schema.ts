import { boolean, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

/**
 * Database schema for the eve-corporation-data worker
 *
 * Stores EVE Online corporation data fetched from ESI API.
 * Each table follows patterns from eve-character-data:
 * - camelCase for TypeScript field names
 * - snake_case for SQL column names
 * - Timestamps for all tables
 * - Proper indexes and constraints
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Configuration table - maps corporation to authorized character
 * Each corporation has one configured character for API access
 */
export const corporationConfig = pgTable('corporation_config', {
	corporationId: integer('corporation_id').primaryKey(),
	characterId: integer('character_id').notNull(),
	characterName: text('character_name').notNull(),
	lastVerified: timestamp('last_verified', { withTimezone: true }),
	isVerified: boolean('is_verified').default(false).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ============================================================================
// CHARACTER ROLES (for verification)
// ============================================================================

/**
 * Cached corporation roles for character verification
 * Used to check if character has required roles before fetching sensitive data
 */
export const characterCorporationRoles = pgTable(
	'character_corporation_roles',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: integer('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		characterId: integer('character_id').notNull(),
		roles: jsonb('roles').notNull().$type<string[]>(),
		rolesAtHq: jsonb('roles_at_hq').$type<string[]>(),
		rolesAtBase: jsonb('roles_at_base').$type<string[]>(),
		rolesAtOther: jsonb('roles_at_other').$type<string[]>(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.characterId)],
)

// ============================================================================
// PUBLIC CORPORATION DATA
// ============================================================================

/**
 * Public corporation information
 * Accessible without authentication
 */
export const corporationPublicInfo = pgTable('corporation_public_info', {
	corporationId: integer('corporation_id').primaryKey(),
	name: text('name').notNull(),
	ticker: text('ticker').notNull(),
	ceoId: integer('ceo_id').notNull(),
	creatorId: integer('creator_id').notNull(),
	dateFounded: timestamp('date_founded', { withTimezone: true }),
	description: text('description'),
	homeStationId: integer('home_station_id'),
	memberCount: integer('member_count').notNull(),
	shares: text('shares'),
	taxRate: text('tax_rate').notNull(), // Stored as string to avoid floating point issues
	url: text('url'),
	allianceId: integer('alliance_id'),
	factionId: integer('faction_id'),
	warEligible: boolean('war_eligible'),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ============================================================================
// CORPORATION MEMBERS
// ============================================================================

/**
 * Corporation member roster
 * Requires scope: esi-corporations.read_corporation_membership.v1
 */
export const corporationMembers = pgTable(
	'corporation_members',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: integer('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		characterId: integer('character_id').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.characterId)],
)

/**
 * Corporation member tracking (join dates, etc.)
 * Requires scope: esi-corporations.track_members.v1
 */
export const corporationMemberTracking = pgTable(
	'corporation_member_tracking',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: integer('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		characterId: integer('character_id').notNull(),
		baseId: integer('base_id'),
		locationId: text('location_id'),
		logoffDate: timestamp('logoff_date', { withTimezone: true }),
		logonDate: timestamp('logon_date', { withTimezone: true }),
		shipTypeId: integer('ship_type_id'),
		startDate: timestamp('start_date', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.characterId)],
)

// ============================================================================
// FINANCIAL DATA
// ============================================================================

/**
 * Corporation wallet divisions (7 divisions max)
 * Requires scope: esi-wallet.read_corporation_wallets.v1
 * Requires role: Accountant or Junior_Accountant
 */
export const corporationWallets = pgTable(
	'corporation_wallets',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: integer('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		division: integer('division').notNull(), // 1-7
		balance: text('balance').notNull(), // Stored as string to avoid precision loss
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.division)],
)

/**
 * Corporation wallet journal entries
 * Requires scope: esi-wallet.read_corporation_wallets.v1
 * Requires role: Accountant or Junior_Accountant
 */
export const corporationWalletJournal = pgTable(
	'corporation_wallet_journal',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: integer('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		division: integer('division').notNull(),
		journalId: text('journal_id').notNull(),
		amount: text('amount'),
		balance: text('balance'),
		contextId: text('context_id'),
		contextIdType: text('context_id_type'),
		date: timestamp('date', { withTimezone: true }).notNull(),
		description: text('description').notNull(),
		firstPartyId: integer('first_party_id'),
		reason: text('reason'),
		refType: text('ref_type').notNull(),
		secondPartyId: integer('second_party_id'),
		tax: text('tax'),
		taxReceiverId: integer('tax_receiver_id'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.division, table.journalId)],
)

/**
 * Corporation wallet transactions (market buy/sell)
 * Requires scope: esi-wallet.read_corporation_wallets.v1
 * Requires role: Accountant or Junior_Accountant
 */
export const corporationWalletTransactions = pgTable(
	'corporation_wallet_transactions',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: integer('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		division: integer('division').notNull(),
		transactionId: text('transaction_id').notNull(),
		clientId: integer('client_id').notNull(),
		date: timestamp('date', { withTimezone: true }).notNull(),
		isBuy: boolean('is_buy').notNull(),
		isPersonal: boolean('is_personal').notNull(),
		journalRefId: text('journal_ref_id').notNull(),
		locationId: text('location_id').notNull(),
		quantity: integer('quantity').notNull(),
		typeId: integer('type_id').notNull(),
		unitPrice: text('unit_price').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.division, table.transactionId)],
)

// ============================================================================
// ASSETS & STRUCTURES
// ============================================================================

/**
 * Corporation assets
 * Requires scope: esi-assets.read_corporation_assets.v1
 * Requires role: Director
 */
export const corporationAssets = pgTable(
	'corporation_assets',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: integer('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		itemId: text('item_id').notNull(),
		isSingleton: boolean('is_singleton').notNull(),
		locationFlag: text('location_flag').notNull(),
		locationId: text('location_id').notNull(),
		locationType: text('location_type').notNull(),
		quantity: integer('quantity').notNull(),
		typeId: integer('type_id').notNull(),
		isBlueprintCopy: boolean('is_blueprint_copy'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.itemId)],
)

/**
 * Corporation structures (citadels, refineries, etc.)
 * Requires scope: esi-corporations.read_structures.v1
 * Requires role: Station_Manager
 */
export const corporationStructures = pgTable(
	'corporation_structures',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: integer('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		structureId: text('structure_id').notNull(),
		typeId: integer('type_id').notNull(),
		systemId: integer('system_id').notNull(),
		profileId: integer('profile_id').notNull(),
		fuelExpires: timestamp('fuel_expires', { withTimezone: true }),
		nextReinforceApply: timestamp('next_reinforce_apply', { withTimezone: true }),
		nextReinforceHour: integer('next_reinforce_hour'),
		reinforceHour: integer('reinforce_hour'),
		state: text('state').notNull(),
		stateTimerEnd: timestamp('state_timer_end', { withTimezone: true }),
		stateTimerStart: timestamp('state_timer_start', { withTimezone: true }),
		unanchorsAt: timestamp('unanchors_at', { withTimezone: true }),
		services: jsonb('services').$type<
			Array<{
				name: string
				state: string
			}>
		>(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.structureId)],
)

// ============================================================================
// MARKET & INDUSTRY
// ============================================================================

/**
 * Corporation market orders
 * Requires scope: esi-markets.read_corporation_orders.v1
 * Requires role: Accountant, Junior_Accountant, or Trader
 */
export const corporationOrders = pgTable(
	'corporation_orders',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: integer('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		orderId: text('order_id').notNull(),
		duration: integer('duration').notNull(),
		escrow: text('escrow'),
		isBuyOrder: boolean('is_buy_order').notNull(),
		issued: timestamp('issued', { withTimezone: true }).notNull(),
		issuedBy: integer('issued_by').notNull(),
		locationId: text('location_id').notNull(),
		minVolume: integer('min_volume'),
		price: text('price').notNull(),
		range: text('range').notNull(),
		regionId: integer('region_id').notNull(),
		typeId: integer('type_id').notNull(),
		volumeRemain: integer('volume_remain').notNull(),
		volumeTotal: integer('volume_total').notNull(),
		walletDivision: integer('wallet_division').notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.orderId)],
)

/**
 * Corporation contracts
 * Requires scope: esi-contracts.read_corporation_contracts.v1
 * Requires role: Director
 */
export const corporationContracts = pgTable(
	'corporation_contracts',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: integer('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		contractId: integer('contract_id').notNull(),
		acceptorId: integer('acceptor_id'),
		assigneeId: integer('assignee_id').notNull(),
		availability: text('availability').notNull(),
		buyout: text('buyout'),
		collateral: text('collateral'),
		dateAccepted: timestamp('date_accepted', { withTimezone: true }),
		dateCompleted: timestamp('date_completed', { withTimezone: true }),
		dateExpired: timestamp('date_expired', { withTimezone: true }).notNull(),
		dateIssued: timestamp('date_issued', { withTimezone: true }).notNull(),
		daysToComplete: integer('days_to_complete'),
		endLocationId: text('end_location_id'),
		forCorporation: boolean('for_corporation').notNull(),
		issuerCorporationId: integer('issuer_corporation_id').notNull(),
		issuerId: integer('issuer_id').notNull(),
		price: text('price'),
		reward: text('reward'),
		startLocationId: text('start_location_id'),
		status: text('status').notNull(),
		title: text('title'),
		type: text('type').notNull(),
		volume: text('volume'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.contractId)],
)

/**
 * Corporation industry jobs
 * Requires scope: esi-industry.read_corporation_jobs.v1
 * Requires role: Factory_Manager
 */
export const corporationIndustryJobs = pgTable(
	'corporation_industry_jobs',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: integer('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		jobId: integer('job_id').notNull(),
		installerId: integer('installer_id').notNull(),
		facilityId: text('facility_id').notNull(),
		locationId: text('location_id').notNull(),
		activityId: integer('activity_id').notNull(),
		blueprintId: text('blueprint_id').notNull(),
		blueprintTypeId: integer('blueprint_type_id').notNull(),
		blueprintLocationId: text('blueprint_location_id').notNull(),
		outputLocationId: text('output_location_id').notNull(),
		runs: integer('runs').notNull(),
		cost: text('cost'),
		licensedRuns: integer('licensed_runs'),
		probability: text('probability'),
		productTypeId: integer('product_type_id'),
		status: text('status').notNull(),
		duration: integer('duration').notNull(),
		startDate: timestamp('start_date', { withTimezone: true }).notNull(),
		endDate: timestamp('end_date', { withTimezone: true }).notNull(),
		pauseDate: timestamp('pause_date', { withTimezone: true }),
		completedDate: timestamp('completed_date', { withTimezone: true }),
		completedCharacterId: integer('completed_character_id'),
		successfulRuns: integer('successful_runs'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.jobId)],
)

// ============================================================================
// KILLMAILS
// ============================================================================

/**
 * Corporation killmails (recent kills and losses)
 * Requires scope: esi-killmails.read_corporation_killmails.v1
 * Requires role: Director
 */
export const corporationKillmails = pgTable(
	'corporation_killmails',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: integer('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		killmailId: integer('killmail_id').notNull(),
		killmailHash: text('killmail_hash').notNull(),
		killmailTime: timestamp('killmail_time', { withTimezone: true }).notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.killmailId)],
)

// ============================================================================
// SCHEMA EXPORT
// ============================================================================

export const schema = {
	corporationConfig,
	characterCorporationRoles,
	corporationPublicInfo,
	corporationMembers,
	corporationMemberTracking,
	corporationWallets,
	corporationWalletJournal,
	corporationWalletTransactions,
	corporationAssets,
	corporationStructures,
	corporationOrders,
	corporationContracts,
	corporationIndustryJobs,
	corporationKillmails,
}
