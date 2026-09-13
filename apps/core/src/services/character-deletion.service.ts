import { eq } from 'drizzle-orm'

import { getStub } from '@repo/do-utils'

import { userCharacters } from '../db/schema'
import { clearUserBillScopeCache } from '../lib/billing-scope-cache'
import { clearUserProfileCache } from '../lib/user-profile-cache'

import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../context'
import type { createDb } from '../db'

export const DOOMHEIM_CORPORATION_ID = '1000001'

type CharacterDeletionDb = ReturnType<typeof createDb>

type CharacterDeletionEnv = Pick<Env, 'EVE_TOKEN_STORE'> &
	Partial<Pick<Env, 'EVE_CORPORATION_DATA' | 'BILLING_SCOPE_CACHE'>>

export async function markCharacterDeletedEverywhere(
	db: CharacterDeletionDb,
	env: CharacterDeletionEnv,
	characterId: string,
	options?: { reconcileCorporationMembership?: boolean }
): Promise<void> {
	const character = await db.query.userCharacters.findFirst({
		where: eq(userCharacters.characterId, characterId),
		columns: { userId: true },
	})
	await db
		.update(userCharacters)
		.set({
			isDeleted: true,
			hasValidToken: false,
			updatedAt: new Date(),
		})
		.where(eq(userCharacters.characterId, characterId))
	if (character) {
		await clearUserBillScopeCache(character.userId, env.BILLING_SCOPE_CACHE)
		clearUserProfileCache(character.userId)
	}

	try {
		const tokenStore = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
		await tokenStore.markCharacterDeleted(characterId)
	} catch {
		// Best effort: core state is still soft-deleted even if token-store sync fails.
	}

	if (options?.reconcileCorporationMembership !== false && env.EVE_CORPORATION_DATA) {
		try {
			const corporationData = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, 'default')
			await corporationData.reconcileCharacterCorporationMembership(characterId, null)
		} catch {
			// Best effort: corp membership cleanup should not block soft-delete marking.
		}
	}
}
