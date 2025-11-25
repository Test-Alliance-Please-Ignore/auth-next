import { logger } from '@repo/hono-helpers'

import * as esiFetch from '../../../services/esi-fetch'
import { createTokenStore, getCorporationDataStub } from '../../utils/services'

import type { Env } from '../../../context'

export interface AssetsSyncResult {
	assetsCount: number
}

export async function syncAssets(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<AssetsSyncResult> {
	const tokenStore = createTokenStore(env)
	const corpData = getCorporationDataStub(env, corporationId)

	const assets = await esiFetch.fetchAssets(tokenStore, corporationId, directorCharacterId)

	logger.debug('[AssetsStep] Fetched assets', { corporationId, count: assets.length })

	await corpData.storeAssets(corporationId, assets)

	logger.info('[AssetsStep] Stored assets', { corporationId, count: assets.length })

	return {
		assetsCount: assets.length,
	}
}

