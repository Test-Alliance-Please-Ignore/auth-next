import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { createDb } from './db'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	FLEETS: DurableObjectNamespace
	FLEET_MONITOR: DurableObjectNamespace
	EVE_TOKEN_STORE: DurableObjectNamespace
	ESI: DurableObjectNamespace
	ESI_TYPE_RESOLVER: DurableObjectNamespace
	EVE_CHARACTER_DATA: DurableObjectNamespace
	EVE_CORPORATION_DATA: DurableObjectNamespace
	UNIVERSE: DurableObjectNamespace
	EVE_SSO_CLIENT_ID: string
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
