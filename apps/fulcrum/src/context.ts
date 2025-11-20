import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { WorkflowParams } from './workflows/character-report.workflow'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	FULCRUM: DurableObjectNamespace
	ESI: DurableObjectNamespace
	ESI_TYPE_RESOLVER: DurableObjectNamespace
	CHARACTER_REPORTS: R2Bucket
	CHARACTER_REPORT_WORKFLOW: Workflow<WorkflowParams>
	CHARACTER_REPORTS_QUEUE: Queue
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof import('./db').createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
