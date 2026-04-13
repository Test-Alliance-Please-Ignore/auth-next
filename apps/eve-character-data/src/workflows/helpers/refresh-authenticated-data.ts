import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../../context'

export interface RefreshAuthenticatedDataResult {
	success: boolean
	hasValidToken: boolean
}

/**
 * Refresh authenticated character data (skills, attributes, wallet balance)
 * Creates its own Durable Object stubs to avoid sharing invalidated stubs
 * Returns success: false if token is invalid/missing (non-fatal)
 */
export async function refreshAuthenticatedData(
	env: Env,
	characterId: string
): Promise<RefreshAuthenticatedDataResult> {
	const normalizedCharacterId = String(characterId)

	// Create fresh stubs for this operation
	const characterDataStub = getStub<EveCharacterData>(env.EVE_CHARACTER_DATA, normalizedCharacterId)
	const tokenStoreStub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')

	try {
		// Check if token exists and is valid
		const tokenInfo = await tokenStoreStub.getTokenInfo(normalizedCharacterId)
		if (!tokenInfo || tokenInfo.isExpired) {
			logger.info('[refreshAuthenticatedData] No valid token, skipping', {
				characterId: normalizedCharacterId,
			})
			return {
				success: false,
				hasValidToken: false,
			}
		}

		// Fetch and store authenticated data (skills, attributes, wallet balance)
		await characterDataStub.fetchAuthenticatedData(normalizedCharacterId, true)

		logger.info('[refreshAuthenticatedData] Authenticated data refreshed', {
			characterId: normalizedCharacterId,
		})

		return {
			success: true,
			hasValidToken: true,
		}
	} catch (error) {
		// If token-related error, return non-fatal result
		const errorMessage = error instanceof Error ? error.message : String(error)
		if (errorMessage.includes('token') || errorMessage.includes('unauthorized')) {
			logger.info('[refreshAuthenticatedData] Token error, skipping', {
				characterId: normalizedCharacterId,
				error: errorMessage,
			})
			return {
				success: false,
				hasValidToken: false,
			}
		}

		logger.error('[refreshAuthenticatedData] Failed to refresh authenticated data', {
			characterId: normalizedCharacterId,
			error: errorMessage,
		})
		throw error
	}
}
