/**
 * Process and enrich character contracts
 * Resolves entity IDs to names using ESI Type Resolver
 */

import type { CharacterContract } from '@repo/esi'

import { retrieveData, storeOrReturn } from '../../utils/storage'
import { enrichContracts } from '../../processors/helpers/contracts'

import type { StepResult } from '../../utils/storage'

/**
 * Process character contracts by enriching with resolved names
 *
 * @param env - Worker environment with bindings
 * @param getBucket - Function to get R2 bucket by name
 * @param bucket - R2 bucket for storage
 * @param bucketName - Name of R2 bucket
 * @param fetchResult - Result from fetch-contracts step
 * @param workflowInstanceId - Workflow instance ID
 * @param characterId - EVE character ID
 * @returns StepResult with enriched contracts data
 */
export async function processContracts(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
		ESI: DurableObjectNamespace
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

		const contracts = data as CharacterContract[]
		if (!Array.isArray(contracts)) {
			return {
				source: 'none',
				success: false,
				error: 'Invalid character contracts structure',
			}
		}

		const enrichedData = await enrichContracts(env, contracts, characterId)

		return await storeOrReturn(
			bucket,
			bucketName,
			workflowInstanceId,
			'process-contracts',
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
