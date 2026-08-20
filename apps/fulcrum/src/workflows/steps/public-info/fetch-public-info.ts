/**
 * Fetch public character information from ESI
 */

import { getPublicEsiInstance } from '@repo/esi'

import { storeOrReturn } from '../../utils/storage'

import type { Esi } from '@repo/esi'
import type { StepResult } from '../../utils/storage'

/**
 * Fetch data from ESI stub
 * Separated for testability
 */
export async function fetchFromEsi(esiStub: Esi, characterId: string) {
	return await esiStub.fetchCharacterPublicInfo(characterId)
}

/**
 * Fetch public character info from ESI and store in R2
 *
 * @param esiBinding - ESI Durable Object namespace
 * @param bucket - R2 bucket for storage
 * @param bucketName - Name of R2 bucket
 * @param characterId - EVE character ID
 * @param workflowInstanceId - Workflow instance ID for R2 key generation
 * @returns StepResult with R2 location reference
 */
export async function fetchPublicInfo(
	esiBinding: DurableObjectNamespace,
	bucket: R2Bucket,
	bucketName: string,
	characterId: string,
	workflowInstanceId: string
): Promise<StepResult> {
	try {
		// Get character-specific ESI stub — honour ESI cache-control headers for public info
		// (name, race, birthday are immutable-ish; no-store is wasteful here)
		const stub = getPublicEsiInstance(esiBinding)

		// Fetch public info from ESI
		const data = await fetchFromEsi(stub, characterId)

		// Store in R2
		return await storeOrReturn(bucket, bucketName, workflowInstanceId, 'fetch-public-info', data)
	} catch (error) {
		return {
			source: 'none',
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}
