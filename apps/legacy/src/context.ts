import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { createDb } from './db'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	CORE: DurableObjectNamespace
}

export type Variables = SharedHonoVariables & {
	db: ReturnType<typeof createDb>
	sessionUserId?: string
	sessionIsAdmin?: boolean
	sessionHeaders?: Headers
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
