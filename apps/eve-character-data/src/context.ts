import type { EveTokenStore } from '@repo/eve-token-store'
import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { createDb } from './db'
import type { EveCharacterSyncParams } from './workflows/sync-workflow'

interface CoreWorker {
	listUsersWithActiveCharacters(): Promise<Array<{ userId: string; characterIds: string[] }>>
	getCharacterOwner(
		characterId: string
	): Promise<{ userId: string; isPrimary: boolean } | null>
	handleCharacterAffiliationChange(
		characterId: string,
		options?: {
			source?: string
			bypassThrottle?: boolean
		}
	): Promise<{
		usersMatched: number
		workflowsTriggered: number
		discordUsersQueued: number
	}>
	handleCharacterAffiliationChanges(
		characterIds: string[],
		options?: {
			source?: string
			bypassThrottle?: boolean
		}
	): Promise<{
		usersMatched: number
		workflowsTriggered: number
		discordUsersQueued: number
	}>
}

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	CORE: CoreWorker
	EVE_CHARACTER_DATA: DurableObjectNamespace
	EVE_TOKEN_STORE: DurableObjectNamespace
	/** Workflow binding for character sync */
	EVE_CHARACTER_SYNC: Workflow<EveCharacterSyncParams>
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
