import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from 'drizzle-orm/pg-core'

import { managedCorporations, users } from '@repo/core-db-schema'
import { corporationStructures } from '@repo/eve-corporation-data-db-schema'

export const structureGroupSettings = pgTable(
	'structure_group_settings',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		groupId: text('group_id').notNull().unique(),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index('structure_group_settings_group_id_idx').on(table.groupId)]
)

export const structureCorporationGroupDefaults = pgTable(
	'structure_corporation_group_defaults',
	{
		corporationId: text('corporation_id')
			.primaryKey()
			.references(() => managedCorporations.corporationId, { onDelete: 'cascade' }),
		groupId: text('group_id'),
		updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index('structure_corporation_group_defaults_group_id_idx').on(table.groupId)]
)

export const structureModuleConfig = pgTable('structure_module_config', {
	id: text('id').primaryKey(),
	lowFuelTimeThresholdHours: integer('low_fuel_time_threshold_hours').notNull().default(12),
	criticalFuelTimeThresholdHours: integer('critical_fuel_time_threshold_hours').notNull().default(4),
	lowFuelAmountThreshold: integer('low_fuel_amount_threshold').notNull().default(0),
	criticalFuelAmountThreshold: integer('critical_fuel_amount_threshold').notNull().default(0),
	updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const structureConfigs = pgTable(
	'structure_configs',
	{
		structureId: text('structure_id').primaryKey(),
		hidden: boolean('hidden').notNull().default(false),
		lowPowerAllowed: boolean('low_power_allowed').notNull().default(false),
		assignedGroupId: text('assigned_group_id'),
		updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index('structure_configs_assigned_group_idx').on(table.assignedGroupId)]
)

export const structureStateEvents = pgTable(
	'structure_state_events',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		structureId: text('structure_id').notNull(),
		ownerId: text('owner_id')
			.notNull()
			.references(() => managedCorporations.corporationId, { onDelete: 'cascade' }),
		previousState: text('previous_state').notNull(),
		newState: text('new_state').notNull(),
		detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow().notNull(),
		sourceSyncAt: timestamp('source_sync_at', { withTimezone: true }),
		rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull().default({}),
	},
	(table) => [
		index('structure_state_events_structure_id_idx').on(table.structureId),
		index('structure_state_events_owner_id_idx').on(table.ownerId),
		index('structure_state_events_detected_at_idx').on(table.detectedAt),
	]
)

export const structureGroupAlertConfigs = pgTable(
	'structure_group_alert_configs',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		groupId: text('group_id').notNull(),
		alertType: text('alert_type').notNull(),
		destinationIds: uuid('destination_ids').array().notNull().default([]),
		config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
		isEnabled: boolean('is_enabled').notNull().default(true),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('structure_group_alert_configs_group_idx').on(table.groupId),
		index('structure_group_alert_configs_alert_type_idx').on(table.alertType),
		index('structure_group_alert_configs_enabled_idx').on(table.isEnabled),
		index('structure_group_alert_configs_group_alert_type_idx').on(table.groupId, table.alertType),
		unique('structure_group_alert_configs_group_alert_type_unique').on(table.groupId, table.alertType),
	]
)

export const schema = {
	structureGroupSettings,
	structureCorporationGroupDefaults,
	structureModuleConfig,
	structureConfigs,
	structureStateEvents,
	structureGroupAlertConfigs,
}
