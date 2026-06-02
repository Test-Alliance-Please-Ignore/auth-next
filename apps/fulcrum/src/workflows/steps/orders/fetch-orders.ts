/**
 * Fetch character market orders from ESI
 */

import { getEsiInstanceForCharacter } from '@repo/esi'

import { storeOrReturn } from '../../utils/storage'

import type { Esi } from '@repo/esi'
import type { StepResult } from '../../utils/storage'

export async function fetchOrdersFromEsi(esiStub: Esi, characterId: string) {
	return await esiStub.fetchCharacterMarketOrders(characterId)
}

export async function fetchOrders(
	esiBinding: DurableObjectNamespace,
	bucket: R2Bucket,
	bucketName: string,
	characterId: string,
	workflowInstanceId: string,
): Promise<StepResult> {
	try {
		const stub = getEsiInstanceForCharacter(esiBinding, characterId)
		stub.setDefaultCacheMode('no-store')
		const data = await fetchOrdersFromEsi(stub, characterId)
		return await storeOrReturn(bucket, bucketName, workflowInstanceId, 'fetch-orders', data)
	} catch (error) {
		return {
			source: 'none',
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}
