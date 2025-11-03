/**
 * @fileoverview EVE Online Inventory Type Definitions
 *
 * This module provides type definitions for EVE Online inventory items and parsing results.
 *
 * @packageDocumentation
 */

import type { EveCategoryId, EveGroupId, EveMarketGroupId, EveTypeId } from './index'

/**
 * Represents a parsed inventory item with complete metadata
 */
export interface ParsedInventoryItem {
	/** The type ID of the item */
	typeId: EveTypeId
	/** The name of the item */
	typeName: string
	/** The quantity of this item */
	quantity: number

	// Basic info
	/** Volume per unit in m³ */
	volume: number
	/** Total volume for all units in m³ */
	totalVolume: number

	// Market data
	/** Market group ID if tradeable */
	marketGroupId: EveMarketGroupId | null
	/** Market group name if tradeable */
	marketGroupName: string | null
	/** Base price per unit in ISK (as string to avoid BigInt issues) */
	basePrice: string | null
	/** Total estimated value in ISK (as string) */
	totalValue: string | null

	// Physical properties
	/** Mass per unit in kg */
	mass: number
	/** Total mass for all units in kg */
	totalMass: number
	/** Cargo capacity in m³ (for containers/ships) */
	capacity: number
	/** Standard portion size for reprocessing */
	portionSize: number
	/** Volume when packaged (if different from normal volume) */
	packagedVolume: number | null

	// Categories
	/** Group ID of the item */
	groupId: EveGroupId
	/** Group name of the item */
	groupName: string
	/** Category ID of the item */
	categoryId: EveCategoryId
	/** Category name of the item */
	categoryName: string

	/** Whether this item is published (visible in game) */
	published: boolean
	/** Icon ID for the item */
	iconId: number | null
	/** Race ID if faction-specific */
	raceId: number | null
}

/**
 * Represents an unparseable line from inventory text
 */
export interface InventoryParseError {
	/** Line number in the original text */
	lineNumber: number
	/** The raw text of the line */
	rawText: string
	/** Reason why parsing failed */
	reason: 'invalid_format' | 'item_not_found' | 'invalid_quantity'
	/** Additional error details */
	details?: string
}

/**
 * Result of parsing inventory text
 */
export interface InventoryParseResult {
	/** Successfully parsed items with metadata */
	items: ParsedInventoryItem[]
	/** Lines that could not be parsed */
	errors: InventoryParseError[]
	/** Summary statistics */
	summary: {
		/** Total number of unique item types */
		uniqueTypes: number
		/** Total quantity of all items */
		totalQuantity: number
		/** Total volume of all items in m³ */
		totalVolume: number
		/** Total mass of all items in kg */
		totalMass: number
		/** Total estimated value in ISK (as string) */
		totalValue: string | null
		/** Number of lines successfully parsed */
		successCount: number
		/** Number of lines that failed to parse */
		errorCount: number
	}
}

/**
 * Database representation of an inventory type
 */
export interface InventoryType {
	typeId: string // Text-based ID per project convention
	groupId: string
	typeName: string
	description: string | null
	mass: number
	volume: number
	capacity: number
	portionSize: number
	raceId: number | null
	basePrice: string | null // String to avoid BigInt issues
	published: boolean
	marketGroupId: string | null
	iconId: number | null
}

/**
 * Database representation of an inventory group
 */
export interface InventoryGroup {
	groupId: string
	categoryId: string
	groupName: string
	iconId: number | null
	useBasePrice: boolean
	anchored: boolean
	anchorable: boolean
	fittableNonSingleton: boolean
	published: boolean
}

/**
 * Database representation of an inventory category
 */
export interface InventoryCategory {
	categoryId: string
	categoryName: string
	iconId: number | null
	published: boolean
}

/**
 * Database representation of a market group
 */
export interface MarketGroup {
	marketGroupId: string
	parentGroupId: string | null
	marketGroupName: string
	description: string | null
	iconId: number | null
	hasTypes: boolean
}
