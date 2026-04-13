/**
 * @repo/doctrines
 *
 * Shared types and interfaces for the Doctrines Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

import { z } from 'zod'

export { CATEGORY_SLOT_OVERRIDES, CATEGORY_SUBSYSTEM, EFT_SECTION_ORDER, SLOT_FLAGS } from './flags'
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

export type CreateFittingRequest = Omit<Fitting, 'id' | 'name' | 'shipTypeId' | 'shipName' | 'createdAt' | 'updatedAt'> & {
	name?: string
	shipTypeId?: string
	shipName?: string
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

// --- Validation Schemas ---

export const CreateCategorySchema = z.object({
	name: z.string().min(1).max(200),
	sortOrder: z.number().int().min(0).optional(),
})

export const UpdateCategorySchema = z.object({
	name: z.string().min(1).max(200).optional(),
	sortOrder: z.number().int().min(0).optional(),
})

export const CreateStagingSystemSchema = z.object({
	solarSystemId: z.string().min(1),
	solarSystemName: z.string().min(1).max(200),
	sortOrder: z.number().int().min(0).optional(),
})

export const UpdateStagingSystemSchema = z.object({
	solarSystemId: z.string().min(1).optional(),
	solarSystemName: z.string().min(1).max(200).optional(),
	sortOrder: z.number().int().min(0).optional(),
})

export const CreateDoctrineSchema = z.object({
	name: z.string().min(1).max(200),
	description: z.string().max(2000).optional(),
	shipTypeId: z.string().optional(),
	categoryId: z.string().optional(),
	sortOrder: z.number().int().min(0).optional(),
})

export const UpdateDoctrineSchema = z.object({
	name: z.string().min(1).max(200).optional(),
	description: z.string().max(2000).optional(),
	shipTypeId: z.string().optional(),
	categoryId: z.string().optional(),
	sortOrder: z.number().int().min(0).optional(),
})

export const CreateFittingSchema = z.object({
	name: z.string().min(1).max(200).optional(),
	description: z.string().max(2000).nullable().optional().default(null),
	shipTypeId: z.string().min(1).optional(),
	shipName: z.string().min(1).max(200).optional(),
	fitting: z.string().min(1).max(50000),
	category: z.string().min(1).max(200),
	srpEligible: z.boolean().optional().default(false),
	srpValue: z.string().optional().default('0'),
	fittingItems: z
		.array(
			z.object({
				typeId: z.string(),
				typeName: z.string(),
				quantity: z.string(),
				flagId: z.string(),
				flagName: z.string(),
				groupId: z.string(),
				groupName: z.string(),
				categoryId: z.string(),
			})
		)
		.optional()
		.default([]),
})

export const UpdateFittingSchema = z.object({
	name: z.string().min(1).max(200).optional(),
	description: z.string().max(2000).nullable().optional(),
	shipTypeId: z.string().min(1).optional(),
	shipName: z.string().min(1).max(200).optional(),
	fitting: z.string().min(1).max(50000).optional(),
	category: z.string().min(1).max(200).optional(),
	srpEligible: z.boolean().optional(),
	srpValue: z.string().optional(),
	fittingItems: z
		.array(
			z.object({
				typeId: z.string(),
				typeName: z.string(),
				quantity: z.string(),
				flagId: z.string(),
				flagName: z.string(),
				groupId: z.string(),
				groupName: z.string(),
				categoryId: z.string(),
			})
		)
		.optional(),
})

export const AddFittingToDoctrineSchema = z.object({
	fittingId: z.string().min(1),
	fittingCategory: z.string().max(200).optional(),
	sortOrder: z.number().int().min(0).optional(),
})

export const UpdateDoctrineFittingSchema = z.object({
	fittingCategory: z.string().max(200).optional(),
	sortOrder: z.number().int().min(0).optional(),
})

export const SetDoctrineStagingSchema = z.object({
	stagingSystemId: z.string().min(1),
	note: z.string().max(500),
})

export const PreviewEftSchema = z.object({
	eftString: z.string().min(1).max(50000),
})

export const SaveIngameSchema = z.object({
	characterId: z.string().min(1),
})

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
	updateDoctrine(
		id: string,
		data: UpdateDoctrineRequest & { updatedBy?: string }
	): Promise<Doctrine>
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
	updateDoctrineFitting(
		doctrineId: string,
		fittingId: string,
		data: UpdateDoctrineFittingRequest
	): Promise<void>
	removeFittingFromDoctrine(doctrineId: string, fittingId: string): Promise<void>

	// Type Search
	searchShipTypes(query: string): Promise<Array<{ typeId: string; typeName: string }>>

	// EFT Preview
	parseEft(eftString: string): Promise<ParsedFittingPreview>
}
