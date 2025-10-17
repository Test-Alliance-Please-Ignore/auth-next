import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	// Durable Objects
	EVESSO_STORE: DurableObjectNamespace
	USER_SESSION_STORE: DurableObjectNamespace
	CHARACTER_DATA_STORE: DurableObjectNamespace
	TAG_STORE: DurableObjectNamespace

	// EVE SSO OAuth Configuration
	ESI_SSO_CLIENT_ID: string
	ESI_SSO_CLIENT_SECRET: string
	ESI_SSO_CALLBACK_URL: string
}

/** Variables can be extended */
export type Variables = SharedHonoVariables

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
