import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../../context'

export interface RefreshWalletJournalResult {
	success: boolean
	hasValidToken: boolean
	entryCount?: number
}

/**
 * Refresh character wallet journal entries
 * Creates its own Durable Object stubs to avoid sharing invalidated stubs
 * Returns success: false if token is invalid/missing (non-fatal)
 */
export async function refreshWalletJournal(
	env: Env,
	characterId: string
): Promise<RefreshWalletJournalResult> {
	// Create fresh stubs for this operation
	const characterDataStub = getStub<EveCharacterData>(env.EVE_CHARACTER_DATA, 'default')
	const tokenStoreStub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	using characterData = await characterDataStub.getInstance(characterId)

	try {
		// Check if token exists and is valid
		const tokenInfo = await tokenStoreStub.getTokenInfo(characterId)
		if (!tokenInfo || tokenInfo.isExpired) {
			logger.info('[refreshWalletJournal] No valid token, skipping', {
				characterId,
			})
			return {
				success: false,
				hasValidToken: false,
			}
		}

		// Fetch and store wallet journal
		await characterData.fetchWalletJournal(true)

		// Get entry count
		const entries = await characterData.getWalletJournal()
		const entryCount = entries.length

		logger.info('[refreshWalletJournal] Wallet journal refreshed', {
			characterId,
			entryCount,
		})

		return {
			success: true,
			hasValidToken: true,
			entryCount,
		}
	} catch (error) {
		// If token-related error, return non-fatal result
		const errorMessage = error instanceof Error ? error.message : String(error)
		if (errorMessage.includes('token') || errorMessage.includes('unauthorized')) {
			logger.info('[refreshWalletJournal] Token error, skipping', {
				characterId,
				error: errorMessage,
			})
			return {
				success: false,
				hasValidToken: false,
			}
		}

		logger.error('[refreshWalletJournal] Failed to refresh wallet journal', {
			characterId,
			error: errorMessage,
		})
		throw error
	}
}

