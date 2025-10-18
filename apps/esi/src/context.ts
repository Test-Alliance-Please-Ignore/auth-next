import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	ESI_CACHE: KVNamespace
	EVESSO_STORE: DurableObjectNamespace
	CHARACTER_DATA_STORE: DurableObjectNamespace
	USER_SESSION_STORE: DurableObjectNamespace
	TAG_STORE: DurableObjectNamespace
	EVE_UNIVERSE: DurableObjectNamespace
}

/** Variables can be extended */
export type Variables = SharedHonoVariables

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
