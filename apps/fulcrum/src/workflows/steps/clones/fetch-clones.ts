/**
 * Fetch character clones and implants from ESI
 */

import { getEsiInstanceForCharacter } from '@repo/esi'

import { storeOrReturn } from '../../utils/storage'

import type { Esi } from '@repo/esi'
import type { StepResult } from '../../utils/storage'

/**
 * Fetch clones and active implants from ESI stub
 * Separated for testability
 */
export async function fetchClonesFromEsi(esiStub: Esi, characterId: string) {
	const [clones, implants] = await Promise.all([
		esiStub.fetchCharacterClones(characterId, { cacheMode: 'no-store' }),
		esiStub.fetchCharacterImplants(characterId, { cacheMode: 'no-store' }),
	])
	return { clones, implants }
}

/**
 * Fetch character clones and active implants from ESI and store in R2
 */
export async function fetchClones(
	esiBinding: DurableObjectNamespace,
	bucket: R2Bucket,
	bucketName: string,
	characterId: string,
	workflowInstanceId: string
): Promise<StepResult> {
	try {
		const stub = getEsiInstanceForCharacter(esiBinding, characterId)
		const data = await fetchClonesFromEsi(stub, characterId)
		return await storeOrReturn(bucket, bucketName, workflowInstanceId, 'fetch-clones', data)
	} catch (error) {
		return {
			source: 'none',
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}
