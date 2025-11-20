/**
 * Fetch character wallet transactions from ESI
 */

import { getEsiInstanceForCharacter } from '@repo/esi'

import { storeOrReturn } from '../../utils/storage'

import type { Esi } from '@repo/esi'
import type { StepResult } from '../../utils/storage'

/**
 * Fetch wallet transactions from ESI stub
 * Separated for testability
 */
export async function fetchWalletTransactionsFromEsi(esiStub: Esi, characterId: string) {
	return await esiStub.fetchCharacterMarketTransactions(characterId)
}

/**
 * Fetch character wallet transactions from ESI and conditionally store in R2
 *
 * @param esiBinding - ESI Durable Object namespace
 * @param bucket - R2 bucket for storage
 * @param bucketName - Name of R2 bucket
 * @param characterId - EVE character ID
 * @param workflowInstanceId - Workflow instance ID for R2 key generation
 * @returns StepResult indicating where data is stored
 */
export async function fetchWalletTransactions(
	esiBinding: DurableObjectNamespace,
	bucket: R2Bucket,
	bucketName: string,
	characterId: string,
	workflowInstanceId: string
): Promise<StepResult> {
	try {
		// Get character-specific ESI stub for caching
		const stub = getEsiInstanceForCharacter(esiBinding, characterId)

		// Fetch wallet transactions from ESI
		const data = await fetchWalletTransactionsFromEsi(stub, characterId)

		// Store or return based on size
		return await storeOrReturn(
			bucket,
			bucketName,
			workflowInstanceId,
			'fetch-wallet-transactions',
			data
		)
	} catch (error) {
		return {
			source: 'none',
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}
