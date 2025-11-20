/**
 * Process and enrich public character information
 * Resolves IDs to human-readable names using ESI Type Resolver
 */

import type { CharacterPublicInfo } from '@repo/esi'
import { retrieveData, storeOrReturn, type StepResult } from '../../utils/storage'
import { enrichPublicInfo } from '../../processors/helpers/public-info'

/**
 * Process public character info by enriching with resolved names
 * Retrieves ESI data from previous step and enriches with name resolution
 *
 * @param env - Worker environment with bindings
 * @param getBucket - Function to get R2 bucket by name
 * @param bucket - R2 bucket for storage
 * @param bucketName - Name of R2 bucket
 * @param fetchResult - Result from fetch-public-info step
 * @param workflowInstanceId - Workflow instance ID
 * @returns StepResult with enriched character public info data
 */
export async function processPublicInfo(
	env: { ESI_TYPE_RESOLVER: DurableObjectNamespace },
	getBucket: (name: string) => R2Bucket,
	bucket: R2Bucket,
	bucketName: string,
	fetchResult: StepResult,
	workflowInstanceId: string,
): Promise<StepResult> {
	try {
		// Check if fetch was successful
		if (!fetchResult.success) {
			return {
				source: 'none',
				success: false,
				error: 'Fetch failed: ' + (fetchResult as any).error,
			}
		}

		// Retrieve data from payload or R2 (already transformed by ESI worker)
		const data = await retrieveData(getBucket, fetchResult)
		if (!data) {
			return {
				source: 'none',
				success: false,
				error: 'No data retrieved from fetch step',
			}
		}

		// Validate data structure
		const publicInfo = data as CharacterPublicInfo
		if (!publicInfo.name || !publicInfo.corporation_id) {
			return {
				source: 'none',
				success: false,
				error: 'Invalid character public info structure',
			}
		}

		// Enrich data by resolving IDs to names
		const enrichedData = await enrichPublicInfo(env, publicInfo)

		// Store or return based on size
		return await storeOrReturn(
			bucket,
			bucketName,
			workflowInstanceId,
			'process-public-info',
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
