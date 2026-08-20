import { transformAssets } from '../lib/esi-transforms'

import type { EsiResult } from '@repo/esi'
import type { EsiCorporationAsset as StoredCorporationAsset } from '@repo/eve-corporation-data'

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
	fetchPage: (page: number) => Promise<EsiResult<RawEsiAsset[]>>
	storeAssets: (assets: StoredCorporationAsset[]) => Promise<void>
	onProgress?: (progress: { page: number; totalPages: number; totalAssets: number }) => void
}

export function dedupeByItemId<T>(items: T[], getItemId: (item: T) => string): T[] {
	const deduped = new Map<string, T>()
	for (const item of items) {
		deduped.set(getItemId(item), item)
	}

	return [...deduped.values()]
}

function validatePageResponse(
	response: Pick<EsiResult<RawEsiAsset[]>, 'meta'>,
	requestedPage: number,
	totalPages: number
): void {
	if (response.meta.page !== null && response.meta.page !== requestedPage) {
		throw new Error(
			`ESI corporation assets returned page ${response.meta.page} when page ${requestedPage} was requested`
		)
	}

	if (response.meta.pages !== null && response.meta.pages !== totalPages) {
		throw new Error(
			`ESI corporation assets changed page count while fetching: expected ${totalPages}, got ${response.meta.pages}`
		)
	}
}

/**
 * Fetches corporation assets page-by-page and persists each page immediately.
 * This prevents large in-memory arrays or large RPC payloads.
 */
export async function syncAssetsPaged(
	deps: AssetsPagingSyncDeps
): Promise<{ assetsCount: number }> {
	const firstPageResponse = await deps.fetchPage(1)
	const totalPages = firstPageResponse.meta.pages ?? 1
	if (!Number.isInteger(totalPages) || totalPages < 1) {
		throw new Error(`ESI corporation assets returned an invalid page count: ${totalPages}`)
	}
	validatePageResponse(firstPageResponse, 1, totalPages)
	let totalAssets = 0

	const processPage = async (rawAssets: RawEsiAsset[]): Promise<void> => {
		const dedupedRawAssets = dedupeByItemId(rawAssets, (asset) => String(asset.item_id))
		const assets = transformAssets(dedupedRawAssets)
		await deps.storeAssets(assets)
		totalAssets += assets.length
	}

	await processPage(firstPageResponse.data)
	deps.onProgress?.({ page: 1, totalPages, totalAssets })

	for (let page = 2; page <= totalPages; page++) {
		const pageResponse = await deps.fetchPage(page)
		validatePageResponse(pageResponse, page, totalPages)
		await processPage(pageResponse.data)
		deps.onProgress?.({ page, totalPages, totalAssets })
	}

	return { assetsCount: totalAssets }
}
