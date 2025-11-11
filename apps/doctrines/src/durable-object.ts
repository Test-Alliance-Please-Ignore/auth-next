import { DurableObject } from 'cloudflare:workers'
import { and, eq, like, sql } from 'drizzle-orm'

import { getStub } from '@repo/do-utils'
import type {
	CreateDoctrineRequest,
	CreateFittingRequest,
	Doctrine,
	Doctrines,
	DoctrineWithFittings,
	Fitting,
	FittingWithItems,
	ListDoctrinesFilters,
	ListFittingsFilters,
	UpdateDoctrineRequest,
	UpdateFittingRequest,
} from '@repo/doctrines'
import { EftParser } from '@repo/eve-parsers'
import type { Groups } from '@repo/groups'
import { createDb } from './db'
import * as schema from './db/schema'
import type { Env } from './context'

/**
 * Doctrines Durable Object
 *
 * This Durable Object uses SQLite storage and implements:
 * - RPC methods for remote calls
 * - WebSocket hibernation API
 * - Alarm handler for scheduled tasks
 * - SQLite storage via sql.exec()
 */
export class DoctrinesDO extends DurableObject<Env, {}> implements Doctrines {
	private db: ReturnType<typeof createDb>
	private eftParser: EftParser

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
		this.eftParser = new EftParser()
	}

	/**
	 * Helper to check user permissions using the Groups Durable Object.
	 * @param userId The ID of the user to check permissions for.
	 * @param permissionUrn The URN of the permission to check.
	 * @param resourceId Optional: The ID of the resource (e.g., group ID) for scoped permissions.
	 * @returns True if the user has the permission, false otherwise.
	 */
	private async checkPermission(
		userId: string,
		permissionUrn: string,
		resourceId?: string,
	): Promise<boolean> {
		// The Groups DO is typically per-user, so we use the userId as the DO ID.
		using groupsStub = getStub<Groups>(this.env.GROUPS, userId)
		return groupsStub.hasPermission(userId, permissionUrn, resourceId)
	}

	// ============================================
	// DOCTRINE MANAGEMENT
	// ============================================

	async createDoctrine(data: CreateDoctrineRequest, userId: string): Promise<Doctrine> {
		// Permission check: User must have permission to create doctrines
		const hasPermission = await this.checkPermission(userId, 'urn:doctrines:create')
		if (!hasPermission) {
			throw new Error('Unauthorized to create doctrines')
		}

		const [newDoctrine] = await this.db
			.insert(schema.doctrinesDoctrines)
			.values({
				...data,
				maintainer: data.maintainer || userId, // Default maintainer to creator if not provided
			})
			.returning()

		if (!newDoctrine) {
			throw new Error('Failed to create doctrine')
		}

		return newDoctrine
	}

	async getDoctrines(
		filters: ListDoctrinesFilters,
		userId: string,
		isAdmin: boolean,
	): Promise<Doctrine[]> {
		// Permission check: User must have permission to view doctrines
		const hasPermission = await this.checkPermission(userId, 'urn:doctrines:view')
		if (!hasPermission && !isAdmin) {
			throw new Error('Unauthorized to view doctrines')
		}

		const conditions = []
		if (filters.category) {
			conditions.push(eq(schema.doctrinesDoctrines.category, filters.category))
		}
		if (filters.maintainer) {
			conditions.push(eq(schema.doctrinesDoctrines.maintainer, filters.maintainer))
		}
		if (filters.search) {
			conditions.push(like(schema.doctrinesDoctrines.name, `%${filters.search}%`))
		}

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined

		const doctrines = await this.db.query.doctrinesDoctrines.findMany({
			where: whereClause,
			orderBy: (tbl, { asc }) => [asc(tbl.name)],
		})

		return doctrines
	}

	async getDoctrine(
		id: string,
		userId: string,
		isAdmin: boolean,
	): Promise<DoctrineWithFittings | null> {
		// Permission check: User must have permission to view doctrines
		const hasPermission = await this.checkPermission(userId, 'urn:doctrines:view')
		if (!hasPermission && !isAdmin) {
			throw new Error('Unauthorized to view doctrines')
		}

		const doctrine = await this.db.query.doctrinesDoctrines.findFirst({
			where: eq(schema.doctrinesDoctrines.id, id),
			with: {
				doctrineFittings: {
					with: {
						fitting: true,
					},
				},
			},
		})

		if (!doctrine) return null

		return {
			...doctrine,
			fittings: doctrine.doctrineFittings.map((df) => df.fitting),
		}
	}

	async updateDoctrine(
		id: string,
		data: UpdateDoctrineRequest,
		userId: string,
		isAdmin: boolean,
	): Promise<Doctrine> {
		// Permission check: User must have permission to edit doctrines or be an admin
		const hasPermission = await this.checkPermission(userId, 'urn:doctrines:edit')
		if (!hasPermission && !isAdmin) {
			throw new Error('Unauthorized to update doctrines')
		}

		const updates: Partial<typeof schema.doctrinesDoctrines.$inferInsert> = {
			updatedAt: new Date(),
		}
		if (data.name !== undefined) updates.name = data.name
		if (data.category !== undefined) updates.category = data.category
		if (data.maintainer !== undefined) updates.maintainer = data.maintainer

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

	async deleteDoctrine(id: string, userId: string, isAdmin: boolean): Promise<void> {
		// Permission check: User must have permission to delete doctrines or be an admin
		const hasPermission = await this.checkPermission(userId, 'urn:doctrines:delete')
		if (!hasPermission && !isAdmin) {
			throw new Error('Unauthorized to delete doctrines')
		}

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

	async createFitting(data: CreateFittingRequest, userId: string): Promise<Fitting> {
		// Permission check: User must have permission to create fittings
		const hasPermission = await this.checkPermission(userId, 'urn:doctrines:create_fitting')
		if (!hasPermission) {
			throw new Error('Unauthorized to create fittings')
		}

		// Parse the EFT string to get ship details and items
		const parsedFitting = await this.eftParser.parse(data.fitting)

		// Insert the main fitting record
		const [newFitting] = await this.db
			.insert(schema.doctrinesFittings)
			.values({
				...data,
				shipTypeId: parsedFitting.shipTypeId,
				shipName: parsedFitting.shipName,
				maintainer: data.maintainer || userId, // Default maintainer to creator if not provided
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
				})),
			)
		}

		return newFitting
	}

	async getFittings(
		filters: ListFittingsFilters,
		userId: string,
		isAdmin: boolean,
	): Promise<Fitting[]> {
		// Permission check: User must have permission to view fittings
		const hasPermission = await this.checkPermission(userId, 'urn:doctrines:view_fitting')
		if (!hasPermission && !isAdmin) {
			throw new Error('Unauthorized to view fittings')
		}

		const conditions = []
		if (filters.shipTypeId) {
			conditions.push(eq(schema.doctrinesFittings.shipTypeId, filters.shipTypeId))
		}
		if (filters.category) {
			conditions.push(eq(schema.doctrinesFittings.category, filters.category))
		}
		if (filters.maintainer) {
			conditions.push(eq(schema.doctrinesFittings.maintainer, filters.maintainer))
		}
		if (filters.srpEligible !== undefined) {
			conditions.push(eq(schema.doctrinesFittings.srpEligible, filters.srpEligible))
		}
		if (filters.search) {
			conditions.push(like(schema.doctrinesFittings.shipName, `%${filters.search}%`))
		}

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined

		const fittings = await this.db.query.doctrinesFittings.findMany({
			where: whereClause,
			orderBy: (tbl, { asc }) => [asc(tbl.shipName)],
		})

		return fittings
	}

	async getFitting(
		id: string,
		userId: string,
		isAdmin: boolean,
	): Promise<FittingWithItems | null> {
		// Permission check: User must have permission to view fittings
		const hasPermission = await this.checkPermission(userId, 'urn:doctrines:view_fitting')
		if (!hasPermission && !isAdmin) {
			throw new Error('Unauthorized to view fittings')
		}

		const fitting = await this.db.query.doctrinesFittings.findFirst({
			where: eq(schema.doctrinesFittings.id, id),
			with: {
				fittingItems: true,
			},
		})

		if (!fitting) return null

		return fitting
	}

	async updateFitting(
		id: string,
		data: UpdateFittingRequest,
		userId: string,
		isAdmin: boolean,
	): Promise<Fitting> {
		// Permission check: User must have permission to edit fittings or be an admin
		const hasPermission = await this.checkPermission(userId, 'urn:doctrines:edit_fitting')
		if (!hasPermission && !isAdmin) {
			throw new Error('Unauthorized to update fittings')
		}

		const updates: Partial<typeof schema.doctrinesFittings.$inferInsert> = {
			updatedAt: new Date(),
		}
		if (data.category !== undefined) updates.category = data.category
		if (data.maintainer !== undefined) updates.maintainer = data.maintainer
		if (data.srpEligible !== undefined) updates.srpEligible = data.srpEligible
		if (data.srpValue !== undefined) updates.srpValue = data.srpValue

		// If fitting string is updated, re-parse and update items
		if (data.fitting) {
			const parsedFitting = await this.eftParser.parse(data.fitting)
			updates.shipTypeId = parsedFitting.shipTypeId
			updates.shipName = parsedFitting.shipName
			updates.fitting = data.fitting

			// Delete old items and insert new ones
			await this.db.delete(schema.doctrinesFittingItems).where(eq(schema.doctrinesFittingItems.fittingId, id))
			if (parsedFitting.items.length > 0) {
				await this.db.insert(schema.doctrinesFittingItems).values(
					parsedFitting.items.map((item) => ({
						...item,
						fittingId: id,
					})),
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

	async deleteFitting(id: string, userId: string, isAdmin: boolean): Promise<void> {
		// Permission check: User must have permission to delete fittings or be an admin
		const hasPermission = await this.checkPermission(userId, 'urn:doctrines:delete_fitting')
		if (!hasPermission && !isAdmin) {
			throw new Error('Unauthorized to delete fittings')
		}

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

	async addFittingToDoctrine(
		doctrineId: string,
		fittingId: string,
		userId: string,
		isAdmin: boolean,
	): Promise<void> {
		// Permission check: User must have permission to edit doctrines or be an admin
		const hasPermission = await this.checkPermission(userId, 'urn:doctrines:edit')
		if (!hasPermission && !isAdmin) {
			throw new Error('Unauthorized to add fitting to doctrine')
		}

		// Check if the relationship already exists
		const existing = await this.db.query.doctrinesDoctrineFittings.findFirst({
			where: and(
				eq(schema.doctrinesDoctrineFittings.doctrineId, doctrineId),
				eq(schema.doctrinesDoctrineFittings.fittingId, fittingId),
			),
		})

		if (existing) {
			return // Relationship already exists, do nothing
		}

		await this.db.insert(schema.doctrinesDoctrineFittings).values({
			doctrineId,
			fittingId,
		})
	}

	async removeFittingFromDoctrine(
		doctrineId: string,
		fittingId: string,
		userId: string,
		isAdmin: boolean,
	): Promise<void> {
		// Permission check: User must have permission to edit doctrines or be an admin
		const hasPermission = await this.checkPermission(userId, 'urn:doctrines:edit')
		if (!hasPermission && !isAdmin) {
			throw new Error('Unauthorized to remove fitting from doctrine')
		}

		await this.db
			.delete(schema.doctrinesDoctrineFittings)
			.where(
				and(
					eq(schema.doctrinesDoctrineFittings.doctrineId, doctrineId),
					eq(schema.doctrinesDoctrineFittings.fittingId, fittingId),
				),
			)
	}

	/**
	 * WebSocket message handler (Hibernation API)
	 * Called when a WebSocket message is received
	 */
	async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
		// TODO: Implement WebSocket message handling
	}

	/**
	 * WebSocket close handler (Hibernation API)
	 * Called when a WebSocket connection is closed
	 */
	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
		// TODO: Implement cleanup logic
	}

	/**
	 * WebSocket error handler (Hibernation API)
	 * Called when a WebSocket error occurs
	 */
	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		console.error('WebSocket error:', error)
	}

	/**
	 * Alarm handler
	 * Called when a scheduled alarm triggers
	 */
	async alarm(): Promise<void> {
		// TODO: Implement alarm logic
	}

	/**
	 * Fetch handler for HTTP requests to the Durable Object
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		// WebSocket upgrade handling
		if (request.headers.get('Upgrade') === 'websocket') {
			const pair = new WebSocketPair()
			const [client, server] = Object.values(pair)

			// Accept the WebSocket connection using hibernation API
			this.ctx.acceptWebSocket(server)

			return new Response(null, {
				status: 101,
				webSocket: client,
			})
		}

		return new Response('Doctrines Durable Object', { status: 200 })
	}
}
