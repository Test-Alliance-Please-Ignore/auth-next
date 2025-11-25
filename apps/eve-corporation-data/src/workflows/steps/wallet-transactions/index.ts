import { logger } from '@repo/hono-helpers'

import * as esiFetch from '../../../services/esi-fetch'
import { createTokenStore, getCorporationDataStub } from '../../utils/services'

import type { Env } from '../../../context'

const WALLET_DIVISIONS = [1, 2, 3, 4, 5, 6, 7]

export interface WalletTransactionsSyncResult {
	divisionsProcessed: number
	totalTransactions: number
}

export async function syncWalletTransactions(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<WalletTransactionsSyncResult> {
	const tokenStore = createTokenStore(env)
	const corpData = getCorporationDataStub(env, corporationId)

	const results = await Promise.allSettled(
		WALLET_DIVISIONS.map(async (division) => {
			const transactions = await esiFetch.fetchWalletTransactions(
				tokenStore,
				corporationId,
				division,
				directorCharacterId
			)
			await corpData.storeWalletTransactions(corporationId, division, transactions)
			return { division, count: transactions.length }
		})
	)

	const successful = results.filter((result): result is PromiseFulfilledResult<{ division: number; count: number }> => result.status === 'fulfilled')
	const totalTransactions = successful.reduce((sum, { value }) => sum + value.count, 0)

	results.forEach((result, index) => {
		if (result.status === 'rejected') {
			logger.error('[WalletTransactionsStep] Division failed', {
				corporationId,
				division: WALLET_DIVISIONS[index],
				error: result.reason instanceof Error ? result.reason.message : String(result.reason),
			})
		}
	})

	logger.info('[WalletTransactionsStep] Stored wallet transactions', {
		corporationId,
		divisionsProcessed: successful.length,
		totalTransactions,
	})

	return {
		divisionsProcessed: successful.length,
		totalTransactions,
	}
}

