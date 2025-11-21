import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { createDb } from './db'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	HR: DurableObjectNamespace
	EVE_CORPORATION_DATA: DurableObjectNamespace
	EVE_CHARACTER_DATA: DurableObjectNamespace
	GROUPS: DurableObjectNamespace
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
