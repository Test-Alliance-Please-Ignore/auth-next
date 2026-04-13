import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { CoreWorker } from '../../core/src/index'
import type { createDb } from './db'
import type { WorkflowParams } from './workflows/character-report.workflow'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	APP_BASE_URL: string
	FULCRUM: DurableObjectNamespace
	ESI: DurableObjectNamespace
	ESI_TYPE_RESOLVER: DurableObjectNamespace
	UNIVERSE: DurableObjectNamespace
	CORE: Service<CoreWorker>
	CHARACTER_REPORTS: R2Bucket
	CHARACTER_REPORT_WORKFLOW: Workflow<WorkflowParams>
	CHARACTER_REPORTS_QUEUE: Queue
	DISCORD: DurableObjectNamespace
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
