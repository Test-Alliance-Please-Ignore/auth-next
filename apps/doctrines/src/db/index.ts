import { createDbClientWs, DbClientWs } from '@repo/db-utils'

import * as schema from './schema'

export function createDb(databaseUrl: string): DbClientWs<typeof schema> {
	return createDbClientWs(databaseUrl, schema)
}