import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	MARKETS: DurableObjectNamespace
	EVE_STATIC_DATA: Fetcher
	EVE_TOKEN_STORE: DurableObjectNamespace
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof import('./db').createDb>
	apiKeyId?: string
	apiKeyName?: string
	requestId?: string
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
