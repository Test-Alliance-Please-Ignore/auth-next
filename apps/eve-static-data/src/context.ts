import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { schema } from './db/schema'

export interface Env {
	DATABASE_URL: string
}

export interface App {
	Bindings: Env
	Variables: {
		db: PostgresJsDatabase<typeof schema>
	}
}
