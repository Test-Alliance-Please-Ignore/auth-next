import { index, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

/**
 * Killmails table
 * Stores EVE Online killmail data from ESI
 *
 * All IDs stored as text to avoid BigInt serialization issues with Neon serverless
 * JSONB arrays for attackers allow efficient querying with GIN indexes
 */
export const killmails = pgTable(
	'universe_killmails',
	{
		killmailId: text('killmail_id').notNull(),
		killmailHash: text('killmail_hash').notNull(),
		killmailTime: timestamp('killmail_time', { withTimezone: true }).notNull(),
		solarSystemId: text('solar_system_id').notNull(),
		solarSystemName: text('solar_system_name'),
		moonId: text('moon_id'),
		moonName: text('moon_name'),
		warId: text('war_id'),
		warName: text('war_name'),
		victimCharacterId: text('victim_character_id'),
		victimCharacterName: text('victim_character_name'),
		victimCorporationId: text('victim_corporation_id'),
		victimCorporationName: text('victim_corporation_name'),
		victimAllianceId: text('victim_alliance_id'),
		victimAllianceName: text('victim_alliance_name'),
		victimShipTypeId: text('victim_ship_type_id').notNull(),
		victimShipTypeName: text('victim_ship_type_name'),
		victimDamageTaken: integer('victim_damage_taken').notNull(),
		attackerCharacterIds: jsonb('attacker_character_ids').$type<string[]>(),
		attackerCharacterNames: jsonb('attacker_character_names').$type<string[]>(),
		attackerCorporationIds: jsonb('attacker_corporation_ids').$type<string[]>(),
		attackerCorporationNames: jsonb('attacker_corporation_names').$type<string[]>(),
		killmailData: jsonb('killmail_data').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		primaryKey: unique().on(table.killmailId, table.killmailHash),
		killmailIdIdx: index('universe_killmails_killmail_id_idx').on(table.killmailId),
		victimCharacterTimeIdx: index('universe_killmails_victim_character_time_idx').on(
			table.victimCharacterId,
			table.killmailTime
		),
		victimCorporationTimeIdx: index('universe_killmails_victim_corporation_time_idx').on(
			table.victimCorporationId,
			table.killmailTime
		),
		attackerCharacterGinIdx: index('universe_killmails_attacker_character_gin_idx').using(
			'gin',
			table.attackerCharacterIds
		),
		attackerCorporationGinIdx: index('universe_killmails_attacker_corporation_gin_idx').using(
			'gin',
			table.attackerCorporationIds
		),
		solarSystemTimeIdx: index('universe_killmails_solar_system_time_idx').on(
			table.solarSystemId,
			table.killmailTime
		),
		killmailTimeIdx: index('universe_killmails_killmail_time_idx').on(table.killmailTime),
	})
)

/**
 * Killmail database row type
 */
export type Killmail = typeof killmails.$inferSelect
