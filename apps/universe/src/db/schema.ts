/**
 * Database schema for the universe worker
 *
 * This file aggregates all schema modules and exports them as a single schema object.
 * Individual schema modules are organized by domain (e.g., moons, structures, etc.)
 */

import * as killmails from './killmails'
import * as moons from './moons'
import * as typeIds from './type-ids'

// Combine all schemas
export const schema = {
	...killmails,
	...moons,
	...typeIds,
}

// Re-export individual modules for direct imports
export * from './killmails'
export * from './moons'
export * from './type-ids'
