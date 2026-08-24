/**
 * Process and enrich public character information
 * Resolves IDs to human-readable names using ESI Type Resolver
 */

import { enrichPublicInfo } from '../../processors/helpers/public-info'
import { retrieveData, storeOrReturn } from '../../utils/storage'

import type { CharacterPublicInfo } from '@repo/esi'
import type { CoreBinding } from '../../../types/core-binding'
import type { EntityLinkCoordinator } from '../../processors/helpers/entity-links'
import type { StepResult } from '../../utils/storage'

interface FetchedAccountData {
	skills?: { total_sp?: number }
	walletBalance?: number | null
}

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
	env: { ESI_TYPE_RESOLVER: DurableObjectNamespace; CORE: CoreBinding },
	getBucket: (name: string) => R2Bucket,
	bucket: R2Bucket,
	bucketName: string,
	fetchResult: StepResult,
	workflowInstanceId: string,
	characterId: string,
	entityLinkCoordinator?: EntityLinkCoordinator
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
		const enrichedData = await enrichPublicInfo(env, publicInfo, characterId, entityLinkCoordinator)

		// Store in R2
		return await storeOrReturn(
			bucket,
			bucketName,
			workflowInstanceId,
			'process-public-info',
			enrichedData
		)
	} catch (error) {
		return {
			source: 'none',
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

/**
 * Add authenticated metrics collected by the skills step to the persisted
 * public-info section used by the report overview.
 */
export async function addAccountSummaryToPublicInfo(
	getBucket: (name: string) => R2Bucket,
	bucket: R2Bucket,
	bucketName: string,
	publicInfoResult: StepResult,
	accountDataResult: StepResult,
	workflowInstanceId: string
): Promise<StepResult> {
	try {
		if (!publicInfoResult.success || !accountDataResult.success) return publicInfoResult

		const publicInfo = await retrieveData<Record<string, unknown>>(getBucket, publicInfoResult)
		const accountData = await retrieveData<FetchedAccountData>(getBucket, accountDataResult)
		if (!publicInfo || !accountData) return publicInfoResult

		const totalSp = accountData.skills?.total_sp
		const walletBalance = accountData.walletBalance
		if (totalSp === undefined && walletBalance === undefined) return publicInfoResult

		return await storeOrReturn(
			bucket,
			bucketName,
			workflowInstanceId,
			'process-public-info-account-summary',
			{
				...publicInfo,
				...(totalSp !== undefined ? { totalSp } : {}),
				...(walletBalance !== undefined ? { walletBalance } : {}),
			}
		)
	} catch {
		// The base public-info section remains valid if optional metrics cannot be merged.
		return publicInfoResult
	}
}
