import { getStub } from '@repo/do-utils'

import type { FittingItem } from '@repo/doctrines'
import type { Universe } from '@repo/universe'

export interface ParsedFitting {
	shipName: string
	shipTypeId: string
	fittingName: string
	items: Array<Omit<FittingItem, 'id' | 'fittingId'>>
}

export class EftParser<Env> {
	constructor(private env: Env & { UNIVERSE: DurableObjectNamespace }) {}

	public async parse(eftString: string): Promise<ParsedFitting> {
		const lines = eftString
			.trim()
			.split('\n')
			.filter((line) => line.trim() !== '')
		if (lines.length < 2) {
			throw new Error('Invalid EFT string format')
		}

		// --- Parse Header ---
		const headerMatch = lines.shift()!.match(/^\[([^,]+),\s*([^\]]+)\]$/)
		if (!headerMatch) {
			throw new Error('Invalid EFT header format')
		}
		const shipName = headerMatch[1].trim()
		const fittingName = headerMatch[2].trim()

		// --- Parse Items ---
		const itemNames = new Set<string>()
		const itemData: Array<{ name: string; quantity: string }> = []

		for (const line of lines) {
			if (line.startsWith('[Empty') || line.startsWith('[Subsystem')) {
				continue // Skip empty slots and subsystem slots for now
			}

			// Match items with quantity (e.g., "Tremor S x1000")
			const quantityMatch = line.match(/^(.*)\s+x(\d+)$/)
			let itemName: string
			let quantity: string

			if (quantityMatch) {
				itemName = quantityMatch[1].trim()
				quantity = quantityMatch[2].trim()
			} else {
				itemName = line.trim()
				quantity = '1'
			}
			itemNames.add(itemName)
			itemData.push({ name: itemName, quantity })
		}

		// --- Resolve Type IDs ---
		// Collect all type names (ship + items) for batch resolution
		const allTypeNames = [shipName, ...Array.from(itemNames)]
		const stub = getStub<Universe>(this.env.UNIVERSE, 'default')
		const typeIdMap = await stub.resolveTypeIdsByNames(allTypeNames)

		// Resolve ship type ID
		const shipType = typeIdMap[shipName]
		if (!shipType) {
			throw new Error(`Failed to resolve ship type ID for: ${shipName}`)
		}

		// --- Resolve Group IDs to get Category IDs and Group Names ---
		// Collect all unique group IDs from the resolved types
		const groupIds = new Set<string>()
		for (const typeName of allTypeNames) {
			const type = typeIdMap[typeName]
			if (type) {
				groupIds.add(type.groupId)
			}
		}

		const groupIdMap = await stub.resolveInvGroups([...groupIds])

		// --- Build Items Array ---
		const items: Array<Omit<FittingItem, 'id' | 'fittingId'>> = []
		for (const { name, quantity } of itemData) {
			const itemType = typeIdMap[name]
			if (!itemType) {
				throw new Error(`Failed to resolve type ID for: ${name}`)
			}

			const group = groupIdMap[itemType.groupId]
			const categoryId = group?.categoryId ?? '-1'
			const groupName = group?.groupName ?? 'Unknown'

			items.push({
				typeId: itemType.typeId,
				typeName: itemType.typeName,
				quantity: quantity,
				flagId: '-1', // Placeholder - TODO: Determine flagId based on slot sections
				flagName: 'None', // Placeholder - TODO: Determine flagName based on slot sections
				groupId: itemType.groupId,
				groupName: groupName,
				categoryId: categoryId,
			})
		}

		return {
			shipName,
			shipTypeId: shipType.typeId,
			fittingName,
			items,
		}
	}
}
