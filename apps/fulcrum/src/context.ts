import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { createDb } from './db'
import type { CoreBinding } from './types/core-binding'
import type { BulkCharacterReportWorkflowParams } from './workflows/bulk-character-report.workflow.js'
import type { WorkflowParams } from './workflows/character-report.workflow.js'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	APP_BASE_URL: string
	FULCRUM: DurableObjectNamespace
	ESI: DurableObjectNamespace
	ESI_TYPE_RESOLVER: DurableObjectNamespace
	UNIVERSE: DurableObjectNamespace
	CORE: CoreBinding
	CHARACTER_REPORTS: R2Bucket
	CHARACTER_REPORT_WORKFLOW: Workflow<WorkflowParams>
	BULK_CHARACTER_REPORT_WORKFLOW: Workflow<BulkCharacterReportWorkflowParams>
	CHARACTER_REPORTS_QUEUE: Queue
	DISCORD: DurableObjectNamespace
	HR: DurableObjectNamespace
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
