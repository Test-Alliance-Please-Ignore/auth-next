import { getStub, withRpcResult } from '@repo/do-utils'
import {
	getEsiInstanceForCharacter,
	getEsiInstanceForCorporation,
	getPublicEsiInstance,
} from '@repo/esi'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../../db'
import { DirectorManager } from '../../services/director-manager'

import type { CorporationTax } from '@repo/corporation-tax'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../../context'

/**
 * Create a token store stub (shared across steps)
 */
export function createTokenStore(env: Env): EveTokenStore {
	return getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
}

/** ESI is the only owner of ESI request, cache, and rate-limit policy. */
export function getCorporationEsi(env: Env, corporationId: string) {
	return getEsiInstanceForCorporation(env.ESI, corporationId)
}

export function getCharacterEsi(env: Env, characterId: string) {
	return getEsiInstanceForCharacter(env.ESI, characterId)
}

export function getPublicEsi(env: Env) {
	return getPublicEsiInstance(env.ESI)
}

/**
 * Create a DirectorManager instance for a specific corporation
 */
export function createDirectorManager(env: Env, corporationId: string): DirectorManager {
	const db = createDb(env.DATABASE_URL)
	const tokenStore = createTokenStore(env)
	return new DirectorManager(
		db,
		corporationId,
		tokenStore,
		async (characterId, expectedCorporationId, actualCorporationId) => {
			try {
				await withRpcResult(
					env.CORE.handleCharacterAffiliationChanges([characterId], {
						source: `director-affiliation-mismatch:${expectedCorporationId}:${actualCorporationId ?? 'unknown'}`,
					}),
					() => undefined
				)
			} catch (error) {
				logger.warn('[DirectorManager] Failed to propagate affiliation mismatch to Core', {
					corporationId: expectedCorporationId,
					characterId,
					actualCorporationId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		},
		async (_characterId, prunedCorporationId) => {
			try {
				await env.CACHE.delete(`directors:${prunedCorporationId}`)
			} catch (error) {
				logger.warn('[DirectorManager] Failed to invalidate directors cache after prune', {
					corporationId: prunedCorporationId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		},
		async ({ corporationId: targetCorporationId, healthyDirectorCount, isVerified }) => {
			try {
				await env.CORE.updateCorporationAuthHealth(targetCorporationId, {
					healthyDirectorCount,
					isVerified,
				})
			} catch (error) {
				logger.warn('[DirectorManager] Failed to propagate corporation auth health snapshot', {
					corporationId: targetCorporationId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		},
		async (characterId, options) =>
			await getCharacterEsi(env, characterId).fetchCharacterRoles(characterId, options),
		async (characterIds, options) =>
			await getPublicEsi(env).fetchCharacterAffiliation(
				characterIds[0] ?? '0',
				characterIds,
				options
			)
	)
}

/**
 * Get a corporation-specific data Durable Object stub
 */
export function getCorporationDataStub(env: Env, corporationId: string): EveCorporationData {
	return getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, corporationId)
}

/**
 * Get the shared data Durable Object stub (used for timestamp updates)
 */
export function getGlobalCorporationDataStub(env: Env): EveCorporationData {
	return getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, 'default')
}

/**
 * Get the global corporation-tax Durable Object stub.
 */
export function getCorporationTaxStub(env: Env): CorporationTax {
	return getStub<CorporationTax>(env.CORPORATION_TAX, 'default')
}
