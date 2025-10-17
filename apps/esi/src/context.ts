import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	ESI_CACHE: KVNamespace
	USER_TOKEN_STORE: DurableObjectNamespace
	CHARACTER_DATA_STORE: DurableObjectNamespace
	USER_SESSION_STORE: DurableObjectNamespace
	ESI_SSO_CLIENT_ID: string
	ESI_SSO_CLIENT_SECRET: string
	ESI_SSO_CALLBACK_URL: string
	ADMIN_API_TOKENS: string
	SOCIAL_AUTH: Fetcher
}

/** Variables can be extended */
export type Variables = SharedHonoVariables

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
