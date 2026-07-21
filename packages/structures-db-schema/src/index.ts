import {
	boolean,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from 'drizzle-orm/pg-core'

import { managedCorporations, users } from '@repo/core-db-schema'
import { corporationStructures } from '@repo/eve-corporation-data-db-schema'
import type {
	StructureSovereigntyReagent,
	StructureSovereigntyTransportState,
} from '@repo/structures'

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
		structureId: text('structure_id')
			.primaryKey()
			.references(() => corporationStructures.structureId, { onDelete: 'cascade' }),
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
		structureId: text('structure_id')
			.notNull()
			.references(() => corporationStructures.structureId, { onDelete: 'cascade' }),
		corporationId: text('corporation_id')
			.notNull()
			.references(() => managedCorporations.corporationId, { onDelete: 'cascade' }),
		previousState: text('previous_state').notNull(),
		newState: text('new_state').notNull(),
		detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow().notNull(),
		sourceSyncAt: timestamp('source_sync_at', { withTimezone: true }),
	},
	(table) => [
		index('structure_state_events_structure_id_idx').on(table.structureId),
		index('structure_state_events_corporation_id_idx').on(table.corporationId),
		index('structure_state_events_detected_at_idx').on(table.detectedAt),
	]
)

export const structureSovereigntySystems = pgTable(
	'structure_sovereignty_systems',
	{
		systemId: text('system_id').primaryKey(),
		systemName: text('system_name'),
		corporationId: text('corporation_id')
			.notNull()
			.references(() => managedCorporations.corporationId, { onDelete: 'cascade' }),
		claimType: text('claim_type', {
			enum: ['alliance', 'faction', 'unclaimed'],
		}).notNull(),
		allianceId: text('alliance_id'),
		corporationClaimantId: text('corporation_claimant_id'),
		factionId: text('faction_id'),
		claimedSince: timestamp('claimed_since', { withTimezone: true }),
		sovereigntyHubStructureId: text('sovereignty_hub_structure_id'),
		isCapitalSystem: boolean('is_capital_system'),
		vulnerabilityWindowStart: timestamp('vulnerability_window_start', { withTimezone: true }),
		vulnerabilityWindowEnd: timestamp('vulnerability_window_end', { withTimezone: true }),
		activityDefenseMultiplier: numeric('activity_defense_multiplier', {
			precision: 12,
			scale: 4,
		}),
		militaryLevel: integer('military_level'),
		industrialLevel: integer('industrial_level'),
		strategicLevel: integer('strategic_level'),
		sourceSyncAt: timestamp('source_sync_at', { withTimezone: true }),
		lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('structure_sovereignty_systems_corporation_id_idx').on(table.corporationId),
		index('structure_sovereignty_systems_alliance_id_idx').on(table.allianceId),
		index('structure_sovereignty_systems_sovereignty_hub_structure_id_idx').on(
			table.sovereigntyHubStructureId
		),
		index('structure_sovereignty_systems_last_synced_at_idx').on(table.lastSyncedAt),
	]
)

export const structureSovereigntyHubs = pgTable(
	'structure_sovereignty_hubs',
	{
		structureId: text('structure_id').primaryKey(),
		corporationId: text('corporation_id')
			.notNull()
			.references(() => managedCorporations.corporationId, { onDelete: 'cascade' }),
		systemId: text('system_id').notNull(),
		systemName: text('system_name'),
		name: text('name'),
		typeId: text('type_id').notNull(),
		fuelAccessListId: text('fuel_access_list_id'),
		controllerAllianceId: text('controller_alliance_id'),
		reagentBayLastUpdated: timestamp('reagent_bay_last_updated', { withTimezone: true }),
		reagentBay: jsonb('reagent_bay')
			.$type<{
				lastUpdated: string
				reagents: StructureSovereigntyReagent[]
			}>()
			.notNull()
			.default({ lastUpdated: '', reagents: [] }),
		resources: jsonb('resources')
			.$type<{
				power: {
					allocated: number
					available: number
				}
				workforce: {
					allocated: number
					available: number
				}
			}>()
			.notNull()
			.default({
				power: { allocated: 0, available: 0 },
				workforce: { allocated: 0, available: 0 },
			}),
		upgrades: jsonb('upgrades')
			.$type<
				Array<{
					typeId: string
					powerState: string
				}>
			>()
			.notNull()
			.default([]),
		vulnerabilityWindowStart: timestamp('vulnerability_window_start', { withTimezone: true }),
		vulnerabilityWindowEnd: timestamp('vulnerability_window_end', { withTimezone: true }),
		workforceTransport: jsonb('workforce_transport')
			.$type<StructureSovereigntyTransportState>()
			.notNull()
			.default({
				configuration: { mode: 'unknown', systems: [] },
				state: { mode: 'unknown', systems: [] },
			}),
		syncStatus: text('sync_status', { enum: ['ok', 'warning', 'error'] }).notNull().default('ok'),
		syncFailureReason: text('sync_failure_reason'),
		sourceSyncAt: timestamp('source_sync_at', { withTimezone: true }),
		lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('structure_sovereignty_hubs_corporation_id_idx').on(table.corporationId),
		index('structure_sovereignty_hubs_system_id_idx').on(table.systemId),
		index('structure_sovereignty_hubs_type_id_idx').on(table.typeId),
		index('structure_sovereignty_hubs_last_synced_at_idx').on(table.lastSyncedAt),
	]
)

export const structureSkyhooks = pgTable(
	'structure_skyhooks',
	{
		structureId: text('structure_id')
			.primaryKey()
			.references(() => corporationStructures.structureId, { onDelete: 'cascade' }),
		corporationId: text('corporation_id')
			.notNull()
			.references(() => managedCorporations.corporationId, { onDelete: 'cascade' }),
		planetId: text('planet_id'),
		planetName: text('planet_name'),
		systemId: text('system_id'),
		systemName: text('system_name'),
		name: text('name'),
		typeId: text('type_id').notNull(),
		state: text('state').notNull(),
		isActive: boolean('is_active').notNull().default(false),
		effectiveWorkforce: integer('effective_workforce'),
		reagents: jsonb('reagents')
			.$type<
				Array<{
					typeId: string
					securedStock: number
					unsecuredStock: number
					lastCycle: string
				}>
			>()
			.notNull()
			.default([]),
		reinforcementTimerEnd: timestamp('reinforcement_timer_end', { withTimezone: true }),
		theftVulnerabilityStart: timestamp('theft_vulnerability_start', { withTimezone: true }),
		theftVulnerabilityEnd: timestamp('theft_vulnerability_end', { withTimezone: true }),
		isRaidable: boolean('is_raidable').notNull().default(false),
		becomesRaidableAt: timestamp('becomes_raidable_at', { withTimezone: true }),
		vulnerableAt: timestamp('vulnerable_at', { withTimezone: true }),
		syncStatus: text('sync_status', { enum: ['ok', 'warning', 'error'] }).notNull().default('ok'),
		syncFailureReason: text('sync_failure_reason'),
		lastObservedAt: timestamp('last_observed_at', { withTimezone: true }),
		sourceSyncAt: timestamp('source_sync_at', { withTimezone: true }),
		lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('structure_skyhooks_corporation_id_idx').on(table.corporationId),
		index('structure_skyhooks_planet_id_idx').on(table.planetId),
		index('structure_skyhooks_system_id_idx').on(table.systemId),
		index('structure_skyhooks_type_id_idx').on(table.typeId),
		index('structure_skyhooks_is_raidable_idx').on(table.isRaidable),
		index('structure_skyhooks_last_synced_at_idx').on(table.lastSyncedAt),
	]
)

export const structureMoonDrills = pgTable(
	'structure_moon_drills',
	{
		structureId: text('structure_id')
			.primaryKey()
			.references(() => corporationStructures.structureId, { onDelete: 'cascade' }),
		corporationId: text('corporation_id')
			.notNull()
			.references(() => managedCorporations.corporationId, { onDelete: 'cascade' }),
		sourceSyncAt: timestamp('source_sync_at', { withTimezone: true }),
		lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('structure_moon_drills_corporation_id_idx').on(table.corporationId),
		index('structure_moon_drills_last_synced_at_idx').on(table.lastSyncedAt),
	]
)

export const structureMoonGeographies = pgTable(
	'structure_moon_geographies',
	{
		structureId: text('structure_id')
			.primaryKey()
			.references(() => corporationStructures.structureId, { onDelete: 'cascade' }),
		corporationId: text('corporation_id')
			.notNull()
			.references(() => managedCorporations.corporationId, { onDelete: 'cascade' }),
		moonId: text('moon_id').notNull(),
		moonName: text('moon_name'),
		planetId: text('planet_id').notNull(),
		planetName: text('planet_name'),
		systemId: text('system_id').notNull(),
		systemName: text('system_name'),
		sourceSyncAt: timestamp('source_sync_at', { withTimezone: true }),
		lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('structure_moon_geographies_corporation_id_idx').on(table.corporationId),
		index('structure_moon_geographies_moon_id_idx').on(table.moonId),
		index('structure_moon_geographies_planet_id_idx').on(table.planetId),
		index('structure_moon_geographies_system_id_idx').on(table.systemId),
		index('structure_moon_geographies_last_synced_at_idx').on(table.lastSyncedAt),
	]
)

export const structureMiningExtractions = pgTable(
	'structure_mining_citadel_extractions',
	{
		structureId: text('structure_id')
			.primaryKey()
			.references(() => corporationStructures.structureId, { onDelete: 'cascade' }),
		corporationId: text('corporation_id')
			.notNull()
			.references(() => managedCorporations.corporationId, { onDelete: 'cascade' }),
		extractionStartTime: timestamp('extraction_start_time', { withTimezone: true }),
		chunkArrivalTime: timestamp('chunk_arrival_time', { withTimezone: true }),
		naturalDecayTime: timestamp('natural_decay_time', { withTimezone: true }),
		sourceSyncAt: timestamp('source_sync_at', { withTimezone: true }),
		lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('structure_mining_citadel_extractions_corporation_id_idx').on(table.corporationId),
		index('structure_mining_citadel_extractions_last_synced_at_idx').on(table.lastSyncedAt),
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
	corporationStructures,
	structureGroupSettings,
	structureCorporationGroupDefaults,
	structureModuleConfig,
	structureConfigs,
	structureStateEvents,
	structureSovereigntySystems,
	structureSovereigntyHubs,
	structureSkyhooks,
	structureMoonDrills,
	structureMoonGeographies,
	structureMiningExtractions,
	structureGroupAlertConfigs,
}
