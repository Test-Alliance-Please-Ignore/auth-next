/**
 * Fetch character skills and skill queue from ESI
 */

import { getEsiInstanceForCharacter } from '@repo/esi'

import { storeOrReturn } from '../../utils/storage'

import type { Esi } from '@repo/esi'
import type { StepResult } from '../../utils/storage'

/**
 * Fetch skills and skill queue from ESI stub
 * Separated for testability
 */
export async function fetchSkillsFromEsi(esiStub: Esi, characterId: string) {
	const [skills, skillQueue] = await Promise.all([
		esiStub.fetchCharacterSkills(characterId),
		esiStub.fetchCharacterSkillQueue(characterId),
	])
	return { skills, skillQueue }
}

/**
 * Fetch character skills and skill queue from ESI and store in R2
 *
 * @param esiBinding - ESI Durable Object namespace
 * @param bucket - R2 bucket for storage
 * @param bucketName - Name of R2 bucket
 * @param characterId - EVE character ID
 * @param workflowInstanceId - Workflow instance ID for R2 key generation
 * @returns StepResult with R2 location reference
 */
export async function fetchSkills(
	esiBinding: DurableObjectNamespace,
	bucket: R2Bucket,
	bucketName: string,
	characterId: string,
	workflowInstanceId: string,
): Promise<StepResult> {
	try {
		const stub = getEsiInstanceForCharacter(esiBinding, characterId)
		stub.setDefaultCacheMode('no-store')
		const data = await fetchSkillsFromEsi(stub, characterId)
		return await storeOrReturn(bucket, bucketName, workflowInstanceId, 'fetch-skills', data)
	} catch (error) {
		return {
			source: 'none',
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}
