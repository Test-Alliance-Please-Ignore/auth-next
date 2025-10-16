import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	ESI_CACHE: KVNamespace
	USER_TOKEN_STORE: DurableObjectNamespace
	ESI_SSO_CLIENT_ID: string
	ESI_SSO_CLIENT_SECRET: string
	ESI_SSO_CALLBACK_URL: string
	ADMIN_API_TOKENS: string
}

/** Variables can be extended */
export type Variables = SharedHonoVariables

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
