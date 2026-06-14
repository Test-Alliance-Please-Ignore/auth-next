import { logger } from '@repo/hono-helpers'

import { getCorporationDataStub } from '../../utils/services'

import type { Env } from '../../../context'

export interface AssetsSyncResult {
	assetsCount: number
}

export async function syncAssets(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<AssetsSyncResult> {
	const corpData = getCorporationDataStub(env, corporationId)

	logger.info('[AssetsStep] Starting structure inventory sync', { corporationId })
	const result = await corpData.syncAssetsWithDirector(corporationId, directorCharacterId)
	logger.info('[AssetsStep] Synced structure inventory', { corporationId, count: result.assetsCount })

	return {
		assetsCount: result.assetsCount,
	}
}
