import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
/** Variables can be extended */
import type { createDb } from './common/db'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	STRUCTURE_MONITOR: DurableObjectNamespace
	STRUCTURE_COORDINATOR: DurableObjectNamespace
	EVE_CORPORATION_DATA: DurableObjectNamespace
	EVE_TOKEN_STORE: DurableObjectNamespace
	UNIVERSE: DurableObjectNamespace
}

export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
