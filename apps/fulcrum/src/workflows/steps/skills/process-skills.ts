/**
 * Process and enrich character skills and skill queue
 * Resolves skill type IDs to names using ESI Type Resolver
 */

import type { CharacterSkills, CharacterSkillQueue } from '@repo/esi'

import { retrieveData, storeOrReturn } from '../../utils/storage'
import { enrichSkills } from '../../processors/helpers/skills'

import type { StepResult } from '../../utils/storage'

/**
 * Process character skills by enriching with resolved names
 *
 * @param env - Worker environment with bindings
 * @param getBucket - Function to get R2 bucket by name
 * @param bucket - R2 bucket for storage
 * @param bucketName - Name of R2 bucket
 * @param fetchResult - Result from fetch-skills step
 * @param workflowInstanceId - Workflow instance ID
 * @param characterId - EVE character ID
 * @returns StepResult with enriched skills data
 */
export async function processSkills(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
	},
	getBucket: (name: string) => R2Bucket,
	bucket: R2Bucket,
	bucketName: string,
	fetchResult: StepResult,
	workflowInstanceId: string,
	characterId: string,
): Promise<StepResult> {
	try {
		if (!fetchResult.success) {
			return {
				source: 'none',
				success: false,
				error: 'Fetch failed: ' + (fetchResult as any).error,
			}
		}

		const data = await retrieveData(getBucket, fetchResult)
		if (!data) {
			return {
				source: 'none',
				success: false,
				error: 'No data retrieved from fetch step',
			}
		}

		const { skills, skillQueue } = data as {
			skills: CharacterSkills
			skillQueue: CharacterSkillQueue[]
		}

		if (!skills || !Array.isArray(skills.skills)) {
			return {
				source: 'none',
				success: false,
				error: 'Invalid character skills structure',
			}
		}

		const enrichedData = await enrichSkills(env, skills, skillQueue ?? [], characterId)

		return await storeOrReturn(
			bucket,
			bucketName,
			workflowInstanceId,
			'process-skills',
			enrichedData,
		)
	} catch (error) {
		return {
			source: 'none',
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}
