/**
 * Fetch character corporation history from ESI
 */

import { getEsiInstanceForCharacter } from '@repo/esi'

import { storeOrReturn } from '../../utils/storage'

import type { Esi } from '@repo/esi'
import type { StepResult } from '../../utils/storage'

/**
 * Fetch corporation history from ESI stub
 * Separated for testability
 */
export async function fetchCorpHistoryFromEsi(esiStub: Esi, characterId: string) {
	return await esiStub.fetchCorporationHistory(characterId)
}

/**
 * Fetch character corporation history from ESI and store in R2
 *
 * @param esiBinding - ESI Durable Object namespace
 * @param bucket - R2 bucket for storage
 * @param bucketName - Name of R2 bucket
 * @param characterId - EVE character ID
 * @param workflowInstanceId - Workflow instance ID for R2 key generation
 * @returns StepResult with R2 location reference
 */
export async function fetchCorpHistory(
	esiBinding: DurableObjectNamespace,
	bucket: R2Bucket,
	bucketName: string,
	characterId: string,
	workflowInstanceId: string,
): Promise<StepResult> {
	try {
		// Corp history is a public ESI endpoint — honour cache-control headers
		const stub = getEsiInstanceForCharacter(esiBinding, characterId)
		stub.setDefaultCacheMode('default')
		const data = await fetchCorpHistoryFromEsi(stub, characterId)
		return await storeOrReturn(bucket, bucketName, workflowInstanceId, 'fetch-corp-history', data)
	} catch (error) {
		return {
			source: 'none',
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}
