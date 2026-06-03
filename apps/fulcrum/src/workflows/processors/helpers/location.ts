import { shipTypeIds } from './ship-types'

import { isStructureId } from '@repo/esi'

import type { CharacterAsset } from '@repo/esi'

export type TopLevelLocation = {
	locationId: string
	locationType: 'station' | 'other'
	containerItemId?: string
}

export function buildAssetMap(assets: CharacterAsset[]): Map<string, CharacterAsset> {
	const assetMap = new Map<string, CharacterAsset>()
	for (const asset of assets) {
		assetMap.set(asset.item_id, asset)
	}
	return assetMap
}

export function isShipAsset(asset: CharacterAsset): boolean {
	return asset.is_singleton === true && shipTypeIds.has(asset.type_id)
}

export function isInsideShip(asset: CharacterAsset, assetMap: Map<string, CharacterAsset>): boolean {
	let currentId = asset.location_id
	const visited = new Set<string>()

	while (currentId && !visited.has(currentId)) {
		visited.add(currentId)
		const parent = assetMap.get(currentId)
		if (!parent) break
		if (isShipAsset(parent)) return true
		if (parent.location_type !== 'item') break
		currentId = parent.location_id
	}

	return false
}

export function resolveTopLevelLocation(
	asset: CharacterAsset,
	assetMap: Map<string, CharacterAsset>
): TopLevelLocation | null {
	const immediateParent = assetMap.get(asset.location_id)
	const containerItemId =
		immediateParent && !isShipAsset(immediateParent) ? immediateParent.item_id : undefined

	let currentId = asset.location_id
	const visited = new Set<string>()

	while (currentId && !visited.has(currentId)) {
		visited.add(currentId)
		const parent = assetMap.get(currentId)
		if (!parent) {
			if (isStructureId(currentId)) {
				return {
					locationId: currentId,
					locationType: 'other',
					containerItemId,
				}
			}
			return null
		}
		if (parent.location_type === 'station' || parent.location_type === 'other') {
			return {
				locationId: parent.location_id,
				locationType: parent.location_type,
				containerItemId,
			}
		}
		if (parent.location_type === 'item') {
			currentId = parent.location_id
			continue
		}
		break
	}

	// Structure-held items and containers do not always have a terminal
	// station/other parent in the raw asset tree. In that case, the immediate
	// parent is the last usable container and its location_id is the structure.
	if (immediateParent && !isShipAsset(immediateParent) && isStructureId(immediateParent.location_id)) {
		return {
			locationId: immediateParent.location_id,
			locationType: 'other',
			containerItemId,
		}
	}

	return null
}
