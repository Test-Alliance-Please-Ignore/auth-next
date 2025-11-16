import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { NotificationTransportExecutor, Notifications } from '@repo/notifications'
import type { createDb } from './db'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	NOTIFICATIONS: DurableObjectNamespace
	/** Transport executor for sending notifications via different channels */
	transportExecutor?: NotificationTransportExecutor
	// Additional transport bindings can be added here as needed:
	// DISCORD_SERVICE?: Fetcher
	// EMAIL_SERVICE?: Fetcher
	// NOTIFICATION_QUEUE?: Queue
	// NOTIFICATION_WORKFLOW?: Workflow
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof createDb>
	notificationsDO?: Notifications
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
