import { index, unique } from 'drizzle-orm/pg-core'
import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { managedCorporations } from '@repo/core-db-schema'

export const corporationStructures = pgTable(
	'corporation_structures',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id')
			.notNull()
			.references(() => managedCorporations.corporationId),
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
			.references(() => managedCorporations.corporationId),
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
			.references(() => managedCorporations.corporationId),
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

export const schema = {
	corporationStructures,
	corporationStructureInventory,
	structureFuelLog,
}
