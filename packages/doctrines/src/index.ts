/**
 * @repo/doctrines
 *
 * Shared types and interfaces for the Doctrines Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import type * as schema from '../apps/doctrines/src/db/schema'

// --- Database Models ---
export type Doctrine = InferSelectModel<typeof schema.doctrinesDoctrines>
export type Fitting = InferSelectModel<typeof schema.doctrinesFittings>
export type FittingItem = InferSelectModel<typeof schema.doctrinesFittingItems>
export type DoctrineFitting = InferSelectModel<typeof schema.doctrinesDoctrineFittings>

// --- Request Payloads ---
export type CreateDoctrineRequest = InferInsertModel<typeof schema.doctrinesDoctrines>
export type UpdateDoctrineRequest = Partial<CreateDoctrineRequest>

export type CreateFittingRequest = InferInsertModel<typeof schema.doctrinesFittings> & {
	fittingItems: Array<Omit<InferInsertModel<typeof schema.doctrinesFittingItems>, 'fittingId'>>
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
export interface Doctrines extends DurableObject {
	// Doctrine Management
	createDoctrine(data: CreateDoctrineRequest, userId: string): Promise<Doctrine>
	getDoctrines(filters: ListDoctrinesFilters, userId: string, isAdmin: boolean): Promise<Doctrine[]>
	getDoctrine(id: string, userId: string, isAdmin: boolean): Promise<DoctrineWithFittings | null>
	updateDoctrine(id: string, data: UpdateDoctrineRequest, userId: string, isAdmin: boolean): Promise<Doctrine>
	deleteDoctrine(id: string, userId: string, isAdmin: boolean): Promise<void>

	// Fitting Management
	createFitting(data: CreateFittingRequest, userId: string): Promise<Fitting>
	getFittings(filters: ListFittingsFilters, userId: string, isAdmin: boolean): Promise<Fitting[]>
	getFitting(id: string, userId: string, isAdmin: boolean): Promise<FittingWithItems | null>
	updateFitting(id: string, data: UpdateFittingRequest, userId: string, isAdmin: boolean): Promise<Fitting>
	deleteFitting(id: string, userId: string, isAdmin: boolean): Promise<void>

	// Doctrine-Fitting Relationship
	addFittingToDoctrine(doctrineId: string, fittingId: string, userId: string, isAdmin: boolean): Promise<void>
	removeFittingFromDoctrine(doctrineId: string, fittingId: string, userId: string, isAdmin: boolean): Promise<void>
}