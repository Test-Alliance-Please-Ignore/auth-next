import { createDbClient } from '@repo/db-utils'

import * as schema from './schema'

import type { DbClient } from '@repo/db-utils'

export function createDb(databaseUrl: string): DbClient<typeof schema> {
	return createDbClient(databaseUrl, schema)
}

export { schema }
export type { DbClient }
