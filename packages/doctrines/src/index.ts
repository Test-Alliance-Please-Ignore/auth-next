/**
 * @repo/doctrines
 *
 * Shared types and interfaces for the Doctrines Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

export {
	CATEGORY_SLOT_OVERRIDES,
	CATEGORY_SUBSYSTEM,
	EFT_SECTION_ORDER,
	SLOT_FLAGS,
} from './flags'
export type { SlotFlag } from './flags'

// --- Database Models ---

export interface DoctrineCategory {
	id: string
	name: string
	sortOrder: number
}

export interface StagingSystem {
	id: string
	solarSystemId: string
	solarSystemName: string
	sortOrder: number
}

export interface DoctrineStagingEntry {
	stagingSystem: StagingSystem
	note: string
}

export interface Doctrine {
	id: string
	name: string
	description: string | null
	shipTypeId: string | null
	categoryId: string | null
	categoryName: string | null
	categorySortOrder: number | null
	sortOrder: number
	updatedBy: string | null
	createdAt: Date
	updatedAt: Date
	stagingSystems: DoctrineStagingEntry[]
}

export interface Fitting {
	id: string
	name: string
	description: string | null
	shipTypeId: string
	shipName: string
	fitting: string
	category: string
	srpEligible: boolean
	srpValue: string
	createdAt: Date
	updatedAt: Date
}

export interface FittingItem {
	id: string
	fittingId: string
	typeId: string
	typeName: string
	quantity: string
	flagId: string
	flagName: string
	groupId: string
	groupName: string
	categoryId: string
}

// --- Request Payloads ---
export interface CreateDoctrineRequest {
	name: string
	description?: string
	shipTypeId?: string
	categoryId?: string
	sortOrder?: number
}
export type UpdateDoctrineRequest = Partial<CreateDoctrineRequest>

export type CreateFittingRequest = Omit<Fitting, 'id' | 'createdAt' | 'updatedAt'> & {
	fittingItems: Array<Omit<FittingItem, 'id' | 'fittingId'>>
}
export type UpdateFittingRequest = Partial<CreateFittingRequest>

// --- Filters ---
export interface ListDoctrinesFilters {
	search?: string
}

export interface ListFittingsFilters {
	shipTypeId?: string
	category?: string
	srpEligible?: boolean
	search?: string
}

// --- Enriched Types ---
export interface DoctrineFittingEntry {
	fitting: Fitting
	fittingCategory: string
	sortOrder: number
}

export type DoctrineWithFittings = Doctrine & {
	fittings: DoctrineFittingEntry[]
	stagingSystems: DoctrineStagingEntry[]
	category: DoctrineCategory | null
}

export type FittingWithItems = Fitting & {
	fittingItems: FittingItem[]
}

export type FittingWithDoctrines = Fitting & {
	doctrines: Array<{ id: string; name: string }>
}

export interface AddFittingToDoctrineRequest {
	fittingId: string
	fittingCategory?: string
	sortOrder?: number
}

export interface UpdateDoctrineFittingRequest {
	fittingCategory?: string
	sortOrder?: number
}

export interface CreateCategoryRequest {
	name: string
	sortOrder?: number
}
export type UpdateCategoryRequest = Partial<CreateCategoryRequest>

export interface CreateStagingSystemRequest {
	solarSystemId: string
	solarSystemName: string
	sortOrder?: number
}
export type UpdateStagingSystemRequest = Partial<CreateStagingSystemRequest>

export interface SetDoctrineStagingRequest {
	stagingSystemId: string
	note: string
}

/**
 * Public RPC interface for Doctrines Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Doctrines } from '@repo/doctrines'
 * import { getStub } from '@repo/do-utils'
 *
 * using stub = getStub<Doctrines>(env.DOCTRINES, 'my-id')
 * // Add method calls here
 * ```
 */
export interface ParsedFittingPreview {
	shipName: string
	shipTypeId: string
	fittingName: string
	items: Array<Omit<FittingItem, 'id' | 'fittingId'>>
	unresolvedItems: string[]
}

export interface Doctrines {
	// Category Management
	createCategory(data: CreateCategoryRequest): Promise<DoctrineCategory>
	getCategories(): Promise<DoctrineCategory[]>
	updateCategory(id: string, data: UpdateCategoryRequest): Promise<DoctrineCategory>
	deleteCategory(id: string): Promise<void>

	// Staging System Management
	createStagingSystem(data: CreateStagingSystemRequest): Promise<StagingSystem>
	getStagingSystems(): Promise<StagingSystem[]>
	updateStagingSystem(id: string, data: UpdateStagingSystemRequest): Promise<StagingSystem>
	deleteStagingSystem(id: string): Promise<void>

	// Doctrine Management
	createDoctrine(data: CreateDoctrineRequest & { updatedBy?: string }): Promise<Doctrine>
	getDoctrines(filters: ListDoctrinesFilters): Promise<Doctrine[]>
	getDoctrine(id: string): Promise<DoctrineWithFittings | null>
	updateDoctrine(id: string, data: UpdateDoctrineRequest & { updatedBy?: string }): Promise<Doctrine>
	deleteDoctrine(id: string): Promise<void>

	// Doctrine-Staging Relationship
	setDoctrineStagingSystem(doctrineId: string, data: SetDoctrineStagingRequest): Promise<void>
	removeDoctrineStagingSystem(doctrineId: string, stagingSystemId: string): Promise<void>

	// Fitting Management
	createFitting(data: CreateFittingRequest): Promise<Fitting>
	getFittings(filters: ListFittingsFilters): Promise<Fitting[]>
	getFittingsWithDoctrines(): Promise<FittingWithDoctrines[]>
	getFitting(id: string): Promise<FittingWithItems | null>
	updateFitting(id: string, data: UpdateFittingRequest): Promise<Fitting>
	deleteFitting(id: string): Promise<void>

	// Doctrine-Fitting Relationship
	addFittingToDoctrine(doctrineId: string, data: AddFittingToDoctrineRequest): Promise<void>
	updateDoctrineFitting(doctrineId: string, fittingId: string, data: UpdateDoctrineFittingRequest): Promise<void>
	removeFittingFromDoctrine(doctrineId: string, fittingId: string): Promise<void>

	// Type Search
	searchShipTypes(query: string): Promise<Array<{ typeId: string; typeName: string }>>

	// EFT Preview
	parseEft(eftString: string): Promise<ParsedFittingPreview>
}
