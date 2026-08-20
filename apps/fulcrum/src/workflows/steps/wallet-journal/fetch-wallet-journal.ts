import { getEsiInstanceForCharacter } from '@repo/esi'

import { storeOrReturn } from '../../utils/storage'

import type { Esi } from '@repo/esi'
import type { StepResult } from '../../utils/storage'

/**
 * Fetch wallet journal from ESI stub
 * Separated for testability
 */
export async function fetchWalletJournalFromEsi(esiStub: Esi, characterId: string) {
	return await esiStub.fetchCharacterWalletJournal(characterId)
}

/**
 * Fetch character wallet journal from ESI and store in R2
 *
 * @param esiBinding - ESI Durable Object namespace
 * @param bucket - R2 bucket for storage
 * @param bucketName - Name of R2 bucket
 * @param characterId - EVE character ID
 * @param workflowInstanceId - Workflow instance ID for R2 key generation
 * @returns StepResult with R2 location reference
 */
export async function fetchWalletJournal(
	esiBinding: DurableObjectNamespace,
	bucket: R2Bucket,
	bucketName: string,
	characterId: string,
	workflowInstanceId: string
): Promise<StepResult> {
	try {
		const stub = getEsiInstanceForCharacter(esiBinding, characterId)
		const data = await fetchWalletJournalFromEsi(stub, characterId)
		// Store in R2
		return await storeOrReturn(bucket, bucketName, workflowInstanceId, 'fetch-wallet-journal', data)
	} catch (error) {
		return {
			source: 'none',
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}
