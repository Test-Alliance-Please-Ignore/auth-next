/**
 * Migration imports for Durable Objects
 * These are imported at build time and embedded in the Worker
 */

// CharacterDataStore migrations
// @ts-expect-error - Wrangler handles ?raw imports
import characterDataStore001 from '../migrations/CharacterDataStore/001_initial_schema.sql?raw'

export const characterDataStoreMigrations: Record<string, string> = {
	'001_initial_schema.sql': characterDataStore001,
}

// EveUniverse migrations
// @ts-expect-error - Wrangler handles ?raw imports
import eveUniverse001 from '../migrations/EveUniverse/001_add_skill_hierarchy_tables.sql?raw'

export const eveUniverseMigrations: Record<string, string> = {
	'001_add_skill_hierarchy_tables.sql': eveUniverse001,
}
