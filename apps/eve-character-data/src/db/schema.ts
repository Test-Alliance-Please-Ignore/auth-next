import {
	boolean,
	integer,
	jsonb,
	pgTable,
	real,
	text,
	timestamp,
	unique,
	uuid,
} from 'drizzle-orm/pg-core'

/**
 * Database schema for the eve-character-data worker
 */

/**
 * Character public information
 */
export const characterPublicInfo = pgTable('character_public_info', {
	characterId: text('character_id').primaryKey(),
	name: text('name').notNull(),
	corporationId: text('corporation_id').notNull(),
	allianceId: text('alliance_id'),
	birthday: text('birthday').notNull(),
	raceId: text('race_id').notNull(),
	bloodlineId: text('bloodline_id').notNull(),
	securityStatus: real('security_status'),
	description: text('description'),
	gender: text('gender').notNull().$type<'male' | 'female'>(),
	factionId: text('faction_id'),
	title: text('title'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Character portrait URLs
 */
export const characterPortraits = pgTable('character_portraits', {
	characterId: text('character_id')
		.primaryKey()
		.references(() => characterPublicInfo.characterId),
	px64x64: text('px64x64'),
	px128x128: text('px128x128'),
	px256x256: text('px256x256'),
	px512x512: text('px512x512'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Character corporation history
 */
export const characterCorporationHistory = pgTable(
	'character_corporation_history',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		characterId: text('character_id')
			.notNull()
			.references(() => characterPublicInfo.characterId),
		recordId: text('record_id').notNull(),
		corporationId: text('corporation_id').notNull(),
		startDate: text('start_date').notNull(),
		isDeleted: boolean('is_deleted'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.characterId, table.recordId)]
)

/**
 * Character skills
 */
export const characterSkills = pgTable('character_skills', {
	characterId: text('character_id')
		.primaryKey()
		.references(() => characterPublicInfo.characterId),
	totalSp: integer('total_sp').notNull(),
	unallocatedSp: integer('unallocated_sp'),
	skills: jsonb('skills').notNull().$type<
		Array<{
			active_skill_level: number
			skill_id: string
			skillpoints_in_skill: number
			trained_skill_level: number
		}>
	>(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Character attributes
 */
export const characterAttributes = pgTable('character_attributes', {
	characterId: text('character_id')
		.primaryKey()
		.references(() => characterPublicInfo.characterId),
	intelligence: integer('intelligence').notNull(),
	perception: integer('perception').notNull(),
	memory: integer('memory').notNull(),
	willpower: integer('willpower').notNull(),
	charisma: integer('charisma').notNull(),
	accruedRemapCooldownDate: text('accrued_remap_cooldown_date'),
	bonusRemaps: integer('bonus_remaps'),
	lastRemapDate: text('last_remap_date'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Character location - Sensitive data (owner only)
 */
export const characterLocation = pgTable('character_location', {
	characterId: text('character_id')
		.primaryKey()
		.references(() => characterPublicInfo.characterId),
	solarSystemId: text('solar_system_id').notNull(),
	stationId: text('station_id'),
	structureId: text('structure_id'), // Can be a long ID for player structures
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Character wallet - Sensitive data (owner only)
 */
export const characterWallet = pgTable('character_wallet', {
	characterId: text('character_id')
		.primaryKey()
		.references(() => characterPublicInfo.characterId),
	balance: text('balance').notNull(), // Using text to handle large ISK values
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Character assets summary - Sensitive data (owner only)
 * Full asset details would be too large, so we store a summary
 */
export const characterAssets = pgTable('character_assets', {
	characterId: text('character_id')
		.primaryKey()
		.references(() => characterPublicInfo.characterId),
	totalValue: text('total_value'), // Estimated total value in ISK
	assetCount: integer('asset_count'),
	lastUpdated: timestamp('last_updated', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Character online status - Sensitive data (owner only)
 */
export const characterStatus = pgTable('character_status', {
	characterId: text('character_id')
		.primaryKey()
		.references(() => characterPublicInfo.characterId),
	online: boolean('online').notNull().default(false),
	lastLogin: timestamp('last_login', { withTimezone: true }),
	lastLogout: timestamp('last_logout', { withTimezone: true }),
	loginsCount: integer('logins_count').default(0),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Character skill queue - Sensitive data (owner only)
 */
export const characterSkillQueue = pgTable('character_skill_queue', {
	characterId: text('character_id')
		.primaryKey()
		.references(() => characterPublicInfo.characterId),
	queue: jsonb('queue').notNull().$type<
		Array<{
			queue_position: number
			skill_id: string
			finished_level: number
			start_date?: string
			finish_date?: string
			training_start_sp?: number
			level_start_sp?: number
			level_end_sp?: number
		}>
	>(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Character wallet journal - Sensitive data (owner only)
 * Stores wallet transaction history (bounties, missions, market, etc.)
 */
export const characterWalletJournal = pgTable(
	'character_wallet_journal',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		characterId: text('character_id')
			.notNull()
			.references(() => characterPublicInfo.characterId),
		journalId: text('journal_id').notNull(),
		date: timestamp('date', { withTimezone: true }).notNull(),
		refType: text('ref_type').notNull(),
		amount: text('amount').notNull(), // Using text to handle large ISK values
		balance: text('balance').notNull(), // Balance after transaction
		description: text('description').notNull(),
		firstPartyId: text('first_party_id'),
		secondPartyId: text('second_party_id'),
		reason: text('reason'),
		tax: text('tax'), // Tax amount in ISK
		taxReceiverId: text('tax_receiver_id'),
		contextId: text('context_id'),
		contextIdType: text('context_id_type'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.characterId, table.journalId)]
)

/**
 * Character market transactions - Sensitive data (owner only)
 * Stores market buy/sell transaction history
 */
export const characterMarketTransactions = pgTable(
	'character_market_transactions',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		characterId: text('character_id')
			.notNull()
			.references(() => characterPublicInfo.characterId),
		transactionId: text('transaction_id').notNull(),
		date: timestamp('date', { withTimezone: true }).notNull(),
		typeId: text('type_id').notNull(),
		quantity: integer('quantity').notNull(),
		unitPrice: text('unit_price').notNull(), // Price per unit in ISK
		clientId: text('client_id').notNull(),
		locationId: text('location_id').notNull(),
		isBuy: boolean('is_buy').notNull(),
		isPersonal: boolean('is_personal').notNull(),
		journalRefId: text('journal_ref_id').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.characterId, table.transactionId)]
)

/**
 * Character market orders - Sensitive data (owner only)
 * Stores active and historical market orders
 */
export const characterMarketOrders = pgTable(
	'character_market_orders',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		characterId: text('character_id')
			.notNull()
			.references(() => characterPublicInfo.characterId),
		orderId: text('order_id').notNull(),
		typeId: text('type_id').notNull(),
		locationId: text('location_id').notNull(),
		isBuyOrder: boolean('is_buy_order').notNull(),
		price: text('price').notNull(), // Price per unit in ISK
		volumeTotal: integer('volume_total').notNull(),
		volumeRemain: integer('volume_remain').notNull(),
		issued: timestamp('issued', { withTimezone: true }).notNull(),
		state: text('state').notNull().$type<'open' | 'closed' | 'expired' | 'cancelled'>(),
		minVolume: integer('min_volume').notNull(),
		range: text('range').notNull(),
		duration: integer('duration').notNull(),
		escrow: text('escrow'), // ISK in escrow
		regionId: text('region_id').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.characterId, table.orderId)]
)

/**
 * Schema export for Drizzle relations
 */
export const schema = {
	characterPublicInfo,
	characterPortraits,
	characterCorporationHistory,
	characterSkills,
	characterAttributes,
	characterLocation,
	characterWallet,
	characterAssets,
	characterStatus,
	characterSkillQueue,
	characterWalletJournal,
	characterMarketTransactions,
	characterMarketOrders,
}
