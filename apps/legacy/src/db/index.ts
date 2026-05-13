import { createDbClient } from '@repo/db-utils'

import * as coreSchema from './schema-core'
import * as legacySchema from './schema'

import type { DbClient } from '@repo/db-utils'

const schema = {
	...coreSchema,
	...legacySchema,
}

export function createDb(databaseUrl: string): DbClient<typeof schema> {
	return createDbClient(databaseUrl, schema)
}

export { coreSchema, legacySchema, schema }
export type { DbClient }
