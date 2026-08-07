import { withRpcResult } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import {
	createDirectorManager,
	createTokenStore,
	getCorporationDataStub,
} from '../../utils/services'

import type { CorporationRole } from '@repo/eve-corporation-data'
import type { Env } from '../../../context'
import type { DirectorInfo } from '../../types'

/**
 * Select a healthy director for the corporation
 */
export async function selectDirector(
	env: Env,
	corporationId: string,
	options?: { requiredRoleSets?: CorporationRole[][] }
): Promise<DirectorInfo | null> {
	try {
		const directorManager = createDirectorManager(env, corporationId)
		const selected = await directorManager.selectDirector(options)

		if (!selected) {
			logger.error('[DirectorStep] No healthy directors available', { corporationId })
			return null
		}

		logger.info('[DirectorStep] Director selected', {
			corporationId,
			characterId: selected.characterId,
			characterName: selected.characterName,
		})

		return selected
	} catch (error) {
		logger.error(
			'[DirectorStep] Director selection failed; continuing without authenticated steps',
			{
				corporationId,
				error: error instanceof Error ? error.message : String(error),
			}
		)
		return null
	}
}

/**
 * Record success for the director once workflow completes
 */
export async function recordDirectorSuccess(
	env: Env,
	corporationId: string,
	directorId: string
): Promise<void> {
	const directorManager = createDirectorManager(env, corporationId)
	await directorManager.recordSuccess(directorId)
}

export async function recordDirectorFailure(
	env: Env,
	corporationId: string,
	directorId: string,
	reason: string,
	options?: { forceUnhealthy?: boolean }
): Promise<void> {
	const directorManager = createDirectorManager(env, corporationId)
	await directorManager.recordFailure(directorId, reason, options)
}

export async function verifyAllDirectorsHealth(
	env: Env,
	corporationId: string
): Promise<{ verified: number; failed: number }> {
	const directorManager = createDirectorManager(env, corporationId)
	return await directorManager.verifyAllDirectorsHealth({
		bypassPermanentFailures: true,
	})
}

type EsiCorporationMemberRole = {
	character_id: number
	roles?: string[]
	roles_at_hq?: string[]
	roles_at_base?: string[]
	roles_at_other?: string[]
}

function hasDirectorAuthority(role: EsiCorporationMemberRole): boolean {
	const allRoles = [
		...(role.roles ?? []),
		...(role.roles_at_hq ?? []),
		...(role.roles_at_base ?? []),
		...(role.roles_at_other ?? []),
	]
	return allRoles.includes('Director') || allRoles.includes('CEO')
}

async function resolveCharacterName(env: Env, characterId: string): Promise<string> {
	const tokenStore = createTokenStore(env)
	try {
		return await withRpcResult(
			tokenStore.fetchPublicEsi<{ name?: string }>(`/characters/${characterId}`),
			(result) => result.data?.name?.trim() || characterId
		)
	} catch (error) {
		logger.warn('[DirectorStep] Failed to resolve character name while auto-adding director', {
			characterId,
			error: error instanceof Error ? error.message : String(error),
		})
		return characterId
	}
}

async function isCharacterLinkedToUser(env: Env, characterId: string): Promise<boolean> {
	try {
		return await withRpcResult(env.CORE.getCharacterOwner(characterId), (owner) => owner !== null)
	} catch (error) {
		logger.warn('[DirectorStep] Failed to verify character ownership while reconciling directors', {
			characterId,
			error: error instanceof Error ? error.message : String(error),
		})
		return false
	}
}

/**
 * Reconcile configured directors against authoritative corp role roster.
 *
 * Ensures promotions to Director/CEO are auto-added and demotions are pruned.
 */
export async function reconcileDirectorsFromCorporationRoles(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<{ added: number; removed: number; discovered: number; skippedUnlinked: number }> {
	const tokenStore = createTokenStore(env)
	const corpData = getCorporationDataStub(env, corporationId)
	const authoritativeDirectorIds = await withRpcResult(
		tokenStore.fetchEsi<EsiCorporationMemberRole[]>(
			`/corporations/${corporationId}/roles`,
			directorCharacterId,
			{ cacheMode: 'no-store' }
		),
		(rolesResponse) =>
			new Set(
				rolesResponse.data.filter(hasDirectorAuthority).map((row) => String(row.character_id))
			)
	)
	const existingDirectors = await withRpcResult(corpData.getDirectors(corporationId), (directors) =>
		directors.map((director) => ({ ...director }))
	)
	const existingDirectorIds = new Set(existingDirectors.map((d) => d.characterId))

	const toAdd = [...authoritativeDirectorIds].filter(
		(characterId) => !existingDirectorIds.has(characterId)
	)
	const toRemove = existingDirectors
		.filter((d) => !authoritativeDirectorIds.has(d.characterId))
		.map((d) => d.characterId)
	let skippedUnlinked = 0

	for (const characterId of toAdd) {
		const isLinked = await isCharacterLinkedToUser(env, characterId)
		if (!isLinked) {
			skippedUnlinked++
			logger.info('[DirectorStep] Skipping auto-add for director candidate without linked user', {
				corporationId,
				characterId,
			})
			continue
		}

		const characterName = await resolveCharacterName(env, characterId)
		await corpData.addDirector(corporationId, characterId, characterName, 100)
	}

	for (const characterId of toRemove) {
		await corpData.removeDirector(corporationId, characterId)
	}

	logger.info('[DirectorStep] Reconciled directors from corporation roles', {
		corporationId,
		discovered: authoritativeDirectorIds.size,
		added: toAdd.length - skippedUnlinked,
		removed: toRemove.length,
		skippedUnlinked,
	})

	return {
		added: toAdd.length - skippedUnlinked,
		removed: toRemove.length,
		discovered: authoritativeDirectorIds.size,
		skippedUnlinked,
	}
}
