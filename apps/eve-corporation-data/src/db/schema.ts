import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from 'drizzle-orm/pg-core'

import {
	structureMoonDrills,
	structureMoonGeographies,
	structureMiningExtractions,
	structureSkyhooks,
	structureSovereigntyHubs,
	structureSovereigntySystems,
} from '@repo/structures-db-schema'

export {
	structureMoonDrills,
	structureMoonGeographies,
	structureMiningExtractions,
	structureSkyhooks,
	structureSovereigntyHubs,
	structureSovereigntySystems,
} from '@repo/structures-db-schema'

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

export const corporationTypeEnum = pgEnum('corporation_type', [
	'member',
	'alt',
	'special_purpose',
	'other',
])

/**
 * Configuration table - tracks corporation metadata
 * Director characters are now stored in corporationDirectors table
 */
export const corporationConfig = pgTable(
	'corporation_config',
	{
		corporationId: text('corporation_id').primaryKey(),
		lastVerified: timestamp('last_verified', { withTimezone: true }),
		isVerified: boolean('is_verified').default(false).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
		includeInBackgroundRefresh: boolean('include_in_background_refresh').default(false).notNull(),
		includeInStructureAssetSync: boolean('include_in_structure_asset_sync').default(false).notNull(),
		corporationType: corporationTypeEnum('corporation_type').default('other').notNull(),
		membersLastSync: timestamp('members_last_sync', { withTimezone: true }),
		memberTrackingLastSync: timestamp('member_tracking_last_sync', { withTimezone: true }),
		walletsLastSync: timestamp('wallets_last_sync', { withTimezone: true }),
		walletJournalLastSync: timestamp('wallet_journal_last_sync', { withTimezone: true }),
		walletTransactionsLastSync: timestamp('wallet_transactions_last_sync', { withTimezone: true }),
		assetsLastSync: timestamp('assets_last_sync', { withTimezone: true }),
		structuresLastSync: timestamp('structures_last_sync', { withTimezone: true }),
		ordersLastSync: timestamp('orders_last_sync', { withTimezone: true }),
		contractsLastSync: timestamp('contracts_last_sync', { withTimezone: true }),
		industryJobsLastSync: timestamp('industry_jobs_last_sync', { withTimezone: true }),
		killmailsLastSync: timestamp('killmails_last_sync', { withTimezone: true }),
	},
	(table) => [
		index('corporation_config_include_in_background_refresh_idx').on(
			table.includeInBackgroundRefresh
		),
		index('corporation_config_include_in_structure_asset_sync_idx').on(
			table.includeInStructureAssetSync
		),
		index('corporation_config_corporation_type_idx').on(table.corporationType),
		index('corporation_config_member_tracking_last_sync_idx').on(table.memberTrackingLastSync),
		index('corporation_config_wallets_last_sync_idx').on(table.walletsLastSync),
		index('corporation_config_assets_last_sync_idx').on(table.assetsLastSync),
		index('corporation_config_structures_last_sync_idx').on(table.structuresLastSync),
		index('corporation_config_orders_last_sync_idx').on(table.ordersLastSync),
		index('corporation_config_contracts_last_sync_idx').on(table.contractsLastSync),
		index('corporation_config_industry_jobs_last_sync_idx').on(table.industryJobsLastSync),
		index('corporation_config_killmails_last_sync_idx').on(table.killmailsLastSync),
		index('corporation_config_members_last_sync_idx').on(table.membersLastSync),
		index('corporation_config_wallet_transactions_last_sync_idx').on(
			table.walletTransactionsLastSync
		),
		index('corporation_config_wallet_journal_last_sync_idx').on(table.walletJournalLastSync),
	]
)

/**
 * Corporation directors table - manages multiple director characters per corporation
 * Supports automatic failover and load balancing across healthy directors
 */
export const corporationDirectors = pgTable(
	'corporation_directors',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		characterId: text('character_id').notNull(),
		characterName: text('character_name').notNull(),
		/** Priority for director selection (lower = higher priority, used for tie-breaking) */
		priority: integer('priority').default(100).notNull(),
		/** Whether this director is currently healthy (has valid token and roles) */
		isHealthy: boolean('is_healthy').default(true).notNull(),
		/** Last time health was checked */
		lastHealthCheck: timestamp('last_health_check', { withTimezone: true }),
		/** Last time this director was used for an ESI request */
		lastUsed: timestamp('last_used', { withTimezone: true }),
		/** Consecutive failure count (reset to 0 on success) */
		failureCount: integer('failure_count').default(0).notNull(),
		/** Last failure reason (for debugging) */
		lastFailureReason: text('last_failure_reason'),
		/** Earliest time this director should be retried for health/auth checks */
		nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
		/** Marks director as terminally invalid until explicit operator intervention */
		permanentFailureAt: timestamp('permanent_failure_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique().on(table.corporationId, table.characterId),
		// Index for finding healthy directors efficiently
		index('corporation_directors_corp_healthy_idx').on(table.corporationId, table.isHealthy),
		index('corporation_directors_corp_next_retry_idx').on(table.corporationId, table.nextRetryAt),
		index('corporation_directors_corp_permanent_failure_idx').on(
			table.corporationId,
			table.permanentFailureAt
		),
		// Index for selecting least-recently-used director
		index('corporation_directors_last_used_idx').on(table.corporationId, table.lastUsed),
	]
)

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
		corporationId: text('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		characterId: text('character_id').notNull(),
		roles: jsonb('roles').notNull().$type<string[]>(),
		rolesAtHq: jsonb('roles_at_hq').$type<string[]>(),
		rolesAtBase: jsonb('roles_at_base').$type<string[]>(),
		rolesAtOther: jsonb('roles_at_other').$type<string[]>(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.characterId)]
)

// ============================================================================
// PUBLIC CORPORATION DATA
// ============================================================================

/**
 * Public corporation information
 * Accessible without authentication
 */
export const corporationPublicInfo = pgTable('corporation_public_info', {
	corporationId: text('corporation_id').primaryKey(),
	name: text('name').notNull(),
	ticker: text('ticker').notNull(),
	ceoId: text('ceo_id').notNull(),
	creatorId: text('creator_id').notNull(),
	dateFounded: timestamp('date_founded', { withTimezone: true }),
	description: text('description'),
	homeStationId: text('home_station_id'),
	memberCount: integer('member_count').notNull(),
	shares: text('shares'),
	taxRate: text('tax_rate').notNull(), // Stored as string to avoid floating point issues
	url: text('url'),
	allianceId: text('alliance_id'),
	factionId: text('faction_id'),
	warEligible: boolean('war_eligible').default(false),
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
		corporationId: text('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		characterId: text('character_id').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique().on(table.corporationId, table.characterId),
		index('corporation_members_character_id_idx').on(table.characterId),
	]
)

/**
 * Corporation member tracking (join dates, etc.)
 * Requires scope: esi-corporations.track_members.v1
 */
export const corporationMemberTracking = pgTable(
	'corporation_member_tracking',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId, { onDelete: 'cascade' }),
		characterId: text('character_id').notNull(),
		baseId: text('base_id'),
		locationId: text('location_id'),
		logoffDate: timestamp('logoff_date', { withTimezone: true }),
		logonDate: timestamp('logon_date', { withTimezone: true }),
		shipTypeId: text('ship_type_id'),
		startDate: timestamp('start_date', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.characterId)]
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
		corporationId: text('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		division: integer('division').notNull(), // 1-7
		balance: text('balance').notNull(), // Stored as string to avoid precision loss
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.division)]
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
		corporationId: text('corporation_id')
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
		firstPartyId: text('first_party_id'),
		reason: text('reason'),
		refType: text('ref_type').notNull(),
		secondPartyId: text('second_party_id'),
		tax: text('tax'),
		taxReceiverId: text('tax_receiver_id'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.division, table.journalId)]
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
		corporationId: text('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		division: integer('division').notNull(),
		transactionId: text('transaction_id').notNull(),
		clientId: text('client_id').notNull(),
		date: timestamp('date', { withTimezone: true }).notNull(),
		isBuy: boolean('is_buy').default(false).notNull(),
		isPersonal: boolean('is_personal').default(false).notNull(),
		journalRefId: text('journal_ref_id').notNull(),
		locationId: text('location_id').notNull(),
		quantity: integer('quantity').notNull(),
		typeId: text('type_id').notNull(),
		unitPrice: text('unit_price').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.division, table.transactionId)]
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
		corporationId: text('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		itemId: text('item_id').notNull(),
		isSingleton: boolean('is_singleton').default(false).notNull(),
		locationFlag: text('location_flag').notNull(),
		locationId: text('location_id').notNull(),
		locationType: text('location_type').notNull(),
		quantity: integer('quantity').notNull(),
		typeId: text('type_id').notNull(),
		isBlueprintCopy: boolean('is_blueprint_copy').default(false),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.itemId)]
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
		corporationId: text('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId, { onDelete: 'cascade' }),
		structureId: text('structure_id').notNull(),
		name: text('name'),
		typeId: text('type_id').notNull(),
		typeName: text('type_name'),
		systemId: text('system_id').notNull(),
		systemName: text('system_name'),
		regionId: text('region_id'),
		regionName: text('region_name'),
		profileId: text('profile_id').notNull(),
		fuelExpires: timestamp('fuel_expires', { withTimezone: true }),
		fuelAmount: integer('fuel_amount'),
		lastRefilledAt: timestamp('last_refilled_at', { withTimezone: true }),
		nextReinforceApply: timestamp('next_reinforce_apply', { withTimezone: true }),
		nextReinforceHour: integer('next_reinforce_hour'),
		reinforceHour: integer('reinforce_hour'),
		state: text('state').notNull(),
		stateTimerEnd: timestamp('state_timer_end', { withTimezone: true }),
		stateTimerStart: timestamp('state_timer_start', { withTimezone: true }),
		unanchorsAt: timestamp('unanchors_at', { withTimezone: true }),
		lowPower: boolean('low_power').notNull().default(false),
		syncStatus: text('sync_status', { enum: ['ok', 'warning', 'error'] }).notNull().default('ok'),
		syncFailureReason: text('sync_failure_reason'),
		lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
		services: jsonb('services').$type<
			Array<{
				name: string
				state: string
			}>
		>(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.structureId)]
)

export const corporationStructureInventory = pgTable(
	'corporation_structure_inventory',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		structureId: text('structure_id')
			.notNull()
			.references(() => corporationStructures.structureId, { onDelete: 'cascade' }),
		itemId: text('item_id').notNull(),
		isSingleton: boolean('is_singleton').default(false).notNull(),
		locationFlag: text('location_flag').notNull(),
		locationType: text('location_type').notNull(),
		quantity: integer('quantity').notNull(),
		typeId: text('type_id').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique().on(table.corporationId, table.itemId),
		index('corporation_structure_inventory_corp_structure_idx').on(
			table.corporationId,
			table.structureId
		),
	]
)

export const structureFuelLog = pgTable(
	'structure_fuel_log',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId, { onDelete: 'cascade' }),
		structureId: text('structure_id')
			.notNull()
			.references(() => corporationStructures.structureId, { onDelete: 'cascade' }),
		fuelBlockUnits: integer('fuel_block_units').notNull(),
		observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('structure_fuel_log_corp_structure_observed_idx').on(
			table.corporationId,
			table.structureId,
			table.observedAt
		),
	]
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
		corporationId: text('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		orderId: text('order_id').notNull(),
		duration: integer('duration').notNull(),
		escrow: text('escrow'),
		isBuyOrder: boolean('is_buy_order').default(false).notNull(),
		issued: timestamp('issued', { withTimezone: true }).notNull(),
		issuedBy: text('issued_by').notNull(),
		locationId: text('location_id').notNull(),
		minVolume: integer('min_volume'),
		price: text('price').notNull(),
		range: text('range').notNull(),
		regionId: text('region_id').notNull(),
		typeId: text('type_id').notNull(),
		volumeRemain: integer('volume_remain').notNull(),
		volumeTotal: integer('volume_total').notNull(),
		walletDivision: integer('wallet_division').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.orderId)]
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
		contractId: text('contract_id').notNull(),
		acceptorId: text('acceptor_id'),
		assigneeId: text('assignee_id').notNull(),
		availability: text('availability').notNull(),
		buyout: text('buyout'),
		collateral: text('collateral'),
		dateAccepted: timestamp('date_accepted', { withTimezone: true }),
		dateCompleted: timestamp('date_completed', { withTimezone: true }),
		dateExpired: timestamp('date_expired', { withTimezone: true }).notNull(),
		dateIssued: timestamp('date_issued', { withTimezone: true }).notNull(),
		daysToComplete: integer('days_to_complete'),
		endLocationId: text('end_location_id'),
		forCorporation: boolean('for_corporation').default(false).notNull(),
		issuerCorporationId: text('issuer_corporation_id').notNull(),
		issuerId: text('issuer_id').notNull(),
		price: text('price'),
		reward: text('reward'),
		startLocationId: text('start_location_id'),
		status: text('status').notNull(),
		title: text('title'),
		type: text('type').notNull(),
		volume: text('volume'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique().on(table.contractId),
		index('corporation_contracts_leaderboard_all_time_idx').on(
			table.assigneeId,
			table.type,
			table.status,
			table.acceptorId
		),
		index('corporation_contracts_leaderboard_period_idx').on(
			table.assigneeId,
			table.type,
			table.status,
			table.dateCompleted,
			table.acceptorId
		),
	]
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
		corporationId: text('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		jobId: text('job_id').notNull(),
		installerId: text('installer_id').notNull(),
		facilityId: text('facility_id').notNull(),
		locationId: text('location_id').notNull(),
		activityId: text('activity_id').notNull(),
		blueprintId: text('blueprint_id').notNull(),
		blueprintTypeId: text('blueprint_type_id').notNull(),
		blueprintLocationId: text('blueprint_location_id').notNull(),
		outputLocationId: text('output_location_id').notNull(),
		runs: integer('runs').notNull(),
		cost: text('cost'),
		licensedRuns: integer('licensed_runs'),
		probability: text('probability'),
		productTypeId: text('product_type_id'),
		status: text('status').notNull(),
		duration: integer('duration').notNull(),
		startDate: timestamp('start_date', { withTimezone: true }).notNull(),
		endDate: timestamp('end_date', { withTimezone: true }).notNull(),
		pauseDate: timestamp('pause_date', { withTimezone: true }),
		completedDate: timestamp('completed_date', { withTimezone: true }),
		completedCharacterId: text('completed_character_id'),
		successfulRuns: integer('successful_runs'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.jobId)]
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
		corporationId: text('corporation_id')
			.notNull()
			.references(() => corporationConfig.corporationId),
		killmailId: text('killmail_id').notNull(),
		killmailHash: text('killmail_hash').notNull(),
		killmailTime: timestamp('killmail_time', { withTimezone: true }).notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.corporationId, table.killmailId)]
)

// ============================================================================
// SCHEMA EXPORT
// ============================================================================

export const schema = {
	corporationConfig,
	corporationDirectors,
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
	structureSovereigntySystems,
	structureSovereigntyHubs,
	structureSkyhooks,
	structureMoonDrills,
	structureMoonGeographies,
	structureMiningExtractions,
	corporationStructureInventory,
	structureFuelLog,
}
