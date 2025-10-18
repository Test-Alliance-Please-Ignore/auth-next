import { pgTable, integer, varchar, real, timestamp, text, boolean, bigint, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ============================================================================
// Characters and Corporations
// ============================================================================

export const characters = pgTable('esi_characters', {
	characterId: integer('character_id').primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	corporationId: integer('corporation_id').notNull(),
	allianceId: integer('alliance_id'),
	securityStatus: real('security_status'),
	birthday: varchar('birthday', { length: 50 }),
	gender: varchar('gender', { length: 20 }),
	raceId: integer('race_id'),
	bloodlineId: integer('bloodline_id'),
	ancestryId: integer('ancestry_id'),
	description: text('description'),
	walletBalance: bigint('wallet_balance', { mode: 'number' }),
	walletUpdatedAt: timestamp('wallet_updated_at'),
	lastUpdated: timestamp('last_updated').defaultNow().notNull(),
	nextUpdateAt: timestamp('next_update_at'),
	updateCount: integer('update_count').default(0).notNull()
}, (table) => ({
	corpIdx: index('esi_characters_corp_idx').on(table.corporationId),
	allianceIdx: index('esi_characters_alliance_idx').on(table.allianceId),
	nextUpdateIdx: index('esi_characters_next_update_idx').on(table.nextUpdateAt)
}))

export const corporations = pgTable('esi_corporations', {
	corporationId: integer('corporation_id').primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	ticker: varchar('ticker', { length: 10 }).notNull(),
	memberCount: integer('member_count'),
	ceoId: integer('ceo_id'),
	creatorId: integer('creator_id'),
	dateFounded: varchar('date_founded', { length: 50 }),
	taxRate: real('tax_rate'),
	url: text('url'),
	description: text('description'),
	allianceId: integer('alliance_id'),
	lastUpdated: timestamp('last_updated').defaultNow().notNull(),
	nextUpdateAt: timestamp('next_update_at'),
	updateCount: integer('update_count').default(0).notNull()
}, (table) => ({
	allianceIdx: index('esi_corporations_alliance_idx').on(table.allianceId),
	nextUpdateIdx: index('esi_corporations_next_update_idx').on(table.nextUpdateAt)
}))

export const alliances = pgTable('esi_alliances', {
	allianceId: integer('alliance_id').primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	ticker: varchar('ticker', { length: 10 }).notNull(),
	creatorId: integer('creator_id'),
	creatorCorporationId: integer('creator_corporation_id'),
	dateFounded: varchar('date_founded', { length: 50 }),
	executorCorporationId: integer('executor_corporation_id'),
	lastUpdated: timestamp('last_updated').defaultNow().notNull(),
	nextUpdateAt: timestamp('next_update_at'),
	updateCount: integer('update_count').default(0).notNull()
}, (table) => ({
	nextUpdateIdx: index('esi_alliances_next_update_idx').on(table.nextUpdateAt)
}))

// ============================================================================
// Character History Tracking
// ============================================================================

export const characterHistory = pgTable('esi_character_history', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	characterId: integer('character_id').notNull(),
	changedAt: timestamp('changed_at').defaultNow().notNull(),
	fieldName: varchar('field_name', { length: 50 }).notNull(),
	oldValue: text('old_value'),
	newValue: text('new_value')
}, (table) => ({
	characterIdx: index('esi_character_history_character_idx').on(table.characterId),
	changedAtIdx: index('esi_character_history_changed_idx').on(table.changedAt)
}))

export const corporationHistory = pgTable('esi_corporation_history', {
	characterId: integer('character_id').notNull(),
	recordId: integer('record_id').notNull(),
	corporationId: integer('corporation_id').notNull(),
	corporationName: varchar('corporation_name', { length: 255 }),
	corporationTicker: varchar('corporation_ticker', { length: 10 }),
	allianceId: integer('alliance_id'),
	allianceName: varchar('alliance_name', { length: 255 }),
	allianceTicker: varchar('alliance_ticker', { length: 10 }),
	startDate: varchar('start_date', { length: 50 }).notNull(),
	endDate: varchar('end_date', { length: 50 }),
	isDeleted: boolean('is_deleted').default(false).notNull(),
	lastUpdated: timestamp('last_updated').defaultNow().notNull()
}, (table) => ({
	pk: primaryKey({ columns: [table.characterId, table.recordId] }),
	characterIdx: index('esi_corp_history_character_idx').on(table.characterId),
	corpIdx: index('esi_corp_history_corp_idx').on(table.corporationId),
	allianceIdx: index('esi_corp_history_alliance_idx').on(table.allianceId)
}))

export const corporationHistoryMetadata = pgTable('esi_corporation_history_metadata', {
	characterId: integer('character_id').primaryKey(),
	lastFetched: timestamp('last_fetched').defaultNow().notNull(),
	nextFetchAt: timestamp('next_fetch_at')
})

// ============================================================================
// Skills and Training
// ============================================================================

export const characterSkills = pgTable('esi_character_skills', {
	characterId: integer('character_id').primaryKey(),
	totalSp: bigint('total_sp', { mode: 'number' }),
	unallocatedSp: bigint('unallocated_sp', { mode: 'number' }),
	lastUpdated: timestamp('last_updated').defaultNow().notNull(),
	nextUpdateAt: timestamp('next_update_at'),
	updateCount: integer('update_count').default(0).notNull()
}, (table) => ({
	nextUpdateIdx: index('esi_character_skills_next_update_idx').on(table.nextUpdateAt)
}))

export const skills = pgTable('esi_skills', {
	characterId: integer('character_id').notNull(),
	skillId: integer('skill_id').notNull(),
	skillpointsInSkill: bigint('skillpoints_in_skill', { mode: 'number' }).notNull(),
	trainedSkillLevel: integer('trained_skill_level').notNull(),
	activeSkillLevel: integer('active_skill_level').notNull()
}, (table) => ({
	pk: primaryKey({ columns: [table.characterId, table.skillId] }),
	characterIdx: index('esi_skills_character_idx').on(table.characterId)
}))

export const skillQueue = pgTable('esi_skillqueue', {
	characterId: integer('character_id').notNull(),
	skillId: integer('skill_id').notNull(),
	finishedLevel: integer('finished_level').notNull(),
	queuePosition: integer('queue_position').notNull(),
	startDate: varchar('start_date', { length: 50 }),
	finishDate: varchar('finish_date', { length: 50 }),
	trainingStartSp: bigint('training_start_sp', { mode: 'number' }),
	levelStartSp: bigint('level_start_sp', { mode: 'number' }),
	levelEndSp: bigint('level_end_sp', { mode: 'number' })
}, (table) => ({
	pk: primaryKey({ columns: [table.characterId, table.queuePosition] }),
	characterIdx: index('esi_skillqueue_character_idx').on(table.characterId)
}))

// ============================================================================
// Assets and Locations
// ============================================================================

export const characterAssets = pgTable('esi_character_assets', {
	characterId: integer('character_id').notNull(),
	itemId: bigint('item_id', { mode: 'number' }).notNull(),
	typeId: integer('type_id').notNull(),
	quantity: integer('quantity').notNull(),
	locationId: bigint('location_id', { mode: 'number' }).notNull(),
	locationType: varchar('location_type', { length: 50 }).notNull(),
	locationFlag: varchar('location_flag', { length: 50 }).notNull(),
	isSingleton: boolean('is_singleton').notNull(),
	isBlueprintCopy: boolean('is_blueprint_copy'),
	lastUpdated: timestamp('last_updated').defaultNow().notNull()
}, (table) => ({
	pk: primaryKey({ columns: [table.characterId, table.itemId] }),
	characterIdx: index('esi_assets_character_idx').on(table.characterId),
	typeIdx: index('esi_assets_type_idx').on(table.typeId),
	locationIdx: index('esi_assets_location_idx').on(table.locationId)
}))

export const characterLocation = pgTable('esi_character_location', {
	characterId: integer('character_id').primaryKey(),
	solarSystemId: integer('solar_system_id').notNull(),
	stationId: bigint('station_id', { mode: 'number' }),
	structureId: bigint('structure_id', { mode: 'number' }),
	lastUpdated: timestamp('last_updated').defaultNow().notNull(),
	nextUpdateAt: timestamp('next_update_at')
}, (table) => ({
	nextUpdateIdx: index('esi_character_location_next_update_idx').on(table.nextUpdateAt)
}))

export const characterOnline = pgTable('esi_character_online', {
	characterId: integer('character_id').primaryKey(),
	online: boolean('online').notNull(),
	lastLogin: timestamp('last_login'),
	lastLogout: timestamp('last_logout'),
	logins: integer('logins'),
	lastUpdated: timestamp('last_updated').defaultNow().notNull(),
	nextUpdateAt: timestamp('next_update_at')
}, (table) => ({
	nextUpdateIdx: index('esi_character_online_next_update_idx').on(table.nextUpdateAt)
}))

// ============================================================================
// Relations
// ============================================================================

export const charactersRelations = relations(characters, ({ one, many }) => ({
	corporation: one(corporations, {
		fields: [characters.corporationId],
		references: [corporations.corporationId]
	}),
	alliance: one(alliances, {
		fields: [characters.allianceId],
		references: [alliances.allianceId]
	}),
	history: many(characterHistory),
	corporationHistory: many(corporationHistory),
	skills: one(characterSkills, {
		fields: [characters.characterId],
		references: [characterSkills.characterId]
	}),
	location: one(characterLocation, {
		fields: [characters.characterId],
		references: [characterLocation.characterId]
	}),
	online: one(characterOnline, {
		fields: [characters.characterId],
		references: [characterOnline.characterId]
	})
}))

export const corporationsRelations = relations(corporations, ({ one, many }) => ({
	alliance: one(alliances, {
		fields: [corporations.allianceId],
		references: [alliances.allianceId]
	}),
	members: many(characters)
}))

export const alliancesRelations = relations(alliances, ({ many }) => ({
	corporations: many(corporations),
	characters: many(characters)
}))