import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { Core } from '@repo/core'
import type { createDb } from './db'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	BILL_OVERDUE_ALERT_MAX_AGE_HOURS?: string
	BILLS: DurableObjectNamespace
	ESI: DurableObjectNamespace
	ESI_TYPE_RESOLVER: DurableObjectNamespace
	DISCORD: DurableObjectNamespace
	EVE_CORPORATION_DATA: DurableObjectNamespace
	CORPORATION_TAX: DurableObjectNamespace
	GROUPS: DurableObjectNamespace
	CORE: Core
	BILLS_SCHEDULE_EXECUTOR: Workflow<{ scheduleId: string }>
	BILL_PAYMENT_STATUS_CHECK: Workflow<{ billId: string }>
	BILL_DISCORD_NOTIFY: Workflow<{ notificationEventId: string }>
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
