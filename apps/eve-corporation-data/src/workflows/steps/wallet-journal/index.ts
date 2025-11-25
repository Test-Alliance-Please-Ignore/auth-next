import { logger } from '@repo/hono-helpers'

import * as esiFetch from '../../../services/esi-fetch'
import { createTokenStore, getCorporationDataStub } from '../../utils/services'

import type { Env } from '../../../context'

const WALLET_DIVISIONS = [1, 2, 3, 4, 5, 6, 7]

export interface WalletJournalSyncResult {
	divisionsProcessed: number
	totalEntries: number
}

export async function syncWalletJournal(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<WalletJournalSyncResult> {
	const tokenStore = createTokenStore(env)
	const corpData = getCorporationDataStub(env, corporationId)

	const results = await Promise.allSettled(
		WALLET_DIVISIONS.map(async (division) => {
			const entries = await esiFetch.fetchWalletJournal(
				tokenStore,
				corporationId,
				division,
				directorCharacterId
			)
			await corpData.storeWalletJournal(corporationId, division, entries)
			return { division, count: entries.length }
		})
	)

	const successful = results.filter((result): result is PromiseFulfilledResult<{ division: number; count: number }> => result.status === 'fulfilled')

	const totalEntries = successful.reduce((sum, { value }) => sum + value.count, 0)

	// Log failures (if any) but do not throw to retain previous behavior
	results.forEach((result, index) => {
		if (result.status === 'rejected') {
			logger.error('[WalletJournalStep] Division failed', {
				corporationId,
				division: WALLET_DIVISIONS[index],
				error: result.reason instanceof Error ? result.reason.message : String(result.reason),
			})
		}
	})

	logger.info('[WalletJournalStep] Stored wallet journal', {
		corporationId,
		divisionsProcessed: successful.length,
		totalEntries,
	})

	return {
		divisionsProcessed: successful.length,
		totalEntries,
	}
}

