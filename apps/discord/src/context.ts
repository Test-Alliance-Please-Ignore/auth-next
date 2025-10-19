import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	DISCORD: DurableObjectNamespace
	DISCORD_AUTHORIZE_URL: string
	DISCORD_TOKEN_URL: string
	DISCORD_TOKEN_REVOKE_URL: string
	DISCORD_CALLBACK_URL: string
	DISCORD_USER_INFO_URL: string

	DISCORD_CLIENT_ID: string
	DISCORD_CLIENT_SECRET: string
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
