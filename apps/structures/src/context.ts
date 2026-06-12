import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export interface SessionUser {
	id: string
	is_admin: boolean
	roles: string[]
}

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	EVE_CORPORATION_DATA: DurableObjectNamespace
}

export type Variables = SharedHonoVariables & {
	user?: SessionUser
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
