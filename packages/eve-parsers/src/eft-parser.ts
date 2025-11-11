import type { FittingItem } from '@repo/doctrines'

export interface ParsedFitting {
	shipName: string
	shipTypeId: string
	fittingName: string
	items: Array<Omit<FittingItem, 'id' | 'fittingId'>>
}

export class EftParser {
	public async parse(eftString: string): Promise<ParsedFitting> {
		const lines = eftString
			.trim()
			.split('\n')
			.filter((line) => line.trim() !== '')
		if (lines.length < 2) {
			throw new Error('Invalid EFT string format')
		}

		// --- Parse Header ---
		const headerMatch = lines.shift()!.match(/^[\[\]\([^,]+\),\s*([^\]]+)\]$/)
		if (!headerMatch) {
			throw new Error('Invalid EFT header format')
		}
		const shipName = headerMatch[1].trim()
		const fittingName = headerMatch[2].trim()

		// --- Parse Items ---
		const items: Array<Omit<FittingItem, 'id' | 'fittingId'>> = []
		const itemNames = new Set<string>()

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
		}

		// TODO: Determine flagId and flagName based on slot sections.
		// This is a simplified approach for now.
		for (const line of lines) {
			if (line.startsWith('[Empty') || line.startsWith('[Subsystem')) {
				continue
			}

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
			items.push({
				typeId: itemName,
				typeName: itemName,
				quantity: quantity,
				flagId: '-1', // Placeholder
				flagName: 'None', // Placeholder
				groupId: '-1', // Placeholder
				groupName: 'Unknown', // TODO: Get groupName from SDE
				categoryId: '-1', // Placeholder
			})
		}

		return {
			shipName,
			shipTypeId: '-1', // Placeholder
			fittingName,
			items,
		}
	}
}
