import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { createDb } from './db'
import type { DailyPriceBatchParams } from './workflows/daily-price-batch.workflow'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	MARKETS: DurableObjectNamespace
	UNIVERSE: DurableObjectNamespace
	EVE_TOKEN_STORE: DurableObjectNamespace
	ESI: DurableObjectNamespace
	FEATURES?: DurableObjectNamespace
	DAILY_PRICE_BATCH_WORKFLOW: Workflow<DailyPriceBatchParams>
	MAX_SNAPSHOTS_PER_LOCATION?: number
	MAX_DAILY_PRICE_HISTORY_DAYS?: number
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof createDb>
	apiKeyId?: string
	apiKeyName?: string
	requestId?: string
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
