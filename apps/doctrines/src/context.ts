import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	DOCTRINES: DurableObjectNamespace
	GROUPS: DurableObjectNamespace
	EVE_CHARACTER_DATA: DurableObjectNamespace
	EVE_STATIC_DATA: DurableObjectNamespace
	UNIVERSE: DurableObjectNamespace
}

export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof import('./db').createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
