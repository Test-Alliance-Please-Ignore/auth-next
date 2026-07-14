import { getStub } from '@repo/do-utils'
import { parseFittingSlotFlag } from '@repo/eve-fitting/flags'
import { getInventoryBayLabel } from '@repo/inventory-display'

import { getExportArtifactExpiresAtIso, isExportArtifactExpired } from './export-retention'

import type { Env } from '../context'
import type { Universe } from '@repo/universe'

export interface StructureAssetsDebugItem {
	itemId: string
	typeId: string
	typeName: string | null
	quantity: number
	isSingleton: boolean
	locationId: string
	locationType: string
	locationFlag: string
	locationFlagLabel: string
	updatedAt: string
}

export interface StructureAssetsDebugResult {
	corporationId: string
	corporationName: string
	structureId: string
	structureName: string
	fetchedAt: string
	fetchedAssetCount: number
	itemCount: number
	items: StructureAssetsDebugItem[]
}

export interface StructureAssetsDebugWorkflowParams {
	kind: 'structure-assets-debug'
	userId: string
	corporationId: string
	corporationName: string
	structureId: string
	structureName: string
}

export const STRUCTURE_ASSETS_DEBUG_EXPORT_BUCKET_PREFIX = 'structure-assets-debug'

export function getStructureAssetsDebugBucket(env: Pick<Env, 'STRUCTURE_ASSETS_DEBUG_EXPORTS'>): R2Bucket {
	return env.STRUCTURE_ASSETS_DEBUG_EXPORTS
}

export function buildStructureAssetsDebugExportKey(exportId: string): string {
	return `${STRUCTURE_ASSETS_DEBUG_EXPORT_BUCKET_PREFIX}/${exportId}.json`
}

export function buildStructureAssetsDebugFileName(exportId: string): string {
	return `structure-assets-debug-${exportId.slice(0, 8)}.json`
}

export function getStructureAssetLocationLabel(locationFlag: string): string {
	const fittingSlot = parseFittingSlotFlag(locationFlag)
	if (fittingSlot) {
		return `${fittingSlot.flagName} ${fittingSlot.slotIndex}`
	}

	return getInventoryBayLabel(locationFlag)
}

export async function enrichStructureAssetsDebugTypeNames(
	env: Pick<Env, 'UNIVERSE'>,
	items: StructureAssetsDebugItem[]
): Promise<StructureAssetsDebugItem[]> {
	if (items.length === 0) {
		return items
	}

	const typeIds = Array.from(new Set(items.map((item) => item.typeId)))
	if (typeIds.length === 0) {
		return items
	}

	const universe = getStub<Universe>(env.UNIVERSE, 'default')
	const typeNameMap: Record<string, string> = {}
	const batchSize = 1000

	for (let index = 0; index < typeIds.length; index += batchSize) {
		const batch = typeIds.slice(index, index + batchSize)
		const resolved = await universe.resolveTypeNamesByIds(batch)
		for (const [typeId, typeData] of Object.entries(resolved)) {
			typeNameMap[typeId] = typeData?.typeName ?? typeId
		}
	}

	return items.map((item) => ({
		...item,
		typeName: typeNameMap[item.typeId] ?? item.typeId,
	}))
}

export async function writeStructureAssetsDebugArtifact(args: {
	bucket: R2Bucket
	exportKey: string
	fileName: string
	expiresAt: string
	result: StructureAssetsDebugResult
}): Promise<number> {
	await args.bucket.put(args.exportKey, JSON.stringify(args.result), {
		httpMetadata: {
			contentType: 'application/json; charset=utf-8',
		},
		customMetadata: {
			fileName: args.fileName,
			expiresAt: args.expiresAt,
		},
	})

	return args.result.itemCount
}

export async function readStructureAssetsDebugArtifact(
	bucket: R2Bucket,
	exportKey: string
): Promise<StructureAssetsDebugResult | null> {
	const object = await bucket.get(exportKey)
	if (!object) {
		return null
	}

	if (isExportArtifactExpired(object.customMetadata?.expiresAt)) {
		await bucket.delete(exportKey).catch(() => {})
		return null
	}

	const text = await object.text()
	return JSON.parse(text) as StructureAssetsDebugResult
}

export function getStructureAssetsDebugExpiresAtIso(): string {
	return getExportArtifactExpiresAtIso()
}
