import { boolean, index, integer, pgEnum, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

export const moonScanStatusEnum = pgEnum('moon_scan_status', ['pending', 'verified', 'rejected'])
export const moonScanSourceEnum = pgEnum('moon_scan_source', ['user', 'system'])

export const moonScans = pgTable('moon_scans', {
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
	moonId: text('moon_id').notNull(),
	submittedBy: text('submitted_by'),
	submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
	status: moonScanStatusEnum('status').default('pending').notNull(),
	source: moonScanSourceEnum('source').default('user').notNull(),
	verifiedBy: text('verified_by'),
	verifiedAt: timestamp('verified_at', { withTimezone: true }),
	notes: text('notes'),
}, (t) => [
	index('moon_scans_moon_id_idx').on(t.moonId),
	index('moon_scans_submitted_by_idx').on(t.submittedBy),
	index('moon_scans_status_idx').on(t.status),
	index('moon_scans_submitted_at_idx').on(t.submittedAt),
])

export const moonScanOres = pgTable('moon_scan_ores', {
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
	scanId: text('scan_id').notNull().references(() => moonScans.id, { onDelete: 'cascade' }),
	oreTypeId: text('ore_type_id').notNull(),
	quantity: text('quantity').notNull(),
}, (t) => [
	unique('moon_scan_ores_unique').on(t.scanId, t.oreTypeId),
	index('moon_scan_ores_scan_id_idx').on(t.scanId),
])

export const verifiedCompositions = pgTable('moon_verified_compositions', {
	moonId: text('moon_id').primaryKey(),
	sourceScanId: text('source_scan_id').notNull().references(() => moonScans.id),
	verifiedAt: timestamp('verified_at', { withTimezone: true }).defaultNow().notNull(),
	verifiedBy: text('verified_by'),
})

export const extractionSettings = pgTable('moon_extraction_settings', {
	id: text('id').primaryKey().default('default'),
	defaultReprocessingYield: text('default_reprocessing_yield').default('0.80').notNull(),
	defaultCycleDays: integer('default_cycle_days').default(30).notNull(),
	fuelBlockPriceOverride: text('fuel_block_price_override'),
	magmaticGasPriceOverride: text('magmatic_gas_price_override'),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export const structureProfiles = pgTable('moon_structure_profiles', {
	id: text('id').primaryKey(),
	baseVolumePerHr: text('base_volume_per_hr').notNull(),
	rigBonus: text('rig_bonus').notNull(),
	fuelPerHr: text('fuel_per_hr').notNull(),
	magmaticGasPerHr: text('magmatic_gas_per_hr'),
	minCycleDays: integer('min_cycle_days'),
	maxCycleDays: integer('max_cycle_days'),
	isPassive: boolean('is_passive').default(false).notNull(),
	lowsecModifier: text('lowsec_modifier').default('0.5').notNull(),
	nullsecModifier: text('nullsec_modifier').default('1.0').notNull(),
})

export const characterNameCache = pgTable('moon_character_name_cache', {
	characterId: text('character_id').primaryKey(),
	name: text('name').notNull(),
	cachedAt: timestamp('cached_at', { withTimezone: true }).defaultNow().notNull(),
})

export type MoonScan = typeof moonScans.$inferSelect
export type NewMoonScan = typeof moonScans.$inferInsert
export type MoonScanOre = typeof moonScanOres.$inferSelect
export type NewMoonScanOre = typeof moonScanOres.$inferInsert
export type VerifiedComposition = typeof verifiedCompositions.$inferSelect
export type ExtractionSetting = typeof extractionSettings.$inferSelect
export type StructureProfile = typeof structureProfiles.$inferSelect
export type CharacterNameCache = typeof characterNameCache.$inferSelect
