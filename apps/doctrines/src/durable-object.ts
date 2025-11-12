import { DurableObject } from 'cloudflare:workers'
import { and, eq, like, sql } from 'drizzle-orm'

import { getStub } from '@repo/do-utils'
import { EftParser } from '@repo/eve-parsers'

import { createDb } from './db'
import * as schema from './db/schema'

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
import type { Groups } from '@repo/groups'
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
export class DoctrinesDO extends DurableObject<Env> implements Doctrines {
	private db: ReturnType<typeof createDb>
	private eftParser: EftParser<Env>

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		console.log('[DoctrinesDO] Constructor called, initializing...')
		this.db = createDb(env.DATABASE_URL)
		this.eftParser = new EftParser(env)
		console.log('[DoctrinesDO] Initialized successfully')
	}

	/**
	 * Helper to check user permissions using the Groups Durable Object.
	 * Checks both user-level (group) permissions and corporation-level (character) permissions.
	 * @param userId The ID of the user to check permissions for.
	 * @param characterIds The character IDs associated with the user.
	 * @param permissionUrn The URN of the permission to check.
	 * @returns True if the user has the permission, false otherwise.
	 */
	private async checkPermission(
		userId: string,
		characterIds: string[],
		permissionUrn: string
	): Promise<boolean> {
		const startTime = Date.now()
		console.log('[DoctrinesDO.checkPermission] START - Checking permission', {
			userId,
			characterIds,
			characterCount: characterIds?.length || 0,
			permissionUrn,
			timestamp: new Date().toISOString(),
		})

		try {
			// Validate inputs
			if (!userId) {
				console.error('[DoctrinesDO.checkPermission] ERROR - Invalid userId', { userId })
				return false
			}

			if (!permissionUrn) {
				console.error('[DoctrinesDO.checkPermission] ERROR - Invalid permissionUrn', {
					permissionUrn,
				})
				return false
			}

			if (!Array.isArray(characterIds)) {
				console.error('[DoctrinesDO.checkPermission] ERROR - characterIds is not an array', {
					characterIds,
					type: typeof characterIds,
				})
				return false
			}

			// Check if GROUPS binding exists
			if (!this.env.GROUPS) {
				console.error('[DoctrinesDO.checkPermission] ERROR - GROUPS binding is undefined', {
					env: Object.keys(this.env),
				})
				throw new Error('GROUPS Durable Object binding is not configured')
			}

			console.log('[DoctrinesDO.checkPermission] Creating Groups stub', {
				binding: 'GROUPS',
				id: 'default',
			})

			using groupsStub = getStub<Groups>(this.env.GROUPS, 'default')

			if (!groupsStub) {
				console.error('[DoctrinesDO.checkPermission] ERROR - Failed to create Groups stub')
				throw new Error('Failed to create Groups Durable Object stub')
			}

			// Check user-level (group) permissions
			console.log('[DoctrinesDO.checkPermission] Fetching user permissions', { userId })
			let userPermissions
			try {
				userPermissions = await groupsStub.getUserPermissions(userId)
			} catch (error) {
				console.error('[DoctrinesDO.checkPermission] ERROR - Failed to get user permissions', {
					userId,
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				})
				throw new Error(`Failed to fetch user permissions: ${error}`)
			}

			console.log('[DoctrinesDO.checkPermission] User permissions retrieved', {
				userId,
				permissionCount: userPermissions?.length || 0,
				permissions: userPermissions?.map((p) => p.urn) || [],
			})

			if (userPermissions?.some((permission) => permission.urn === permissionUrn)) {
				const elapsed = Date.now() - startTime
				console.log(
					'[DoctrinesDO.checkPermission] SUCCESS - Permission granted via user-level permissions',
					{
						userId,
						permissionUrn,
						elapsed: `${elapsed}ms`,
					}
				)
				return true
			}

			// Check corporation-level (character) permissions
			console.log('[DoctrinesDO.checkPermission] Checking corporation-level permissions', {
				characterCount: characterIds.length,
			})

			for (let i = 0; i < characterIds.length; i++) {
				const characterId = characterIds[i]
				console.log('[DoctrinesDO.checkPermission] Fetching character permissions', {
					characterId,
					index: i + 1,
					total: characterIds.length,
				})

				let characterPermissions
				try {
					// Create fresh stub for each character to avoid stub invalidation
					using charStub = getStub<Groups>(this.env.GROUPS, 'default')
					characterPermissions = await charStub.getCharacterPermissions(characterId)
				} catch (error) {
					console.error(
						'[DoctrinesDO.checkPermission] ERROR - Failed to get character permissions',
						{
							characterId,
							index: i + 1,
							error: error instanceof Error ? error.message : String(error),
							stack: error instanceof Error ? error.stack : undefined,
						}
					)
					// Continue checking other characters instead of failing completely
					continue
				}

				console.log('[DoctrinesDO.checkPermission] Character permissions retrieved', {
					characterId,
					permissionCount: characterPermissions?.length || 0,
					permissions: characterPermissions?.map((p) => p.urn) || [],
				})

				if (characterPermissions?.some((permission) => permission.urn === permissionUrn)) {
					const elapsed = Date.now() - startTime
					console.log(
						'[DoctrinesDO.checkPermission] SUCCESS - Permission granted via corporation-level permissions',
						{
							characterId,
							permissionUrn,
							elapsed: `${elapsed}ms`,
						}
					)
					return true
				}
			}

			const elapsed = Date.now() - startTime
			console.log('[DoctrinesDO.checkPermission] DENIED - Permission not found', {
				userId,
				characterIds,
				permissionUrn,
				elapsed: `${elapsed}ms`,
			})

			return false
		} catch (error) {
			const elapsed = Date.now() - startTime
			console.error('[DoctrinesDO.checkPermission] FATAL ERROR - Permission check failed', {
				userId,
				characterIds,
				permissionUrn,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				elapsed: `${elapsed}ms`,
			})
			// Return false on error to fail-secure
			return false
		}
	}

	// ============================================
	// DOCTRINE MANAGEMENT
	// ============================================

	async createDoctrine(
		data: CreateDoctrineRequest,
		userId: string,
		characterIds: string[]
	): Promise<Doctrine> {
		// Permission check: User must have permission to create doctrines
		const hasPermission = await this.checkPermission(userId, characterIds, 'urn:doctrines:create')
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
		characterIds: string[],
		isAdmin: boolean
	): Promise<Doctrine[]> {
		console.log('[DoctrinesDO] getDoctrines called', { userId, characterIds, isAdmin, filters })
		// Permission check: User must have permission to view doctrines
		// const hasPermission = await this.checkPermission(userId, characterIds, 'urn:doctrines:view')
		// if (!hasPermission && !isAdmin) {
		// 	throw new Error('Unauthorized to view doctrines')
		// }

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
		characterIds: string[],
		isAdmin: boolean
	): Promise<DoctrineWithFittings | null> {
		// Permission check: User must have permission to view doctrines
		const hasPermission = await this.checkPermission(userId, characterIds, 'urn:doctrines:view')
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
		characterIds: string[],
		isAdmin: boolean
	): Promise<Doctrine> {
		// Permission check: User must have permission to edit doctrines or be an admin
		const hasPermission = await this.checkPermission(userId, characterIds, 'urn:doctrines:edit')
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

	async deleteDoctrine(
		id: string,
		userId: string,
		characterIds: string[],
		isAdmin: boolean
	): Promise<void> {
		// Permission check: User must have permission to delete doctrines or be an admin
		const hasPermission = await this.checkPermission(userId, characterIds, 'urn:doctrines:delete')
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

	async createFitting(
		data: CreateFittingRequest,
		userId: string,
		characterIds: string[]
	): Promise<Fitting> {
		// Permission check: User must have permission to create fittings
		const hasPermission = await this.checkPermission(
			userId,
			characterIds,
			'urn:doctrines:create_fitting'
		)
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
				}))
			)
		}

		return newFitting
	}

	async getFittings(
		filters: ListFittingsFilters,
		userId: string,
		characterIds: string[],
		isAdmin: boolean
	): Promise<Fitting[]> {
		console.log('[DoctrinesDO.getFittings] Fetching fittings', {
			userId,
			characterIds,
			isAdmin,
			filters,
		})

		// Permission check: User must have permission to view fittings
		// const hasPermission = await this.checkPermission(
		// 	userId,
		// 	characterIds,
		// 	'urn:doctrines:view_fitting'
		// )
		console.log('[DoctrinesDO.getFittings] Permission check result', {
			userId,
			characterIds,
			isAdmin,
			// hasPermission,
		})

		// if (!hasPermission && !isAdmin) {
		// 	console.log('[DoctrinesDO.getFittings] Access denied - insufficient permissions', {
		// 		userId,
		// 		characterIds,
		// 		isAdmin,
		// 	})
		// 	throw new Error('Unauthorized to view fittings')
		// }

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
		characterIds: string[],
		isAdmin: boolean
	): Promise<FittingWithItems | null> {
		console.log('[DoctrinesDO.getFitting] Fetching fitting', {
			fittingId: id,
			userId,
			characterIds,
			isAdmin,
		})

		// Permission check: User must have permission to view fittings
		const hasPermission = await this.checkPermission(
			userId,
			characterIds,
			'urn:doctrines:view_fitting'
		)
		console.log('[DoctrinesDO.getFitting] Permission check result', {
			fittingId: id,
			userId,
			characterIds,
			isAdmin,
			hasPermission,
		})

		if (!hasPermission && !isAdmin) {
			console.log('[DoctrinesDO.getFitting] Access denied - insufficient permissions', {
				fittingId: id,
				userId,
				characterIds,
				isAdmin,
			})
			throw new Error('Unauthorized to view fittings')
		}

		const fitting = await this.db.query.doctrinesFittings.findFirst({
			where: eq(schema.doctrinesFittings.id, id),
			with: {
				fittingItems: true,
			},
		})

		if (!fitting) {
			console.log('[DoctrinesDO.getFitting] Fitting not found', { fittingId: id, userId })
			return null
		}

		console.log('[DoctrinesDO.getFitting] Fitting found', {
			fittingId: id,
			shipName: fitting.shipName,
			userId,
		})

		return fitting
	}

	async updateFitting(
		id: string,
		data: UpdateFittingRequest,
		userId: string,
		characterIds: string[],
		isAdmin: boolean
	): Promise<Fitting> {
		// Permission check: User must have permission to edit fittings or be an admin
		const hasPermission = await this.checkPermission(
			userId,
			characterIds,
			'urn:doctrines:edit_fitting'
		)
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

	async deleteFitting(
		id: string,
		userId: string,
		characterIds: string[],
		isAdmin: boolean
	): Promise<void> {
		// Permission check: User must have permission to delete fittings or be an admin
		const hasPermission = await this.checkPermission(
			userId,
			characterIds,
			'urn:doctrines:delete_fitting'
		)
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
		characterIds: string[],
		isAdmin: boolean
	): Promise<void> {
		// Permission check: User must have permission to edit doctrines or be an admin
		const hasPermission = await this.checkPermission(userId, characterIds, 'urn:doctrines:edit')
		if (!hasPermission && !isAdmin) {
			throw new Error('Unauthorized to add fitting to doctrine')
		}

		// Check if the relationship already exists
		const existing = await this.db.query.doctrinesDoctrineFittings.findFirst({
			where: and(
				eq(schema.doctrinesDoctrineFittings.doctrineId, doctrineId),
				eq(schema.doctrinesDoctrineFittings.fittingId, fittingId)
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
		characterIds: string[],
		isAdmin: boolean
	): Promise<void> {
		// Permission check: User must have permission to edit doctrines or be an admin
		const hasPermission = await this.checkPermission(userId, characterIds, 'urn:doctrines:edit')
		if (!hasPermission && !isAdmin) {
			throw new Error('Unauthorized to remove fitting from doctrine')
		}

		await this.db
			.delete(schema.doctrinesDoctrineFittings)
			.where(
				and(
					eq(schema.doctrinesDoctrineFittings.doctrineId, doctrineId),
					eq(schema.doctrinesDoctrineFittings.fittingId, fittingId)
				)
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
	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
		wasClean: boolean
	): Promise<void> {
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
