import { createDbClient } from '@repo/db-utils'

import * as schema from './schema'

export function createDb(databaseUrl: string) {
	return createDbClient(databaseUrl, schema)
}
