import type { DbClientWs } from '@repo/db-utils'
import type { KVCache } from '@repo/do-utils'
import type { HonoApp, SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { schema } from './db/schema'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	EVE_SDE_CACHE: KVNamespace
	EVE_TOKEN_STORE: DurableObjectNamespace
}

export type Variables = SharedHonoVariables & {
	db: DbClientWs<typeof schema>
	idCache: KVCache<string, string>
	nameCache: KVCache<string, string>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
