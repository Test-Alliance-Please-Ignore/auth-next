import type { TaxAssessmentWorkflowParams } from '@repo/corporation-tax'
import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { createDb } from './db'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	ESS_ALERT_THRESHOLD_ISK?: string
	CORPORATION_TAX: DurableObjectNamespace
	BILLS: DurableObjectNamespace
	EVE_CORPORATION_DATA: DurableObjectNamespace
	EVE_CHARACTER_DATA: DurableObjectNamespace
	DISCORD: DurableObjectNamespace
	TAX_ASSESSMENT_WORKFLOW: Workflow<TaxAssessmentWorkflowParams>
}

export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
