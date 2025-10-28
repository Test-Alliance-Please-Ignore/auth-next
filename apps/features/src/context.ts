import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { DbClient } from './db'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	FEATURES: DurableObjectNamespace
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: DbClient
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
