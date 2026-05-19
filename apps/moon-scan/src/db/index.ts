import { createDbClientWs } from '@repo/db-utils'

import * as schema from './schema'

import type { DbClientWs } from '@repo/db-utils'

export function createDb(databaseUrl: string): DbClientWs<typeof schema> {
	return createDbClientWs(databaseUrl, schema)
}

export { schema }
export type { DbClientWs as DbClient }
