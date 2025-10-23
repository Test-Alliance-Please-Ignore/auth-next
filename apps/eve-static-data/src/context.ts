import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { KVCache } from '@repo/do-utils'
import type { schema } from './db/schema'

export interface Env {
	DATABASE_URL: string
	EVE_SDE_CACHE: KVNamespace
}

export interface App {
	Bindings: Env
	Variables: {
		db: PostgresJsDatabase<typeof schema>
		idCache: KVCache<string, string>
		nameCache: KVCache<string, string>
	}
}
