import { withRpcResult } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import * as esiFetch from '../../../services/esi-fetch'
import { getCorporationDataStub, getCorporationEsi } from '../../utils/services'
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

export interface WalletTransactionsSyncResult {
	divisionsProcessed: number
	totalTransactions: number
	persistedNewRows: number
	maxTransactionId: string | null
	maxTransactionDate: string | null
}

export async function syncWalletTransactions(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<WalletTransactionsSyncResult> {
	const esi = getCorporationEsi(env, corporationId)
	const corpData = getCorporationDataStub(env, corporationId)
	const watermarks = await withRpcResult(
		corpData.getWalletTransactionWatermarks(corporationId),
		(watermarks) =>
			watermarks.map(({ division, watermark }) => ({
				division,
				watermark: watermark ? { ...watermark } : undefined,
			}))
	)
	const watermarkByDivision = new Map(
		watermarks.map(({ division, watermark }) => [division, watermark])
	)

	const results = await Promise.allSettled(
		WALLET_DIVISIONS.map(async (division, index) => {
			const delayMs = getWalletDivisionJitterMs(index, WALLET_DIVISIONS.length)
			if (delayMs > 0) {
				await sleep(delayMs)
			}

			const fetchResult = await esiFetch.fetchWalletTransactions(
				esi,
				corporationId,
				division,
				directorCharacterId,
				watermarkByDivision.get(division)
			)
			if (fetchResult.truncated) {
				throw new Error('Wallet transaction pagination was truncated before persistence')
			}
			const storeResult = await withRpcResult(
				corpData.storeWalletTransactions(
					corporationId,
					division,
					fetchResult.transactions,
					watermarkByDivision.get(division)
				),
				(result) => ({ persistedNewRows: result.persistedNewRows })
			)
			const transactions = fetchResult.transactions
			const maxTransactionId =
				transactions.length > 0
					? transactions.reduce(
							(max, tx) =>
								compareNumericStrings(String(tx.transaction_id), max) > 0
									? String(tx.transaction_id)
									: max,
							String(transactions[0].transaction_id)
						)
					: null
			const maxTransactionDate =
				transactions.length > 0
					? transactions
							.reduce((max, tx) => {
								const txDate = new Date(tx.date)
								return txDate > max ? txDate : max
							}, new Date(transactions[0].date))
							.toISOString()
					: null
			return {
				division,
				count: transactions.length,
				persistedNewRows: storeResult.persistedNewRows,
				maxTransactionId,
				maxTransactionDate,
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
			maxTransactionId: string | null
			maxTransactionDate: string | null
		}> => result.status === 'fulfilled'
	)
	const totalTransactions = successful.reduce((sum, { value }) => sum + value.count, 0)
	const persistedNewRows = successful.reduce((sum, { value }) => sum + value.persistedNewRows, 0)
	const maxTransactionId = successful
		.map((result) => result.value.maxTransactionId)
		.filter((id): id is string => Boolean(id))
		.reduce<string | null>((max, current) => {
			if (max === null) {
				return current
			}
			return compareNumericStrings(current, max) > 0 ? current : max
		}, null)
	const maxTransactionDate = successful
		.map((result) => result.value.maxTransactionDate)
		.filter((date): date is string => Boolean(date))
		.reduce<string | null>((max, current) => {
			if (max === null) {
				return current
			}
			return new Date(current) > new Date(max) ? current : max
		}, null)

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
		persistedNewRows,
		maxTransactionId,
		maxTransactionDate,
	})

	return {
		divisionsProcessed: successful.length,
		totalTransactions,
		persistedNewRows,
		maxTransactionId,
		maxTransactionDate,
	}
}
