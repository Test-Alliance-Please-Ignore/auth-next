import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { createDb } from './db'
import type { EveCharacterSyncParams } from './workflows/sync-workflow'

interface CoreWorker {
	listUsersWithActiveCharacters(): Promise<Array<{ userId: string; characterIds: string[] }>>
	isMemberCorporation(corporationId: string): Promise<boolean>
	listUsersWithActiveCharactersPage(input: { limit: number; offset: number }): Promise<{
		users: Array<{ userId: string; characterIds: string[] }>
		totalCount: number
	}>
	getCharacterOwner(characterId: string): Promise<{ userId: string; isPrimary: boolean } | null>
	getUserCharacterIds(userId: string): Promise<string[]>
	getUsersNeedingCharacterDataSync(): Promise<{
		userBatches: Array<{ userId: string; characterIds: string[] }>
		unownedCharacterIds: string[]
	}>
	handleCharacterAffiliationChange(
		characterId: string,
		options?: { source?: string }
	): Promise<{
		usersMatched: number
		refreshUsersQueued: number
	}>
	handleCharacterAffiliationChanges(
		characterIds: string[],
		options?: { source?: string }
	): Promise<{
		usersMatched: number
		refreshUsersQueued: number
	}>
	queueTokenInvalidationAlerts(input: {
		userId: string
		characterIds: string[]
		source?: string
	}): Promise<{
		added: number
		skipped: number
		pendingCount: number
	}>
	syncUserCharacterTokenValidityBatch(input: {
		userId: string
		characterIds: string[]
		forceValidate?: boolean
	}): Promise<
		Array<{
			characterId: string
			previousHasValidToken: boolean | null
			nextHasValidToken: boolean | null
			validationStatus: string | null
			validationError: string | null
			refreshAttempted: boolean
			refreshSucceeded: boolean
		}>
	>
}

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	CORE: CoreWorker
	EVE_CHARACTER_DATA: DurableObjectNamespace
	EVE_TOKEN_STORE: DurableObjectNamespace
	ESI: DurableObjectNamespace
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
