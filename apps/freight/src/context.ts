import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	FREIGHT: DurableObjectNamespace
	EVE_TOKEN_STORE: DurableObjectNamespace
	ESI_RATE_LIMITS: KVNamespace
	EVE_SSO_CLIENT_ID: string
}

/** Variables can be extended */
export type Variables = SharedHonoVariables

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
