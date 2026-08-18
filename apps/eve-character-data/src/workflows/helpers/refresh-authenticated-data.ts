import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../../context'

export interface RefreshAuthenticatedDataResult {
	success: boolean
	hasValidToken: boolean
	walletDataAllowed: boolean
	walletDataSkipReason?: 'missing_corporation' | 'not_member_corporation'
	walletJournalRefreshed: boolean
	marketTransactionsRefreshed: boolean
}

export interface RefreshAuthenticatedDataOptions {
	includeAuthenticatedData: boolean
	includeWalletJournal: boolean
	includeMarketTransactions: boolean
	corporationId?: string | null
}

/**
 * Refresh authenticated character data (skills, attributes, wallet balance)
 * Creates its own Durable Object stubs to avoid sharing invalidated stubs
 * Returns success: false if token is invalid/missing (non-fatal)
 */
export async function refreshAuthenticatedData(
	env: Env,
	characterId: string,
	options: RefreshAuthenticatedDataOptions
): Promise<RefreshAuthenticatedDataResult> {
	const normalizedCharacterId = String(characterId)

	// Create fresh stubs for this operation
	const characterDataStub = getStub<EveCharacterData>(env.EVE_CHARACTER_DATA, 'default')
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
				walletDataAllowed: false,
				walletJournalRefreshed: false,
				marketTransactionsRefreshed: false,
			}
		}

		const characterInfo =
			options.corporationId === undefined
				? await characterDataStub.getCharacterInfo(normalizedCharacterId)
				: null
		const corporationId =
			options.corporationId !== undefined
				? options.corporationId
				: (characterInfo?.corporationId ?? null)
		const walletDataAllowed =
			corporationId !== null && (await env.CORE.isMemberCorporation(String(corporationId)))
		const walletDataSkipReason =
			corporationId === null
				? 'missing_corporation'
				: walletDataAllowed
					? undefined
					: 'not_member_corporation'

		if (options.includeAuthenticatedData) {
			// Skills and attributes remain available for all characters. Wallet balance
			// is restricted to the same member-corporation scope as wallet history.
			await characterDataStub.fetchAuthenticatedData(normalizedCharacterId, true, {
				includeSkills: true,
				includeAttributes: true,
				includeWallet: walletDataAllowed,
			})
		}

		let walletJournalRefreshed = false
		let marketTransactionsRefreshed = false
		if (walletDataAllowed) {
			if (options.includeWalletJournal) {
				await characterDataStub.fetchWalletJournal(normalizedCharacterId, true)
				walletJournalRefreshed = true
			}
			if (options.includeMarketTransactions) {
				await characterDataStub.fetchMarketTransactions(normalizedCharacterId, true)
				marketTransactionsRefreshed = true
			}
		}

		logger.info('[refreshAuthenticatedData] Authenticated data refreshed', {
			characterId: normalizedCharacterId,
			corporationId: corporationId ? String(corporationId) : null,
			walletDataAllowed,
			walletDataSkipReason,
			walletJournalRefreshed,
			marketTransactionsRefreshed,
		})

		return {
			success: true,
			hasValidToken: true,
			walletDataAllowed,
			walletDataSkipReason,
			walletJournalRefreshed,
			marketTransactionsRefreshed,
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
				walletDataAllowed: false,
				walletJournalRefreshed: false,
				marketTransactionsRefreshed: false,
			}
		}

		logger.error('[refreshAuthenticatedData] Failed to refresh authenticated data', {
			characterId: normalizedCharacterId,
			error: errorMessage,
		})
		throw error
	}
}
