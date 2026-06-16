import {
	structureConfigs,
	structureCorporationGroupDefaults,
	structureGroupAlertConfigs,
	structureGroupSettings,
	structureModuleConfig,
	structureStateEvents,
} from '@repo/structures-db-schema'

/**
 * Migration schema for structures-owned objects only.
 *
 * IMPORTANT:
 * - Do not include ingest-owned structure snapshot tables here.
 * - Runtime schema may still include ingest tables for typed reads, but migration schema must not.
 */
export {
	structureConfigs,
	structureCorporationGroupDefaults,
	structureGroupAlertConfigs,
	structureGroupSettings,
	structureModuleConfig,
	structureStateEvents,
}
