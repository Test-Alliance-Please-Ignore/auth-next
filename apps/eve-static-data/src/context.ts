import type { DbClient } from '@repo/db-utils'
import type { KVCache } from '@repo/do-utils'
import type { HonoApp, SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers'
import type { schema } from './db/schema'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	EVE_SDE_CACHE: KVNamespace
}

export type Variables = SharedHonoVariables & {
	db: DbClient<typeof schema>
	idCache: KVCache<string, string>
	nameCache: KVCache<string, string>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
