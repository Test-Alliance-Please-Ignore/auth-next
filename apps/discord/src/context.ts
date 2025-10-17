import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	DISCORD_STORE: DurableObjectNamespace
	USER_SESSION_STORE: DurableObjectNamespace
	DISCORD_CLIENT_ID: string
	DISCORD_CLIENT_SECRET: string
	DISCORD_CALLBACK_URL: string
}

/** Variables can be extended */
export type Variables = SharedHonoVariables

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
