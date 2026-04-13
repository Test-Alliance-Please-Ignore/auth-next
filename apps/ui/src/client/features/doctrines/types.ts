/**
 * Doctrines Feature Types
 *
 * Re-export types from API client for consistency
 */

import type {
	AddFittingToDoctrineRequest,
	CreateDoctrineRequest,
	CreateFittingRequest,
	Doctrine,
	DoctrineCategory,
	DoctrineFittingEntry,
	DoctrineStagingEntry,
	Fitting,
	FittingItem,
	ListDoctrinesFilters,
	ListFittingsFilters,
	ParsedFittingPreview,
	StagingSystem,
	UpdateDoctrineRequest,
	UpdateDoctrineFittingRequest,
	UpdateFittingRequest,
} from '@/lib/api'

export type {
	AddFittingToDoctrineRequest,
	CreateDoctrineRequest,
	CreateFittingRequest,
	Doctrine,
	DoctrineCategory,
	DoctrineFittingEntry,
	DoctrineStagingEntry,
	Fitting,
	FittingItem,
	ListDoctrinesFilters,
	ListFittingsFilters,
	ParsedFittingPreview,
	StagingSystem,
	UpdateDoctrineRequest,
	UpdateDoctrineFittingRequest,
	UpdateFittingRequest,
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
