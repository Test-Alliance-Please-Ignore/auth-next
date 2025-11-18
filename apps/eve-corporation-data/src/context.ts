import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { createDb } from './db'
import type { EveCorporationSyncParams } from './workflows/sync-workflow'

// Define CoreWorker RPC interface
export interface CoreWorker {
	getCorporationsForBackgroundRefresh(): Promise<Array<{ corporationId: string; name: string }>>
	updateCorporationLastSync(corporationId: string): Promise<void>
}

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	/** Core worker service binding for RPC calls */
	CORE: CoreWorker
	EVE_CORPORATION_DATA: DurableObjectNamespace
	EVE_TOKEN_STORE: DurableObjectNamespace
	UNIVERSE: DurableObjectNamespace
	/** KV cache for directors and other data */
	CACHE: KVNamespace
	/** Workflow binding for corporation sync */
	EVE_CORPORATION_SYNC: Workflow<EveCorporationSyncParams>

	// Queue binding for notifying HR worker of departed members
	'hr-member-departed': Queue<{ corporationId: string; characterId: string }>
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
