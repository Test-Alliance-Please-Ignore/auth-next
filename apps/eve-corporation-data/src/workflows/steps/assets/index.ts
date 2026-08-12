import { withRpcResult } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { getCorporationDataStub } from '../../utils/services'

import type { StructureInventorySyncResult } from '@repo/eve-corporation-data'
import type { Env } from '../../../context'

export type AssetsSyncResult = StructureInventorySyncResult

export async function syncAssets(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<AssetsSyncResult> {
	const corpData = getCorporationDataStub(env, corporationId)

	logger.info('[AssetsStep] Starting structure inventory sync', { corporationId })
	const result = await withRpcResult(
		corpData.syncAssetsWithDirector(corporationId, directorCharacterId),
		(result) => ({ ...result })
	)
	logger.info('[AssetsStep] Structure inventory sync completed', {
		corporationId,
		assetsCount: result.assetsCount,
		snapshotUpdated: result.snapshotUpdated,
		skipReason: result.skipReason,
		ownedStructureCount: result.ownedStructureCount,
		fetchedAssetCount: result.fetchedAssetCount,
		inventoryRowCount: result.inventoryRowCount,
	})
	if (result.skipReason === 'no-owned-structures') {
		logger.info(
			'[AssetsStep] Structure inventory snapshot was cleared because no owned structures were found',
			{
				corporationId,
			}
		)
	}

	return result
}
