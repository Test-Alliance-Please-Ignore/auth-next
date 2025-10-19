import type { DurableObjectStub } from 'cloudflare:workers'

import type { EveTokenStore } from '@repo/eve-token-store'
import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	/** EVE Token Store Durable Object binding */
	EVE_TOKEN_STORE: DurableObjectNamespace
	/** Secret for session token generation and signing */
	SESSION_SECRET: string
}

/** Session user data attached to request context */
export interface SessionUser {
	id: string
	mainCharacterOwnerHash: string
	sessionId: string
	characters: {
		id: string
		characterOwnerHash: string
		characterId: number
		characterName: string
		is_primary: boolean
	}[]
	is_admin: boolean
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof import('./db').createDb>
	/** Current authenticated user (set by session middleware) */
	user?: SessionUser
	/** EVE Token Store Durable Object stub */
	eveTokenStore?: DurableObjectStub<EveTokenStore>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
