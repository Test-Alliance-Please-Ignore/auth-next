import { logger } from '@repo/hono-helpers'

import * as esiFetch from '../../../services/esi-fetch'
import { createTokenStore, getCorporationDataStub } from '../../utils/services'
import { getWalletDivisionJitterMs, sleep } from '../../utils/wallet-fanout'

import type { Env } from '../../../context'

const WALLET_DIVISIONS = [1, 2, 3, 4, 5, 6, 7]

function compareNumericStrings(left: string, right: string): number {
	try {
		const leftBigInt = BigInt(left)
		const rightBigInt = BigInt(right)
		if (leftBigInt === rightBigInt) {
			return 0
		}
		return leftBigInt > rightBigInt ? 1 : -1
	} catch {
		return left.localeCompare(right, 'en')
	}
}

export interface WalletJournalSyncResult {
	divisionsProcessed: number
	totalEntries: number
	persistedNewRows: number
	maxJournalId: string | null
	maxJournalDate: string | null
}

export async function syncWalletJournal(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<WalletJournalSyncResult> {
	const tokenStore = createTokenStore(env)
	const corpData = getCorporationDataStub(env, corporationId)

	const results = await Promise.allSettled(
		WALLET_DIVISIONS.map(async (division, index) => {
			const delayMs = getWalletDivisionJitterMs(index, WALLET_DIVISIONS.length)
			if (delayMs > 0) {
				await sleep(delayMs)
			}

			const entries = await esiFetch.fetchWalletJournal(
				tokenStore,
				corporationId,
				division,
				directorCharacterId
			)
			const storeResult = await corpData.storeWalletJournal(corporationId, division, entries)
			const maxJournalId =
				entries.length > 0
					? entries.reduce(
							(max, entry) =>
								compareNumericStrings(String(entry.id), max) > 0 ? String(entry.id) : max,
							String(entries[0].id)
						)
					: null
			const maxJournalDate =
				entries.length > 0
					? entries
							.reduce((max, entry) => {
								const entryDate = new Date(entry.date)
								return entryDate > max ? entryDate : max
							}, new Date(entries[0].date))
							.toISOString()
					: null
			return {
				division,
				count: entries.length,
				persistedNewRows: storeResult.persistedNewRows,
				maxJournalId,
				maxJournalDate,
			}
		})
	)

	const successful = results.filter(
		(
			result
		): result is PromiseFulfilledResult<{
			division: number
			count: number
			persistedNewRows: number
			maxJournalId: string | null
			maxJournalDate: string | null
		}> => result.status === 'fulfilled'
	)

	const totalEntries = successful.reduce((sum, { value }) => sum + value.count, 0)
	const persistedNewRows = successful.reduce((sum, { value }) => sum + value.persistedNewRows, 0)
	const maxJournalId = successful
		.map((result) => result.value.maxJournalId)
		.filter((id): id is string => Boolean(id))
		.reduce<string | null>((max, current) => {
			if (max === null) {
				return current
			}
			return compareNumericStrings(current, max) > 0 ? current : max
		}, null)
	const maxJournalDate = successful
		.map((result) => result.value.maxJournalDate)
		.filter((date): date is string => Boolean(date))
		.reduce<string | null>((max, current) => {
			if (max === null) {
				return current
			}
			return new Date(current) > new Date(max) ? current : max
		}, null)

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
		persistedNewRows,
		maxJournalId,
		maxJournalDate,
	})

	return {
		divisionsProcessed: successful.length,
		totalEntries,
		persistedNewRows,
		maxJournalId,
		maxJournalDate,
	}
}
