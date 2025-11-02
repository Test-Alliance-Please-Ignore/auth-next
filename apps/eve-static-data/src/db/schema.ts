import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Database schema for EVE Online static data
 * This stores skill metadata from the Static Data Export (SDE)
 */

export const corporations = pgTable('corporations', {
	corporationId: text('corporation_id').primaryKey(),
	corporationName: text('corporation_name').notNull(),
	ticker: text('ticker').notNull(),
})

export const alliances = pgTable('alliances', {
	allianceId: text('alliance_id').primaryKey(),
	allianceName: text('alliance_name').notNull(),
	ticker: text('ticker').notNull(),
})

/**
 * SDE version tracking - Track which version of the SDE we've imported
 */
export const sdeVersion = pgTable('sde_version', {
	version: text('version').primaryKey(),
	importedAt: timestamp('imported_at', { withTimezone: true }).defaultNow().notNull(),
	checksum: text('checksum'),
})

/**
 * Schema export for Drizzle relations
 */
export const schema = {
	alliances,
	corporations,

	sdeVersion,
}
