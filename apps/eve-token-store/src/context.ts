import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	EVE_TOKEN_STORE: DurableObjectNamespace

	// EVE SSO OAuth Configuration
	// These secrets should be set via: wrangler secret put <SECRET_NAME>
	/** EVE SSO OAuth Client ID */
	EVE_SSO_CLIENT_ID: string
	/** EVE SSO OAuth Client Secret */
	EVE_SSO_CLIENT_SECRET: string
	/** EVE SSO OAuth Callback URL (e.g., https://your-worker.workers.dev/auth/callback) */
	EVE_SSO_CALLBACK_URL: string
	/** Encryption key for storing tokens (32-byte hex string) */
	ENCRYPTION_KEY: string
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof import('./db').createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
