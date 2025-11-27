import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	KEYCLOAK_API_BASEURL: string
	KEYCLOAK_TOKEN_URL: string
	KEYCLOAK_GRANT_TYPE: string
	KEYCLOAK_CLIENT_ID: string
	KEYCLOAK_CLIENT_SECRET: string
	MUMBLE: DurableObjectNamespace
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof import('./db').createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
