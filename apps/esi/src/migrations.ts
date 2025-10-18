/**
 * Migration imports for CharacterDataStore
 * These are imported at build time and embedded in the Worker
 */

// Import all migration SQL files as raw strings
// @ts-expect-error - Wrangler handles ?raw imports
import migration001 from '../migrations/CharacterDataStore/001_initial_schema.sql?raw'

// Export as a mapping for the loader
export const characterDataStoreMigrations: Record<string, string> = {
	'001_initial_schema.sql': migration001,
}
