import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { createDb } from './db'
import type { SrpRecentLossRefreshWorkflowParams } from './workflows/recent-loss-refresh.workflow'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	SRP: DurableObjectNamespace
	SRP_RECENT_LOSS_REFRESH_COORDINATOR: DurableObjectNamespace
	SRP_PAYMENT_STATUS_CHECK: Workflow<{ requestId: string }>
	SRP_RECENT_LOSS_REFRESH_WORKFLOW: Workflow<SrpRecentLossRefreshWorkflowParams>
	DISCORD: DurableObjectNamespace
	// Durable Object bindings for integration with other services
	MARKETS: DurableObjectNamespace
	EVE_CHARACTER_DATA: DurableObjectNamespace
	EVE_CORPORATION_DATA: DurableObjectNamespace
	EVE_TOKEN_STORE: DurableObjectNamespace
	ESI: DurableObjectNamespace
	ESI_TYPE_RESOLVER: DurableObjectNamespace
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
