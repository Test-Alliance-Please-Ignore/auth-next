/**
 * Fetch character contacts from ESI
 */

import { getEsiInstanceForCharacter } from '@repo/esi'

import { storeOrReturn } from '../../utils/storage'

import type { Esi } from '@repo/esi'
import type { StepResult } from '../../utils/storage'

/**
 * Fetch contacts from ESI stub
 * Separated for testability
 */
export async function fetchContactsFromEsi(esiStub: Esi, characterId: string) {
	return await esiStub.fetchCharacterContacts(characterId)
}

/**
 * Fetch character contacts from ESI and store in R2
 *
 * @param esiBinding - ESI Durable Object namespace
 * @param bucket - R2 bucket for storage
 * @param bucketName - Name of R2 bucket
 * @param characterId - EVE character ID
 * @param workflowInstanceId - Workflow instance ID for R2 key generation
 * @returns StepResult with R2 location reference
 */
export async function fetchContacts(
	esiBinding: DurableObjectNamespace,
	bucket: R2Bucket,
	bucketName: string,
	characterId: string,
	workflowInstanceId: string
): Promise<StepResult> {
	try {
		// Get character-specific ESI stub for caching
		const stub = getEsiInstanceForCharacter(esiBinding, characterId)
		stub.setDefaultCacheMode('no-store')

		// Fetch contacts from ESI
		const data = await fetchContactsFromEsi(stub, characterId)

		// Store in R2
		return await storeOrReturn(bucket, bucketName, workflowInstanceId, 'fetch-contacts', data)
	} catch (error) {
		return {
			source: 'none',
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

