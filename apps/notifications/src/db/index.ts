import { createDbClientWs } from '@repo/db-utils'

import * as schema from './schema'

export function createDb(databaseUrl: string) {
	return createDbClientWs(databaseUrl, schema)
}
