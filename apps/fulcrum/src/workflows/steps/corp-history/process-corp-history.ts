/**
 * Process and enrich character corporation history
 * Resolves corporation IDs to names using ESI Type Resolver
 */

import type { CorporationHistoryEntry } from '@repo/esi'

import { retrieveData, storeOrReturn } from '../../utils/storage'
import { enrichCorpHistory } from '../../processors/helpers/corp-history'

import type { StepResult } from '../../utils/storage'

/**
 * Process character corporation history by enriching with resolved names
 *
 * @param env - Worker environment with bindings
 * @param getBucket - Function to get R2 bucket by name
 * @param bucket - R2 bucket for storage
 * @param bucketName - Name of R2 bucket
 * @param fetchResult - Result from fetch-corp-history step
 * @param workflowInstanceId - Workflow instance ID
 * @param characterId - EVE character ID
 * @returns StepResult with enriched corporation history data
 */
export async function processCorpHistory(
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

		const history = data as CorporationHistoryEntry[]
		if (!Array.isArray(history)) {
			return {
				source: 'none',
				success: false,
				error: 'Invalid corporation history structure',
			}
		}

		const enrichedData = await enrichCorpHistory(env, history, characterId)

		return await storeOrReturn(
			bucket,
			bucketName,
			workflowInstanceId,
			'process-corp-history',
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
