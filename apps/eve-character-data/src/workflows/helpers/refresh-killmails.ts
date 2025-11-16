import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../../context'

export interface RefreshKillmailsResult {
	success: boolean
	hasValidToken: boolean
	killmailCount?: number
}

/**
 * Refresh character killmails
 * Creates its own Durable Object stubs to avoid sharing invalidated stubs
 * Returns success: false if token is invalid/missing (non-fatal)
 */
export async function refreshKillmails(
	env: Env,
	characterId: string
): Promise<RefreshKillmailsResult> {
	// Create fresh stubs for this operation
	const characterDataStub = getStub<EveCharacterData>(env.EVE_CHARACTER_DATA, characterId)
	const tokenStoreStub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	const characterData = await characterDataStub.getInstance(characterId)

	try {
		// Check if token exists and is valid
		const tokenInfo = await tokenStoreStub.getTokenInfo(characterId)
		if (!tokenInfo || tokenInfo.isExpired) {
			logger.info('[refreshKillmails] No valid token, skipping', {
				characterId,
			})
			return {
				success: false,
				hasValidToken: false,
			}
		}

		// Fetch and store killmails
		await characterData.fetchKillmails()

		// Get killmail count
		const killmails = await characterData.getKillmails(100)
		const killmailCount = killmails.length

		logger.info('[refreshKillmails] Killmails refreshed', {
			characterId,
			killmailCount,
		})

		return {
			success: true,
			hasValidToken: true,
			killmailCount,
		}
	} catch (error) {
		// If token-related error, return non-fatal result
		const errorMessage = error instanceof Error ? error.message : String(error)
		if (errorMessage.includes('token') || errorMessage.includes('unauthorized')) {
			logger.info('[refreshKillmails] Token error, skipping', {
				characterId,
				error: errorMessage,
			})
			return {
				success: false,
				hasValidToken: false,
			}
		}

		logger.error('[refreshKillmails] Failed to refresh killmails', {
			characterId,
			error: errorMessage,
		})
		throw error
	}
}

