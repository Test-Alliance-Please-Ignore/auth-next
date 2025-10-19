import type { schema } from './db/schema'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

export interface Env {
	DATABASE_URL: string
}

export interface App {
	Bindings: Env
	Variables: {
		db: PostgresJsDatabase<typeof schema>
	}
}