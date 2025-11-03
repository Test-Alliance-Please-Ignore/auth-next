/**
 * Inventory Parser Utility
 *
 * Parses EVE Online inventory text exports and returns structured data
 * with item metadata from the database.
 */

import type {
	InventoryParseError,
	InventoryParseResult,
	ParsedInventoryItem,
} from '@repo/eve-types'
import type { invCategories, invGroups, invTypes, marketGroups } from '../db/schema'
import { eq, ilike, sql, and } from 'drizzle-orm'

/**
 * Parse a single line of inventory text
 * Format: ItemName[TAB]Quantity
 */
function parseInventoryLine(line: string, lineNumber: number): {
	itemName: string | null
	quantity: number
	error?: InventoryParseError
} {
	// Skip empty lines
	const trimmedLine = line.trim()
	if (!trimmedLine) {
		return { itemName: null, quantity: 0 }
	}

	// Split by tab character
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

	// Parse quantity - default to 1 if missing or invalid
	let quantity = 1
	if (parts.length > 1 && parts[1]) {
		const quantityStr = parts[1].trim()
		if (quantityStr) {
			const parsedQty = parseInt(quantityStr, 10)
			if (!isNaN(parsedQty) && parsedQty > 0) {
				quantity = parsedQty
			} else if (quantityStr !== '') {
				// Non-empty but invalid quantity
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

/**
 * Query the database for item information
 */
async function lookupItem(
	invTypesTable: typeof invTypes,
	invGroupsTable: typeof invGroups,
	invCategoriesTable: typeof invCategories,
	marketGroupsTable: typeof marketGroups,
	db: any,
	itemName: string
): Promise<{
	type: any
	group: any
	category: any
	marketGroup: any
} | null> {
	try {
		// Case-insensitive lookup for item using trigram index
		// Using sql`lower()` instead of ilike() to leverage the trigram GIN index
		const results = await db
			.select({
				typeId: invTypesTable.typeId,
				typeName: invTypesTable.typeName,
				volume: invTypesTable.volume,
				mass: invTypesTable.mass,
				capacity: invTypesTable.capacity,
				portionSize: invTypesTable.portionSize,
				basePrice: invTypesTable.basePrice,
				published: invTypesTable.published,
				iconId: invTypesTable.iconId,
				raceId: invTypesTable.raceId,
				marketGroupId: invTypesTable.marketGroupId,
				typeGroupId: invTypesTable.groupId,
				groupId: invGroupsTable.groupId,
				groupName: invGroupsTable.groupName,
				groupCategoryId: invGroupsTable.categoryId,
				categoryId: invCategoriesTable.categoryId,
				categoryName: invCategoriesTable.categoryName,
				marketGroupIdFromMarket: marketGroupsTable.marketGroupId,
				marketGroupName: marketGroupsTable.marketGroupName,
			})
			.from(invTypesTable)
			.innerJoin(invGroupsTable, eq(invTypesTable.groupId, invGroupsTable.groupId))
			.innerJoin(invCategoriesTable, eq(invGroupsTable.categoryId, invCategoriesTable.categoryId))
			.leftJoin(marketGroupsTable, eq(invTypesTable.marketGroupId, marketGroupsTable.marketGroupId))
			.where(sql`lower(${invTypesTable.typeName}) = lower(${itemName})`)
			.limit(1)

		if (!results[0]) {
			return null
		}

		const row = results[0]
		return {
			type: {
				typeId: row.typeId,
				typeName: row.typeName,
				volume: row.volume,
				mass: row.mass,
				capacity: row.capacity,
				portionSize: row.portionSize,
				basePrice: row.basePrice,
				published: row.published,
				iconId: row.iconId,
				raceId: row.raceId,
				marketGroupId: row.marketGroupId,
			},
			group: {
				groupId: row.groupId,
				groupName: row.groupName,
			},
			category: {
				categoryId: row.categoryId,
				categoryName: row.categoryName,
			},
			marketGroup: row.marketGroupName
				? {
						marketGroupId: row.marketGroupIdFromMarket,
						marketGroupName: row.marketGroupName,
					}
				: null,
		}
	} catch (error) {
		console.error(`Error looking up item "${itemName}":`, error)
		return null
	}
}

/**
 * Calculate total value in ISK (as string to avoid BigInt issues)
 */
function calculateTotalValue(basePrice: string | null, quantity: number): string | null {
	if (!basePrice) return null

	try {
		const price = parseFloat(basePrice)
		const total = price * quantity
		return total.toFixed(2)
	} catch {
		return null
	}
}

/**
 * Parse inventory text and return structured data
 */
export async function parseInventory(
	invTypesTable: typeof invTypes,
	invGroupsTable: typeof invGroups,
	invCategoriesTable: typeof invCategories,
	marketGroupsTable: typeof marketGroups,
	db: any,
	inventoryText: string
): Promise<InventoryParseResult> {
	const lines = inventoryText.split('\n')
	const items: ParsedInventoryItem[] = []
	const errors: InventoryParseError[] = []

	// Track summary statistics
	let totalQuantity = 0
	let totalVolume = 0
	let totalMass = 0
	let totalValue = 0
	let hasValue = false

	for (let i = 0; i < lines.length; i++) {
		const lineNumber = i + 1
		const { itemName, quantity, error } = parseInventoryLine(lines[i], lineNumber)

		// Skip empty lines
		if (!itemName && !error) {
			continue
		}

		// Handle parse errors
		if (error) {
			errors.push(error)
			continue
		}

		if (!itemName) {
			continue
		}

		// Look up item in database
		const itemData = await lookupItem(
			invTypesTable,
			invGroupsTable,
			invCategoriesTable,
			marketGroupsTable,
			db,
			itemName
		)

		if (!itemData) {
			errors.push({
				lineNumber,
				rawText: lines[i],
				reason: 'item_not_found',
				details: `Item "${itemName}" not found in database`,
			})
			continue
		}

		const { type, group, category, marketGroup } = itemData

		// Calculate totals
		const itemTotalVolume = type.volume * quantity
		const itemTotalMass = type.mass * quantity
		const itemTotalValue = calculateTotalValue(type.basePrice, quantity)

		// Create parsed item
		const parsedItem: ParsedInventoryItem = {
			typeId: type.typeId,
			typeName: type.typeName,
			quantity,

			// Basic info
			volume: type.volume,
			totalVolume: itemTotalVolume,

			// Market data
			marketGroupId: type.marketGroupId,
			marketGroupName: marketGroup?.marketGroupName || null,
			basePrice: type.basePrice,
			totalValue: itemTotalValue,

			// Physical properties
			mass: type.mass,
			totalMass: itemTotalMass,
			capacity: type.capacity,
			portionSize: type.portionSize,
			packagedVolume: null, // Could be calculated based on group/category

			// Categories
			groupId: group.groupId,
			groupName: group.groupName,
			categoryId: category.categoryId,
			categoryName: category.categoryName,

			// Additional properties
			published: type.published,
			iconId: type.iconId,
			raceId: type.raceId,
		}

		items.push(parsedItem)

		// Update totals
		totalQuantity += quantity
		totalVolume += itemTotalVolume
		totalMass += itemTotalMass

		if (itemTotalValue) {
			totalValue += parseFloat(itemTotalValue)
			hasValue = true
		}
	}

	// Create result
	const result: InventoryParseResult = {
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

	return result
}

/**
 * Export a simple version that takes the database tables directly
 */
export async function parseInventoryWithTables(
	invTypesTable: typeof invTypes,
	invGroupsTable: typeof invGroups,
	invCategoriesTable: typeof invCategories,
	marketGroupsTable: typeof marketGroups,
	db: any,
	inventoryText: string
): Promise<InventoryParseResult> {
	return parseInventory(
		invTypesTable,
		invGroupsTable,
		invCategoriesTable,
		marketGroupsTable,
		db,
		inventoryText
	)
}