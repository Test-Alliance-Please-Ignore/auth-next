import { alertDestinations, discordServers, managedCorporations, users } from '@repo/core-db-schema'
import { createDbClient } from '@repo/db-utils'
import {
	corporationStructureInventory,
	corporationStructureInventorySnapshots,
	corporationStructures,
} from '@repo/eve-corporation-data-db-schema'

import * as schema from './schema'

import type { DbClient } from '@repo/db-utils'

export const querySchema = {
	alertDestinations,
	discordServers,
	...schema,
	users,
	managedCorporations,
	corporationStructures,
	corporationStructureInventorySnapshots,
	corporationStructureInventory,
}

export type DbSchema = typeof querySchema

export function createDb(databaseUrl: string): DbClient<DbSchema> {
	return createDbClient(databaseUrl, querySchema)
}

export { alertDestinations, discordServers, schema }
