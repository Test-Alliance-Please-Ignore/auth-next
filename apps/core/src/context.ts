import type { AdminWorker as IAdminWorker } from '@repo/admin'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Groups } from '@repo/groups'
import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { Notifications } from '@repo/notifications'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	/** Admin worker service binding (RPC) */
	ADMIN: IAdminWorker
	/** EVE Token Store Durable Object binding */
	EVE_TOKEN_STORE: DurableObjectNamespace
	/** EVE Character Data Durable Object binding */
	EVE_CHARACTER_DATA: DurableObjectNamespace
	/** EVE Corporation Data Durable Object binding */
	EVE_CORPORATION_DATA: DurableObjectNamespace
	/** Groups Durable Object binding */
	GROUPS: DurableObjectNamespace
	/** Notifications Durable Object binding */
	NOTIFICATIONS: DurableObjectNamespace
	/** Discord Durable Object binding */
	DISCORD: DurableObjectNamespace
	/** EVE Static Data service binding */
	EVE_STATIC_DATA: Fetcher
	/** Secret for session token generation and signing */
	SESSION_SECRET: string
}

/** Session user data attached to request context */
export interface SessionUser {
	id: string
	mainCharacterId: string
	sessionId: string
	characters: Array<{
		id: string
		characterOwnerHash: string
		characterId: string
		characterName: string
		is_primary: boolean
		hasValidToken: boolean
	}>
	is_admin: boolean
	/** Discord profile (if linked) */
	discord?: {
		userId: string
		username: string
		discriminator: string
		authRevoked: boolean
		authRevokedAt: Date | null
		lastSuccessfulAuth: Date | null
	}
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof import('./db').createDb>
	/** Current authenticated user (set by session middleware) */
	user?: SessionUser
	/** EVE Token Store Durable Object stub */
	eveTokenStore?: EveTokenStore
	/** EVE Character Data Durable Object stub */
	eveCharacterData?: EveCharacterData
	/** Groups Durable Object stub */
	groupsDO?: Groups
	/** Notifications Durable Object stub */
	notificationsDO?: Notifications
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
