/**
 * @repo/doctrines
 *
 * Shared types and interfaces for the Doctrines Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

// --- Database Models ---
export interface Doctrine {
	id: string
	name: string
	category: string
	maintainer: string
	createdAt: Date
	updatedAt: Date
}

export interface Fitting {
	id: string
	shipTypeId: string
	shipName: string
	fitting: string
	category: string
	maintainer: string
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

export interface DoctrineFitting {
	doctrineId: string
	fittingId: string
}

// --- Request Payloads ---
export type CreateDoctrineRequest = Omit<Doctrine, 'id' | 'createdAt' | 'updatedAt'>
export type UpdateDoctrineRequest = Partial<CreateDoctrineRequest>

export type CreateFittingRequest = Omit<Fitting, 'id' | 'createdAt' | 'updatedAt'> & {
	fittingItems: Array<Omit<FittingItem, 'id' | 'fittingId'>>
}
export type UpdateFittingRequest = Partial<CreateFittingRequest>

// --- Filters ---
export interface ListDoctrinesFilters {
	category?: string
	maintainer?: string
	search?: string
}

export interface ListFittingsFilters {
	shipTypeId?: string
	category?: string
	maintainer?: string
	srpEligible?: boolean
	search?: string
}

// --- Enriched Types ---
export type DoctrineWithFittings = Doctrine & {
	fittings: Fitting[]
}

export type FittingWithItems = Fitting & {
	fittingItems: FittingItem[]
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
export interface Doctrines {
	// Doctrine Management
	createDoctrine(
		data: CreateDoctrineRequest,
		userId: string,
		characterIds: string[]
	): Promise<Doctrine>
	getDoctrines(
		filters: ListDoctrinesFilters,
		userId: string,
		characterIds: string[],
		isAdmin: boolean
	): Promise<Doctrine[]>
	getDoctrine(
		id: string,
		userId: string,
		characterIds: string[],
		isAdmin: boolean
	): Promise<DoctrineWithFittings | null>
	updateDoctrine(
		id: string,
		data: UpdateDoctrineRequest,
		userId: string,
		characterIds: string[],
		isAdmin: boolean
	): Promise<Doctrine>
	deleteDoctrine(
		id: string,
		userId: string,
		characterIds: string[],
		isAdmin: boolean
	): Promise<void>

	// Fitting Management
	createFitting(
		data: CreateFittingRequest,
		userId: string,
		characterIds: string[]
	): Promise<Fitting>
	getFittings(
		filters: ListFittingsFilters,
		userId: string,
		characterIds: string[],
		isAdmin: boolean
	): Promise<Fitting[]>
	getFitting(
		id: string,
		userId: string,
		characterIds: string[],
		isAdmin: boolean
	): Promise<FittingWithItems | null>
	updateFitting(
		id: string,
		data: UpdateFittingRequest,
		userId: string,
		characterIds: string[],
		isAdmin: boolean
	): Promise<Fitting>
	deleteFitting(
		id: string,
		userId: string,
		characterIds: string[],
		isAdmin: boolean
	): Promise<void>

	// Doctrine-Fitting Relationship
	addFittingToDoctrine(
		doctrineId: string,
		fittingId: string,
		userId: string,
		characterIds: string[],
		isAdmin: boolean
	): Promise<void>
	removeFittingFromDoctrine(
		doctrineId: string,
		fittingId: string,
		userId: string,
		characterIds: string[],
		isAdmin: boolean
	): Promise<void>
}
