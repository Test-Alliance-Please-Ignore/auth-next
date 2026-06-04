/**
 * Process and enrich character market orders
 */

import { enrichMarketOrders } from '../../processors/helpers/orders'
import type { StructureResolutionCoordinator } from '../../processors/helpers/structure-resolution'
import { retrieveData, storeOrReturn } from '../../utils/storage'

import type { CharacterMarketOrder } from '@repo/esi'
import type { StepResult } from '../../utils/storage'

export async function processOrders(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
		ESI: DurableObjectNamespace
		UNIVERSE: DurableObjectNamespace
	},
	getBucket: (name: string) => R2Bucket,
	bucket: R2Bucket,
	bucketName: string,
	fetchResult: StepResult,
	workflowInstanceId: string,
	characterId: string,
	structureResolutionCoordinator?: StructureResolutionCoordinator,
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

		const orders = data as CharacterMarketOrder[]
		if (!Array.isArray(orders)) {
			return {
				source: 'none',
				success: false,
				error: 'Invalid character orders structure',
			}
		}

		const enrichedData = await enrichMarketOrders(
			env,
			orders,
			characterId,
			structureResolutionCoordinator
		)
		return await storeOrReturn(
			bucket,
			bucketName,
			workflowInstanceId,
			'process-orders',
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
