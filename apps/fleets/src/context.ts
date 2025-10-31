import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	FLEETS: DurableObjectNamespace
	EVE_TOKEN_STORE: DurableObjectNamespace
	EVE_CHARACTER_DATA: DurableObjectNamespace
	EVE_CORPORATION_DATA: DurableObjectNamespace
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof import('./db').createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
