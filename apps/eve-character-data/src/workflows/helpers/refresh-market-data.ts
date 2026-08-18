import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../../context'

export interface RefreshMarketDataResult {
	success: boolean
	hasValidToken: boolean
	transactionCount?: number
	orderCount?: number
}

/**
 * Refresh character market data (transactions and orders)
 * Creates its own Durable Object stubs to avoid sharing invalidated stubs
 * Returns success: false if token is invalid/missing (non-fatal)
 */
export async function refreshMarketData(
	env: Env,
	characterId: string
): Promise<RefreshMarketDataResult> {
	// Create fresh stubs for this operation
	const characterDataStub = getStub<EveCharacterData>(env.EVE_CHARACTER_DATA, 'default')
	const tokenStoreStub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	using characterData = await characterDataStub.getInstance(characterId)

	try {
		// Check if token exists and is valid
		const tokenInfo = await tokenStoreStub.getTokenInfo(characterId)
		if (!tokenInfo || tokenInfo.isExpired) {
			logger.info('[refreshMarketData] No valid token, skipping', {
				characterId,
			})
			return {
				success: false,
				hasValidToken: false,
			}
		}

		// Fetch and store market transactions and orders in parallel
		await Promise.all([
			characterData.fetchMarketTransactions(true),
			characterData.fetchMarketOrders(true),
		])

		// Get counts
		const [transactions, orders] = await Promise.all([
			characterData.getMarketTransactions(),
			characterData.getMarketOrders(),
		])

		logger.info('[refreshMarketData] Market data refreshed', {
			characterId,
			transactionCount: transactions.length,
			orderCount: orders.length,
		})

		return {
			success: true,
			hasValidToken: true,
			transactionCount: transactions.length,
			orderCount: orders.length,
		}
	} catch (error) {
		// If token-related error, return non-fatal result
		const errorMessage = error instanceof Error ? error.message : String(error)
		if (errorMessage.includes('token') || errorMessage.includes('unauthorized')) {
			logger.info('[refreshMarketData] Token error, skipping', {
				characterId,
				error: errorMessage,
			})
			return {
				success: false,
				hasValidToken: false,
			}
		}

		logger.error('[refreshMarketData] Failed to refresh market data', {
			characterId,
			error: errorMessage,
		})
		throw error
	}
}

