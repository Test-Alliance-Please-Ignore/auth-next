import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

import type { SessionStore } from './session-store'

export type Env = SharedHonoEnv & {
	USER_SESSION_STORE: DurableObjectNamespace<SessionStore>
	GOOGLE_CLIENT_ID: string
	GOOGLE_CLIENT_SECRET: string
	GOOGLE_CALLBACK_URL: string
	TEST_AUTH_OIDC_ISSUER: string
	TEST_AUTH_CLIENT_ID: string
	TEST_AUTH_CLIENT_SECRET: string
	TEST_AUTH_CALLBACK_URL: string
}

/** Variables can be extended */
export type Variables = SharedHonoVariables

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
