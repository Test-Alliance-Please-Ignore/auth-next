/**
 * Doctrines Feature Types
 *
 * Re-export types from API client for consistency
 */

import type {
	Doctrine,
	Fitting,
	FittingItem,
	DoctrineWithFittings,
	FittingWithItems,
	CreateDoctrineRequest,
	UpdateDoctrineRequest,
	CreateFittingRequest,
	UpdateFittingRequest,
	ListDoctrinesFilters,
	ListFittingsFilters,
} from '@/lib/api'

export type {
	Doctrine,
	Fitting,
	FittingItem,
	DoctrineWithFittings,
	FittingWithItems,
	CreateDoctrineRequest,
	UpdateDoctrineRequest,
	CreateFittingRequest,
	UpdateFittingRequest,
	ListDoctrinesFilters,
	ListFittingsFilters,
}

/**
 * Parsed EFT (EVE Fitting Tool) format data
 */
export interface ParsedEFT {
	shipName: string
	fittingName: string
	modules: string[]
	cargo: Array<{
		name: string
		quantity: number
	}>
}

/**
 * Grouped doctrines by category
 */
export interface DoctrinesByCategory {
	[category: string]: Doctrine[]
}
