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
 * Refresh authenticated character data (skills, attributes)
 * Creates its own Durable Object stubs to avoid sharing invalidated stubs
 * Returns success: false if token is invalid/missing (non-fatal)
 */
export async function refreshAuthenticatedData(
	env: Env,
	characterId: string
): Promise<RefreshAuthenticatedDataResult> {
	// Create fresh stubs for this operation
	using characterDataStub = getStub<EveCharacterData>(env.EVE_CHARACTER_DATA, characterId)
	using tokenStoreStub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	const characterData = await characterDataStub.getInstance(characterId)

	try {
		// Check if token exists and is valid
		const tokenInfo = await tokenStoreStub.getTokenInfo(characterId)
		if (!tokenInfo || tokenInfo.isExpired) {
			logger.info('[refreshAuthenticatedData] No valid token, skipping', {
				characterId,
			})
			return {
				success: false,
				hasValidToken: false,
			}
		}

		// Fetch and store authenticated data (skills, attributes)
		await characterData.fetchAuthenticatedData(true)

		logger.info('[refreshAuthenticatedData] Authenticated data refreshed', {
			characterId,
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
				characterId,
				error: errorMessage,
			})
			return {
				success: false,
				hasValidToken: false,
			}
		}

		logger.error('[refreshAuthenticatedData] Failed to refresh authenticated data', {
			characterId,
			error: errorMessage,
		})
		throw error
	}
}

