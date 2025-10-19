import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { EveTokenStore } from '@repo/eve-token-store'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	EVE_CHARACTER_DATA: DurableObjectNamespace
	EVE_TOKEN_STORE: DurableObjectNamespace
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof import('./db').createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
