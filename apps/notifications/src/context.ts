import type { Notifications } from '@repo/notifications'
import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	NOTIFICATIONS: DurableObjectNamespace
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof import('./db').createDb>
	notificationsDO?: Notifications
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
