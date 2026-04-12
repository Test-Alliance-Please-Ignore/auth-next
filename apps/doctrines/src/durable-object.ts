import { DurableObject } from 'cloudflare:workers'
import { and, asc, eq, ilike, like, or } from 'drizzle-orm'

import { getStub } from '@repo/do-utils'
import { EftParser } from '@repo/eve-parsers'

import { createDb } from './db'
import * as schema from './db/schema'

import type {
	AddFittingToDoctrineRequest,
	CreateCategoryRequest,
	CreateDoctrineRequest,
	CreateFittingRequest,
	CreateStagingSystemRequest,
	Doctrine,
	DoctrineCategory,
	Doctrines,
	DoctrineWithFittings,
	Fitting,
	FittingWithDoctrines,
	FittingWithItems,
	ListDoctrinesFilters,
	ListFittingsFilters,
	ParsedFittingPreview,
	SetDoctrineStagingRequest,
	StagingSystem,
	UpdateCategoryRequest,
	UpdateDoctrineRequest,
	UpdateDoctrineFittingRequest,
	UpdateFittingRequest,
	UpdateStagingSystemRequest,
} from '@repo/doctrines'
import type { Universe } from '@repo/universe'
import type { Env } from './context'

/**
 * Doctrines Durable Object
 *
 * Permission checks are handled at the Core route level.
 * This DO only handles data operations.
 */
export class DoctrinesDO extends DurableObject<Env> implements Doctrines {
	private db: ReturnType<typeof createDb>
	private eftParser: EftParser

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
		this.eftParser = new EftParser(env.UNIVERSE)
	}

	// ============================================
	// CATEGORY MANAGEMENT
	// ============================================

	async createCategory(data: CreateCategoryRequest): Promise<DoctrineCategory> {
		const [newCategory] = await this.db
			.insert(schema.doctrinesCategories)
			.values({
				name: data.name,
				sortOrder: data.sortOrder ?? 0,
			})
			.returning()

		if (!newCategory) {
			throw new Error('Failed to create category')
		}

		return newCategory
	}

	async getCategories(): Promise<DoctrineCategory[]> {
		return await this.db.query.doctrinesCategories.findMany({
			orderBy: [asc(schema.doctrinesCategories.sortOrder), asc(schema.doctrinesCategories.name)],
		})
	}

	async updateCategory(id: string, data: UpdateCategoryRequest): Promise<DoctrineCategory> {
		const updates: Partial<typeof schema.doctrinesCategories.$inferInsert> = {}
		if (data.name !== undefined) updates.name = data.name
		if (data.sortOrder !== undefined) updates.sortOrder = data.sortOrder

		const [updated] = await this.db
			.update(schema.doctrinesCategories)
			.set(updates)
			.where(eq(schema.doctrinesCategories.id, id))
			.returning()

		if (!updated) {
			throw new Error('Category not found or failed to update')
		}

		return updated
	}

	async deleteCategory(id: string): Promise<void> {
		// Clear categoryId on any doctrines using this category
		await this.db
			.update(schema.doctrinesDoctrines)
			.set({ categoryId: null })
			.where(eq(schema.doctrinesDoctrines.categoryId, id))

		const [deleted] = await this.db
			.delete(schema.doctrinesCategories)
			.where(eq(schema.doctrinesCategories.id, id))
			.returning({ id: schema.doctrinesCategories.id })

		if (!deleted) {
			throw new Error('Category not found or failed to delete')
		}
	}

	// ============================================
	// STAGING SYSTEM MANAGEMENT
	// ============================================

	async createStagingSystem(data: CreateStagingSystemRequest): Promise<StagingSystem> {
		const [newSystem] = await this.db
			.insert(schema.doctrinesStagingSystems)
			.values({
				solarSystemId: data.solarSystemId,
				solarSystemName: data.solarSystemName,
				sortOrder: data.sortOrder ?? 0,
			})
			.returning()

		if (!newSystem) {
			throw new Error('Failed to create staging system')
		}

		return newSystem
	}

	async getStagingSystems(): Promise<StagingSystem[]> {
		return await this.db.query.doctrinesStagingSystems.findMany({
			orderBy: [asc(schema.doctrinesStagingSystems.sortOrder), asc(schema.doctrinesStagingSystems.solarSystemName)],
		})
	}

	async updateStagingSystem(id: string, data: UpdateStagingSystemRequest): Promise<StagingSystem> {
		const updates: Partial<typeof schema.doctrinesStagingSystems.$inferInsert> = {}
		if (data.solarSystemId !== undefined) updates.solarSystemId = data.solarSystemId
		if (data.solarSystemName !== undefined) updates.solarSystemName = data.solarSystemName
		if (data.sortOrder !== undefined) updates.sortOrder = data.sortOrder

		const [updated] = await this.db
			.update(schema.doctrinesStagingSystems)
			.set(updates)
			.where(eq(schema.doctrinesStagingSystems.id, id))
			.returning()

		if (!updated) {
			throw new Error('Staging system not found or failed to update')
		}

		return updated
	}

	async deleteStagingSystem(id: string): Promise<void> {
		const [deleted] = await this.db
			.delete(schema.doctrinesStagingSystems)
			.where(eq(schema.doctrinesStagingSystems.id, id))
			.returning({ id: schema.doctrinesStagingSystems.id })

		if (!deleted) {
			throw new Error('Staging system not found or failed to delete')
		}
	}

	// ============================================
	// DOCTRINE MANAGEMENT
	// ============================================

	async createDoctrine(data: CreateDoctrineRequest & { updatedBy?: string }): Promise<Doctrine> {
		const [newDoctrine] = await this.db
			.insert(schema.doctrinesDoctrines)
			.values({
				name: data.name,
				description: data.description ?? null,
				shipTypeId: data.shipTypeId ?? null,
				categoryId: data.categoryId ?? null,
				sortOrder: data.sortOrder ?? 0,
				updatedBy: data.updatedBy ?? null,
			})
			.returning()

		if (!newDoctrine) {
			throw new Error('Failed to create doctrine')
		}

		return newDoctrine
	}

	async getDoctrines(filters: ListDoctrinesFilters): Promise<Doctrine[]> {
		const conditions = []
		if (filters.search) {
			conditions.push(like(schema.doctrinesDoctrines.name, `%${filters.search}%`))
		}

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined

		const results = await this.db.query.doctrinesDoctrines.findMany({
			where: whereClause,
			with: {
				category: true,
				doctrineStagingSystems: {
					with: { stagingSystem: true },
				},
			},
			orderBy: [asc(schema.doctrinesDoctrines.sortOrder), asc(schema.doctrinesDoctrines.name)],
		})

		return results.map((r) => ({
			...r,
			categoryName: r.category?.name ?? null,
			categorySortOrder: r.category?.sortOrder ?? null,
			category: undefined,
			stagingSystems: (r.doctrineStagingSystems || []).map((ds) => ({
				stagingSystem: ds.stagingSystem,
				note: ds.note,
			})),
			doctrineStagingSystems: undefined,
		})) as Doctrine[]
	}

	async getDoctrine(id: string): Promise<DoctrineWithFittings | null> {
		const doctrine = await this.db.query.doctrinesDoctrines.findFirst({
			where: eq(schema.doctrinesDoctrines.id, id),
			with: {
				category: true,
				doctrineFittings: {
					with: {
						fitting: true,
					},
					orderBy: [
						asc(schema.doctrinesDoctrineFittings.fittingCategory),
						asc(schema.doctrinesDoctrineFittings.sortOrder),
					],
				},
				doctrineStagingSystems: {
					with: {
						stagingSystem: true,
					},
				},
			},
		})

		if (!doctrine) return null

		return {
			...doctrine,
			fittings: doctrine.doctrineFittings.map((df) => ({
				fitting: df.fitting,
				fittingCategory: df.fittingCategory,
				sortOrder: df.sortOrder,
			})),
			stagingSystems: doctrine.doctrineStagingSystems.map((ds) => ({
				stagingSystem: ds.stagingSystem,
				note: ds.note,
			})),
			category: doctrine.category ?? null,
		}
	}

	async updateDoctrine(id: string, data: UpdateDoctrineRequest & { updatedBy?: string }): Promise<Doctrine> {
		const updates: Partial<typeof schema.doctrinesDoctrines.$inferInsert> = {
			updatedAt: new Date(),
		}
		if (data.name !== undefined) updates.name = data.name
		if (data.description !== undefined) updates.description = data.description ?? null
		if (data.shipTypeId !== undefined) updates.shipTypeId = data.shipTypeId ?? null
		if (data.categoryId !== undefined) updates.categoryId = data.categoryId ?? null
		if (data.sortOrder !== undefined) updates.sortOrder = data.sortOrder
		if (data.updatedBy !== undefined) updates.updatedBy = data.updatedBy

		const [updatedDoctrine] = await this.db
			.update(schema.doctrinesDoctrines)
			.set(updates)
			.where(eq(schema.doctrinesDoctrines.id, id))
			.returning()

		if (!updatedDoctrine) {
			throw new Error('Doctrine not found or failed to update')
		}

		return updatedDoctrine
	}

	async deleteDoctrine(id: string): Promise<void> {
		const [deleted] = await this.db
			.delete(schema.doctrinesDoctrines)
			.where(eq(schema.doctrinesDoctrines.id, id))
			.returning({ id: schema.doctrinesDoctrines.id })

		if (!deleted) {
			throw new Error('Doctrine not found or failed to delete')
		}
	}

	// ============================================
	// FITTING MANAGEMENT
	// ============================================

	async createFitting(data: CreateFittingRequest): Promise<Fitting> {
		// Parse the EFT string to get ship details and items
		const parsedFitting = await this.eftParser.parse(data.fitting)

		// Insert the main fitting record
		const [newFitting] = await this.db
			.insert(schema.doctrinesFittings)
			.values({
				name: parsedFitting.fittingName,
				description: data.description ?? null,
				fitting: data.fitting,
				category: data.category,
				srpEligible: data.srpEligible,
				srpValue: data.srpValue,
				shipTypeId: parsedFitting.shipTypeId,
				shipName: parsedFitting.shipName,
			})
			.returning()

		if (!newFitting) {
			throw new Error('Failed to create fitting')
		}

		// Insert the fitting items
		if (parsedFitting.items.length > 0) {
			await this.db.insert(schema.doctrinesFittingItems).values(
				parsedFitting.items.map((item) => ({
					...item,
					fittingId: newFitting.id,
				}))
			)
		}

		return newFitting
	}

	async getFittings(filters: ListFittingsFilters): Promise<Fitting[]> {
		const conditions = []
		if (filters.shipTypeId) {
			conditions.push(eq(schema.doctrinesFittings.shipTypeId, filters.shipTypeId))
		}
		if (filters.category) {
			conditions.push(eq(schema.doctrinesFittings.category, filters.category))
		}
		if (filters.srpEligible !== undefined) {
			conditions.push(eq(schema.doctrinesFittings.srpEligible, filters.srpEligible))
		}
		if (filters.search) {
			conditions.push(
				or(
					ilike(schema.doctrinesFittings.name, `%${filters.search}%`),
					ilike(schema.doctrinesFittings.shipName, `%${filters.search}%`)
				)
			)
		}

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined

		return await this.db.query.doctrinesFittings.findMany({
			where: whereClause,
			orderBy: (tbl, { asc }) => [asc(tbl.name)],
		})
	}

	async getFittingsWithDoctrines(): Promise<FittingWithDoctrines[]> {
		const fittings = await this.db.query.doctrinesFittings.findMany({
			orderBy: (tbl, { desc }) => [desc(tbl.updatedAt)],
			with: {
				doctrineFittings: {
					with: {
						doctrine: true,
					},
				},
			},
		})

		return fittings.map((f) => ({
			id: f.id,
			name: f.name,
			description: f.description,
			shipTypeId: f.shipTypeId,
			shipName: f.shipName,
			fitting: f.fitting,
			category: f.category,
			srpEligible: f.srpEligible,
			srpValue: f.srpValue,
			createdAt: f.createdAt,
			updatedAt: f.updatedAt,
			doctrines: f.doctrineFittings.map((df) => ({
				id: df.doctrine.id,
				name: df.doctrine.name,
			})),
		}))
	}

	async getFitting(id: string): Promise<FittingWithItems | null> {
		const fitting = await this.db.query.doctrinesFittings.findFirst({
			where: eq(schema.doctrinesFittings.id, id),
			with: {
				fittingItems: true,
			},
		})

		return fitting ?? null
	}

	async updateFitting(id: string, data: UpdateFittingRequest): Promise<Fitting> {
		const updates: Partial<typeof schema.doctrinesFittings.$inferInsert> = {
			updatedAt: new Date(),
		}
		if (data.category !== undefined) updates.category = data.category
		if (data.description !== undefined) updates.description = data.description ?? null
		if (data.srpEligible !== undefined) updates.srpEligible = data.srpEligible
		if (data.srpValue !== undefined) updates.srpValue = data.srpValue

		// If fitting string is updated, re-parse and update items
		if (data.fitting) {
			const parsedFitting = await this.eftParser.parse(data.fitting)
			updates.name = parsedFitting.fittingName
			updates.shipTypeId = parsedFitting.shipTypeId
			updates.shipName = parsedFitting.shipName
			updates.fitting = data.fitting

			// Delete old items and insert new ones
			await this.db
				.delete(schema.doctrinesFittingItems)
				.where(eq(schema.doctrinesFittingItems.fittingId, id))
			if (parsedFitting.items.length > 0) {
				await this.db.insert(schema.doctrinesFittingItems).values(
					parsedFitting.items.map((item) => ({
						...item,
						fittingId: id,
					}))
				)
			}
		}

		const [updatedFitting] = await this.db
			.update(schema.doctrinesFittings)
			.set(updates)
			.where(eq(schema.doctrinesFittings.id, id))
			.returning()

		if (!updatedFitting) {
			throw new Error('Fitting not found or failed to update')
		}

		return updatedFitting
	}

	async deleteFitting(id: string): Promise<void> {
		const [deleted] = await this.db
			.delete(schema.doctrinesFittings)
			.where(eq(schema.doctrinesFittings.id, id))
			.returning({ id: schema.doctrinesFittings.id })

		if (!deleted) {
			throw new Error('Fitting not found or failed to delete')
		}
	}

	// ============================================
	// DOCTRINE-FITTING RELATIONSHIP
	// ============================================

	async addFittingToDoctrine(doctrineId: string, data: AddFittingToDoctrineRequest): Promise<void> {
		// Check if the relationship already exists
		const existing = await this.db.query.doctrinesDoctrineFittings.findFirst({
			where: and(
				eq(schema.doctrinesDoctrineFittings.doctrineId, doctrineId),
				eq(schema.doctrinesDoctrineFittings.fittingId, data.fittingId)
			),
		})

		if (existing) {
			return // Relationship already exists
		}

		await this.db.insert(schema.doctrinesDoctrineFittings).values({
			doctrineId,
			fittingId: data.fittingId,
			fittingCategory: data.fittingCategory ?? 'Uncategorized',
			sortOrder: data.sortOrder ?? 0,
		})
	}

	async updateDoctrineFitting(
		doctrineId: string,
		fittingId: string,
		data: UpdateDoctrineFittingRequest
	): Promise<void> {
		const updates: Partial<typeof schema.doctrinesDoctrineFittings.$inferInsert> = {}
		if (data.fittingCategory !== undefined) updates.fittingCategory = data.fittingCategory
		if (data.sortOrder !== undefined) updates.sortOrder = data.sortOrder

		await this.db
			.update(schema.doctrinesDoctrineFittings)
			.set(updates)
			.where(
				and(
					eq(schema.doctrinesDoctrineFittings.doctrineId, doctrineId),
					eq(schema.doctrinesDoctrineFittings.fittingId, fittingId)
				)
			)
	}

	async removeFittingFromDoctrine(doctrineId: string, fittingId: string): Promise<void> {
		await this.db
			.delete(schema.doctrinesDoctrineFittings)
			.where(
				and(
					eq(schema.doctrinesDoctrineFittings.doctrineId, doctrineId),
					eq(schema.doctrinesDoctrineFittings.fittingId, fittingId)
				)
			)
	}

	// ============================================
	// DOCTRINE-STAGING RELATIONSHIP
	// ============================================

	async setDoctrineStagingSystem(doctrineId: string, data: SetDoctrineStagingRequest): Promise<void> {
		await this.db
			.insert(schema.doctrinesDoctrineStagingSystems)
			.values({
				doctrineId,
				stagingSystemId: data.stagingSystemId,
				note: data.note,
			})
			.onConflictDoUpdate({
				target: [schema.doctrinesDoctrineStagingSystems.doctrineId, schema.doctrinesDoctrineStagingSystems.stagingSystemId],
				set: { note: data.note },
			})
	}

	async removeDoctrineStagingSystem(doctrineId: string, stagingSystemId: string): Promise<void> {
		await this.db
			.delete(schema.doctrinesDoctrineStagingSystems)
			.where(
				and(
					eq(schema.doctrinesDoctrineStagingSystems.doctrineId, doctrineId),
					eq(schema.doctrinesDoctrineStagingSystems.stagingSystemId, stagingSystemId)
				)
			)
	}

	// ============================================
	// TYPE SEARCH
	// ============================================

	async searchShipTypes(query: string): Promise<Array<{ typeId: string; typeName: string }>> {
		const universeStub = getStub<Universe>(this.env.UNIVERSE, 'default')
		const results = await universeStub.searchTypes(query, 20)
		return results.map((r) => ({ typeId: r.typeId, typeName: r.typeName }))
	}

	// ============================================
	// EFT PREVIEW
	// ============================================

	async parseEft(eftString: string): Promise<ParsedFittingPreview> {
		const parsed = await this.eftParser.parse(eftString)
		return {
			shipName: parsed.shipName,
			shipTypeId: parsed.shipTypeId,
			fittingName: parsed.fittingName,
			items: parsed.items,
			unresolvedItems: parsed.unresolvedItems,
		}
	}

}
