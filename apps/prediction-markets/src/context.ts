import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { Core } from '@repo/core'
import type { createDb } from './db'

export type Env = SharedHonoEnv & {
	/** Neon Postgres connection URL (pooled, runtime). */
	DATABASE_URL: string
	/** Prediction Markets Durable Object binding. */
	PREDICTION_MARKETS: DurableObjectNamespace
	/** Core service binding used to deliver durable Discord market-close notifications. */
	CORE: Core
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
