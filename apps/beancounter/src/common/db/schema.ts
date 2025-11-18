import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core'

import type { InferInsertModel, InferSelectModel } from '@repo/db-utils'

/**
 * Structure monitoring coordinator tables (Neon/Postgres)
 */

export const structureMonitorStatusEnum = pgEnum('structure_monitor_status', [
	'idle',
	'starting',
	'active',
	'degraded',
	'unresponsive',
	'disabled',
])

export const corporations = pgTable(
	'beancounter_structure_monitor_corporations',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id').notNull(),
		name: text('name'),
		ticker: text('ticker'),
		trackingEnabled: boolean('tracking_enabled').notNull().default(true),
		structureTypeFilter: jsonb('structure_type_filter').$type<string[] | null>().default(null),
		minimumFuelHours: integer('minimum_fuel_hours').notNull().default(48),
		lastScanStartedAt: timestamp('last_scan_started_at', { withTimezone: true }),
		lastScanCompletedAt: timestamp('last_scan_completed_at', { withTimezone: true }),
		lastScanError: text('last_scan_error'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex('beancounter_structure_monitor_corporations_corporation_id_idx').on(
			table.corporationId
		),
		index('beancounter_structure_monitor_corporations_tracking_idx').on(table.trackingEnabled),
	]
)

export const structures = pgTable(
	'beancounter_structure_monitor_structures',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: uuid('corporation_id')
			.notNull()
			.references(() => corporations.id, { onDelete: 'cascade' }),
		structureId: text('structure_id').notNull(),
		name: text('name'),
		typeId: text('type_id'),
		solarSystemId: text('solar_system_id'),
		profileId: text('profile_id'),
		fuelExpiresAt: timestamp('fuel_expires_at', { withTimezone: true }),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
		lastInventoryHash: text('last_inventory_hash'),
		monitoringEnabled: boolean('monitoring_enabled').notNull().default(true),
		tags: jsonb('tags').$type<string[] | null>().default(null),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex('beancounter_structure_monitor_structures_structure_id_idx').on(table.structureId),
		index('beancounter_structure_monitor_structures_corporation_idx').on(table.corporationId),
	]
)

export const structureMonitorInstances = pgTable(
	'beancounter_structure_monitor_instances',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		structureId: uuid('structure_id')
			.notNull()
			.references(() => structures.id, { onDelete: 'cascade' }),
		durableObjectName: text('durable_object_name').notNull(),
		status: structureMonitorStatusEnum('status').notNull().default('idle'),
		lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
		lastHealthCheckAt: timestamp('last_health_check_at', { withTimezone: true }),
		lastError: text('last_error'),
		nextAlarmAt: timestamp('next_alarm_at', { withTimezone: true }),
		healthMetadata: jsonb('health_metadata').$type<Record<string, unknown> | null>().default(null),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex('beancounter_structure_monitor_instances_structure_idx').on(table.structureId),
		index('beancounter_structure_monitor_instances_status_idx').on(
			table.status,
			table.lastHeartbeatAt
		),
	]
)

export const structureMonitorRuns = pgTable(
	'beancounter_structure_monitor_runs',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		structureId: uuid('structure_id')
			.notNull()
			.references(() => structures.id, { onDelete: 'cascade' }),
		monitorInstanceId: uuid('monitor_instance_id').references(() => structureMonitorInstances.id, {
			onDelete: 'set null',
		}),
		startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		status: text('status').notNull().default('pending'),
		resultSummary: text('result_summary'),
		fuelStatus: jsonb('fuel_status').$type<Record<string, unknown> | null>().default(null),
		inventoryStatus: jsonb('inventory_status')
			.$type<Record<string, unknown> | null>()
			.default(null),
		error: text('error'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('beancounter_structure_monitor_runs_structure_idx').on(table.structureId),
		index('beancounter_structure_monitor_runs_status_idx').on(table.status),
	]
)

export const schema = {
	corporations,
	structures,
	structureMonitorInstances,
	structureMonitorRuns,
}

export type CorporationRow = InferSelectModel<typeof corporations>
export type NewCorporationRow = InferInsertModel<typeof corporations>

export type StructureRow = InferSelectModel<typeof structures>
export type NewStructureRow = InferInsertModel<typeof structures>

export type StructureMonitorInstanceRow = InferSelectModel<typeof structureMonitorInstances>
export type NewStructureMonitorInstanceRow = InferInsertModel<typeof structureMonitorInstances>

export type StructureMonitorRunRow = InferSelectModel<typeof structureMonitorRuns>
export type NewStructureMonitorRunRow = InferInsertModel<typeof structureMonitorRuns>
