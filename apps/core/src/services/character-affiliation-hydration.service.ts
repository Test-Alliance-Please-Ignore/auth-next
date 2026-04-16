import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { getEsiInstanceForCharacter } from '@repo/esi'

import { userCharacters } from '../db/schema'

import type { EsiTypeResolver } from '@repo/esi'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Env } from '../context'
import type { createDb } from '../db'

type CharacterAffiliationHydrationParams = {
	db: ReturnType<typeof createDb>
	env: Pick<Env, 'ESI' | 'ESI_TYPE_RESOLVER'> & Partial<Pick<Env, 'EVE_CORPORATION_DATA'>>
	characterId: string
	cacheMode?: 'default' | 'no-store'
	executionCtx?: ExecutionContext
}

export interface HydratedCharacterAffiliation {
	characterId: string
	characterName: string
	corporationId: string
	allianceId: string | null
}

/**
 * Fetch and persist authoritative character affiliation data immediately.
 *
 * IDs are persisted synchronously so downstream role reconciliation can run
 * against non-null affiliation state during the same request lifecycle.
 *
 * Name resolution is best-effort and runs in the background when an execution
 * context is available.
 */
export async function hydrateCharacterAffiliation(
	params: CharacterAffiliationHydrationParams
): Promise<HydratedCharacterAffiliation> {
	const { db, env, characterId, cacheMode = 'no-store', executionCtx } = params
	const esiStub = getEsiInstanceForCharacter(env.ESI, characterId)

	const characterInfo = await esiStub.fetchCharacterPublicInfo(characterId, { cacheMode })
	const corporationId = String(characterInfo.corporation_id)
	const allianceId = characterInfo.alliance_id ? String(characterInfo.alliance_id) : null

	await db
		.update(userCharacters)
		.set({
			characterName: characterInfo.name,
			corporationId,
			allianceId,
			lastCharacterRefresh: new Date(),
			isDeleted: false,
			updatedAt: new Date(),
		})
		.where(eq(userCharacters.characterId, characterId))

	if (env.EVE_CORPORATION_DATA) {
		try {
			const corporationData = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, 'default')
			await corporationData.reconcileCharacterCorporationMembership(characterId, corporationId)
		} catch (error) {
			console.warn('[Auth] Failed to reconcile corporation membership after hydration', {
				characterId,
				corporationId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	if (executionCtx) {
		executionCtx.waitUntil(
			resolveAffiliationNames({
				db,
				env,
				characterId,
				corporationId,
				allianceId,
			}).catch((error) => {
				console.warn('[Auth] Failed to resolve affiliation names after hydration', {
					characterId,
					error: error instanceof Error ? error.message : String(error),
				})
			})
		)
	}

	return {
		characterId,
		characterName: characterInfo.name,
		corporationId,
		allianceId,
	}
}

type ResolveAffiliationNamesParams = {
	db: ReturnType<typeof createDb>
	env: Pick<Env, 'ESI_TYPE_RESOLVER'>
	characterId: string
	corporationId: string
	allianceId: string | null
}

async function resolveAffiliationNames(params: ResolveAffiliationNamesParams): Promise<void> {
	const { db, env, characterId, corporationId, allianceId } = params
	const typeResolver = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')

	const idsToResolve = [corporationId]
	if (allianceId) {
		idsToResolve.push(allianceId)
	}

	const nameMap = await typeResolver.resolveIds(idsToResolve)
	await db
		.update(userCharacters)
		.set({
			corporationName: nameMap[corporationId] ?? null,
			allianceName: allianceId ? nameMap[allianceId] ?? null : null,
			updatedAt: new Date(),
		})
		.where(eq(userCharacters.characterId, characterId))
}
