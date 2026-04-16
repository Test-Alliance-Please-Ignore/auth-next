import { transformAssets } from '../lib/esi-transforms'

import type { EsiCorporationAsset } from '@repo/eve-corporation-data'
import type { EsiResponse } from '@repo/eve-token-store'

export type RawEsiAsset = {
	item_id: number
	is_singleton: boolean
	location_flag: string
	location_id: number
	location_type: string
	quantity: number
	type_id: number
	is_blueprint_copy?: boolean
}

export interface AssetsPagingSyncDeps {
	fetchPage: (page: number) => Promise<EsiResponse<RawEsiAsset[]>>
	storeAssets: (assets: EsiCorporationAsset[]) => Promise<void>
	onProgress?: (progress: { page: number; totalPages: number; totalAssets: number }) => void
}

/**
 * Fetches corporation assets page-by-page and persists each page immediately.
 * This prevents large in-memory arrays or large RPC payloads.
 */
export async function syncAssetsPaged(deps: AssetsPagingSyncDeps): Promise<{ assetsCount: number }> {
	const firstPageResponse = await deps.fetchPage(1)
	const totalPages = firstPageResponse.pages ?? 1
	let totalAssets = 0

	const processPage = async (rawAssets: RawEsiAsset[]): Promise<void> => {
		const assets = transformAssets(rawAssets)
		await deps.storeAssets(assets)
		totalAssets += assets.length
	}

	await processPage(firstPageResponse.data)
	deps.onProgress?.({ page: 1, totalPages, totalAssets })

	for (let page = 2; page <= totalPages; page++) {
		const pageResponse = await deps.fetchPage(page)
		await processPage(pageResponse.data)
		deps.onProgress?.({ page, totalPages, totalAssets })
	}

	return { assetsCount: totalAssets }
}
