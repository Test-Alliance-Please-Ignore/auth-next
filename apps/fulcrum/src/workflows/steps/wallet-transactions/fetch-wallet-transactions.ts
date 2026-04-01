/**
 * Fetch character wallet transactions from ESI with from_id pagination
 */

import { getEsiInstanceForCharacter } from '@repo/esi'

import { storeOrReturn } from '../../utils/storage'

import type { CharacterMarketTransaction, Esi } from '@repo/esi'
import type { StepResult } from '../../utils/storage'

/** Max pages to fetch (char-wallet rate limit: 150 tokens/15min, 2 per call = 75 max) */
const MAX_PAGES = 10

/**
 * Fetch all wallet transactions using from_id cursor pagination.
 * ESI returns up to 2500 per call; we follow the cursor backward by
 * setting from_id to the minimum transaction_id of the previous page.
 */
export async function fetchWalletTransactionsFromEsi(
	esiStub: Esi,
	characterId: string
): Promise<{ transactions: CharacterMarketTransaction[]; truncated: boolean }> {
	const allTransactions: CharacterMarketTransaction[] = []
	let fromId: string | undefined
	let truncated = false

	for (let page = 0; page < MAX_PAGES; page++) {
		const pageData = await esiStub.fetchCharacterMarketTransactionsPage(characterId, fromId)

		if (pageData.length === 0) break

		allTransactions.push(...pageData)

		// If we got fewer than 2500 results, there are no more pages
		if (pageData.length < 2500) break

		// Use the smallest transaction_id as the cursor for the next page
		const minId = pageData.reduce(
			(min, tx) => (BigInt(tx.transaction_id) < BigInt(min) ? tx.transaction_id : min),
			pageData[0].transaction_id,
		)
		fromId = minId

		// Check if we're at the page limit
		if (page === MAX_PAGES - 1) {
			truncated = true
		}
	}

	return { transactions: allTransactions, truncated }
}

/**
 * Fetch character wallet transactions from ESI and store in R2
 */
export async function fetchWalletTransactions(
	esiBinding: DurableObjectNamespace,
	bucket: R2Bucket,
	bucketName: string,
	characterId: string,
	workflowInstanceId: string
): Promise<StepResult> {
	try {
		const stub = getEsiInstanceForCharacter(esiBinding, characterId)
		stub.setDefaultCacheMode('no-store')
		const { transactions, truncated } = await fetchWalletTransactionsFromEsi(stub, characterId)

		return await storeOrReturn(
			bucket,
			bucketName,
			workflowInstanceId,
			'fetch-wallet-transactions',
			{ transactions, truncated }
		)
	} catch (error) {
		return {
			source: 'none',
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}
