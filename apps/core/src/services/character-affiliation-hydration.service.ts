import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { userCharacters } from '../db/schema'
import { waitUntilWithTelemetry } from '../lib/background-task'
import { markCharacterDeletedEverywhere } from './character-deletion.service'

import type { EsiTypeResolver } from '@repo/esi'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Env } from '../context'
import type { createDb } from '../db'
import { logger } from '@repo/hono-helpers'

type CharacterAffiliationHydrationParams = {
	db: ReturnType<typeof createDb>
	env: Pick<Env, 'ESI_TYPE_RESOLVER' | 'EVE_TOKEN_STORE' | 'EVE_CHARACTER_DATA'> &
		Partial<Pick<Env, 'EVE_CORPORATION_DATA'>>
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
	const { db, env, characterId, executionCtx } = params
	const eveCharacterData = getStub<EveCharacterData>(env.EVE_CHARACTER_DATA, characterId)

	const publicRefreshResult = await eveCharacterData.refreshPublicCharacterData(characterId, false)

	if (publicRefreshResult.isDeleted) {
		await markCharacterDeletedEverywhere(db, env, characterId)
		return {
			characterId,
			characterName: publicRefreshResult.characterName ?? '',
			corporationId: '1000001',
			allianceId: null,
		}
	}

	const corporationId = publicRefreshResult.currentCorporationId ?? ''
	const allianceId = publicRefreshResult.currentAllianceId ?? null

	await db
		.update(userCharacters)
		.set({
			characterName: publicRefreshResult.characterName ?? '',
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
			logger.warn('[Auth] Failed to reconcile corporation membership after hydration', {
				characterId,
				corporationId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	if (executionCtx) {
		waitUntilWithTelemetry(
			executionCtx,
			'auth.affiliation-name-resolution',
			() =>
				resolveAffiliationNames({
					db,
					env,
					characterId,
					corporationId,
					allianceId,
				}),
			{
				characterId,
				corporationId,
				allianceId,
			}
		)
	}

	return {
		characterId,
		characterName: publicRefreshResult.characterName ?? '',
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
