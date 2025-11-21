import type { Groups } from '@repo/groups'
import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { createDb } from './db'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	GROUPS: DurableObjectNamespace
	EVE_CHARACTER_DATA: DurableObjectNamespace
	CORE: DurableObjectNamespace
	GROUPS_KV: KVNamespace
	PUBLIC_URL: string // Added PUBLIC_URL
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof createDb>
	groupsDO?: Groups
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
