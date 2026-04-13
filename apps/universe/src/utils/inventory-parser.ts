import { eq, sql } from 'drizzle-orm'

import { invCategories, invGroups, invMarketGroups, invTypes } from '../db/schema'

import type {
	InventoryParseError,
	InventoryParseResult,
	ParsedInventoryItem,
} from '@repo/eve-types'

function parseInventoryLine(
	line: string,
	lineNumber: number
): {
	itemName: string | null
	quantity: number
	error?: InventoryParseError
} {
	const trimmedLine = line.trim()
	if (!trimmedLine) {
		return { itemName: null, quantity: 0 }
	}

	const parts = trimmedLine.split('\t')
	if (parts.length === 0) {
		return {
			itemName: null,
			quantity: 0,
			error: {
				lineNumber,
				rawText: line,
				reason: 'invalid_format',
				details: 'Empty line',
			},
		}
	}

	const itemName = parts[0].trim()
	if (!itemName) {
		return {
			itemName: null,
			quantity: 0,
			error: {
				lineNumber,
				rawText: line,
				reason: 'invalid_format',
				details: 'No item name found',
			},
		}
	}

	let quantity = 1
	if (parts.length > 1 && parts[1]) {
		const quantityStr = parts[1].trim()
		if (quantityStr) {
			const parsedQty = Number.parseInt(quantityStr, 10)
			if (!Number.isNaN(parsedQty) && parsedQty > 0) {
				quantity = parsedQty
			} else {
				return {
					itemName,
					quantity: 0,
					error: {
						lineNumber,
						rawText: line,
						reason: 'invalid_quantity',
						details: `Invalid quantity: "${quantityStr}"`,
					},
				}
			}
		}
	}

	return { itemName, quantity }
}

function toNumber(value: string | number | null | undefined, fallback = 0): number {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : fallback
	}
	if (typeof value === 'string') {
		const parsed = Number.parseFloat(value)
		return Number.isFinite(parsed) ? parsed : fallback
	}
	return fallback
}

function toNullableInt(value: string | null | undefined): number | null {
	if (typeof value !== 'string' || value.length === 0) {
		return null
	}
	const parsed = Number.parseInt(value, 10)
	return Number.isNaN(parsed) ? null : parsed
}

function calculateTotalValue(basePrice: string | null, quantity: number): string | null {
	if (!basePrice) {
		return null
	}

	const price = Number.parseFloat(basePrice)
	if (!Number.isFinite(price)) {
		return null
	}

	return (price * quantity).toFixed(2)
}

async function lookupItem(db: any, itemName: string): Promise<ParsedInventoryItem | null> {
	const results = await db
		.select({
			typeId: invTypes.typeId,
			typeName: invTypes.typeName,
			volume: invTypes.volume,
			mass: invTypes.mass,
			capacity: invTypes.capacity,
			portionSize: invTypes.portionSize,
			basePrice: invTypes.basePrice,
			published: invTypes.published,
			iconId: invTypes.iconId,
			raceId: invTypes.raceId,
			marketGroupId: invTypes.marketGroupId,
			groupId: invGroups.groupId,
			groupName: invGroups.groupName,
			categoryId: invCategories.categoryId,
			categoryName: invCategories.categoryName,
			marketGroupName: invMarketGroups.marketGroupName,
		})
		.from(invTypes)
		.innerJoin(invGroups, eq(invTypes.groupId, invGroups.groupId))
		.innerJoin(invCategories, eq(invGroups.categoryId, invCategories.categoryId))
		.leftJoin(invMarketGroups, eq(invTypes.marketGroupId, invMarketGroups.marketGroupId))
		.where(sql`lower(${invTypes.typeName}) = lower(${itemName})`)
		.limit(1)

	const row = results[0]
	if (!row) {
		return null
	}

	return {
		typeId: row.typeId,
		typeName: row.typeName,
		quantity: 0, // assigned by caller
		volume: toNumber(row.volume),
		totalVolume: 0, // assigned by caller
		marketGroupId: row.marketGroupId,
		marketGroupName: row.marketGroupName ?? null,
		basePrice: row.basePrice,
		totalValue: null, // assigned by caller
		mass: toNumber(row.mass),
		totalMass: 0, // assigned by caller
		capacity: toNumber(row.capacity),
		portionSize: row.portionSize,
		packagedVolume: null,
		groupId: row.groupId,
		groupName: row.groupName,
		categoryId: row.categoryId,
		categoryName: row.categoryName,
		published: row.published,
		iconId: toNullableInt(row.iconId),
		raceId: toNullableInt(row.raceId),
	}
}

export async function parseInventory(db: any, inventoryText: string): Promise<InventoryParseResult> {
	const lines = inventoryText.split('\n')
	const items: ParsedInventoryItem[] = []
	const errors: InventoryParseError[] = []

	let totalQuantity = 0
	let totalVolume = 0
	let totalMass = 0
	let totalValue = 0
	let hasValue = false

	for (let i = 0; i < lines.length; i++) {
		const lineNumber = i + 1
		const { itemName, quantity, error } = parseInventoryLine(lines[i], lineNumber)

		if (!itemName && !error) {
			continue
		}

		if (error) {
			errors.push(error)
			continue
		}

		if (!itemName) {
			continue
		}

		const item = await lookupItem(db, itemName)
		if (!item) {
			errors.push({
				lineNumber,
				rawText: lines[i],
				reason: 'item_not_found',
				details: `Item "${itemName}" not found in database`,
			})
			continue
		}

		const itemTotalVolume = item.volume * quantity
		const itemTotalMass = item.mass * quantity
		const itemTotalValue = calculateTotalValue(item.basePrice, quantity)

		items.push({
			...item,
			quantity,
			totalVolume: itemTotalVolume,
			totalMass: itemTotalMass,
			totalValue: itemTotalValue,
		})

		totalQuantity += quantity
		totalVolume += itemTotalVolume
		totalMass += itemTotalMass

		if (itemTotalValue) {
			totalValue += Number.parseFloat(itemTotalValue)
			hasValue = true
		}
	}

	return {
		items,
		errors,
		summary: {
			uniqueTypes: items.length,
			totalQuantity,
			totalVolume,
			totalMass,
			totalValue: hasValue ? totalValue.toFixed(2) : null,
			successCount: items.length,
			errorCount: errors.length,
		},
	}
}
