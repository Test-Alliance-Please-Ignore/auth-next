import type { Discord } from '@repo/discord'
import type { Groups } from '@repo/groups'
import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	BROADCASTS: DurableObjectNamespace
	DISCORD: DurableObjectNamespace
	GROUPS: DurableObjectNamespace
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
	/** Current authenticated user (set by session middleware from core) */
	user?: SessionUser
	discordDO?: Discord
	groupsDO?: Groups
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
