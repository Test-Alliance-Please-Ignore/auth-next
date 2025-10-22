import type { Groups } from '@repo/groups'
import type { Notifications } from '@repo/notifications'
import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	GROUPS: DurableObjectNamespace
	NOTIFICATIONS: DurableObjectNamespace
	GROUPS_KV: KVNamespace
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof import('./db').createDb>
	groupsDO?: Groups
	notificationsDO?: Notifications
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
