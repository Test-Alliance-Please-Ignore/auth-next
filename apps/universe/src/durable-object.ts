import { DurableObject } from 'cloudflare:workers'

import { eq, inArray } from '@repo/db-utils'
import { getStub, LRUCache } from '@repo/do-utils'
import {
	EsiGetStructureMarketDataResponseSchema,
	EsiGetStructureResponseSchema,
	UniverseMoonResourceSchema,
	UniverseMoonSchema,
	UniverseMoonWithResourcesSchema,
} from '@repo/universe'

import { createDb } from './db'
import { invFlags, invGroups, invTypes, moonResources, moons } from './db/schema'
import { KillmailService } from './services/killmail.service'

import type { EsiResponse, EveTokenStore } from '@repo/eve-token-store'
import type {
	EsiGetStructureMarketDataResponse,
	EsiGetStructureMarketDataResponseObject,
	EsiGetStructureResponse,
	EveCharacterId,
	EveMoonId,
	EveStructureId,
	InvFlag,
	InvGroup,
	InvType,
	Killmail,
	KillmailDetail,
	Universe,
	UniverseMoon,
	UniverseMoonResource,
	UniverseMoonWithResources,
} from '@repo/universe'
import type { Env } from './context'

/**
 * Universe Durable Object
 *
 * This Durable Object uses SQLite storage and implements:
 * - RPC methods for remote calls
 * - WebSocket hibernation API
 * - Alarm handler for scheduled tasks
 * - SQLite storage via sql.exec()
 */
export class UniverseDO extends DurableObject<Env, {}> implements Universe {
	private db: ReturnType<typeof createDb>
	private invFlagsCache: LRUCache<InvFlag>
	private invGroupsCache: LRUCache<InvGroup>
	private typeIdsCache: LRUCache<InvType> // Cache for type name -> full InvType object
	private typeNamesCache: LRUCache<InvType> // Cache for type ID -> full InvType object
	private killmailService: KillmailService

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
		this.invFlagsCache = new LRUCache<InvFlag>(1000)
		this.invGroupsCache = new LRUCache<InvGroup>(1000)
		this.typeIdsCache = new LRUCache<InvType>(10000) // Cache for type name -> full InvType object
		this.typeNamesCache = new LRUCache<InvType>(10000) // Cache for type ID -> full InvType object
		this.killmailService = new KillmailService(this.db, this.env)
	}

	// ========================================================================
	// PRIVATE HELPERS
	// ========================================================================

	/**
	 * Normalize incoming moon ID values and ensure they are not empty.
	 */
	private normalizeMoonId(moonId: EveMoonId): string {
		const normalized = String(moonId ?? '').trim()
		if (!normalized) {
			throw new Error('moonId is required')
		}
		return normalized
	}

	/**
	 * Convert timestamp fields to ISO strings.
	 */
	private toIsoString(value: Date | string): string {
		if (value instanceof Date) {
			return value.toISOString()
		}
		const parsed = new Date(value)
		return parsed.toISOString()
	}

	/**
	 * Fetch a moon row by its EVE moon ID.
	 */
	private async findMoonRowByMoonId(moonId: string) {
		const [moon] = await this.db.select().from(moons).where(eq(moons.moonId, moonId)).limit(1)

		return moon ?? null
	}

	private async findTypeIdByName(typeName: string) {
		const [type] = await this.db
			.select()
			.from(invTypes)
			.where(eq(invTypes.typeName, typeName))
			.limit(1)

		return type?.typeId ?? null
	}

	// ========================================================================
	// STRUCTURE METHODS
	// ========================================================================

	/**
	 * Get structure information from ESI
	 * Requires authentication via authorized character
	 * @param structureId - The structure ID
	 * @param authorizedCharacterId - Character ID with access to the structure
	 * @returns Structure info or null if not found/no access
	 */
	async getStructureInfo(
		structureId: EveStructureId,
		authorizedCharacterId: EveCharacterId
	): Promise<EsiGetStructureResponse | null> {
		try {
			using tokenStoreStub = getStub<EveTokenStore>(
				this.env.EVE_TOKEN_STORE,
				structureId ? String(structureId) : 'default'
			)
			const response: EsiResponse<EsiGetStructureResponse> = await tokenStoreStub.fetchEsi(
				`/universe/structures/${String(structureId)}`,
				String(authorizedCharacterId)
			)

			// Validate the response using the schema
			const validatedData = EsiGetStructureResponseSchema.parse(response.data)

			return validatedData
		} catch (error) {
			// If the structure doesn't exist, the character doesn't have access, or token is invalid, return null
			console.error(
				`Failed to fetch structure info for structure ${structureId} with character ${authorizedCharacterId}:`,
				error
			)

			// Return null for 404 or 403 errors (structure not found or no access)
			if (error instanceof Error) {
				const errorMessage = error.message.toLowerCase()
				if (errorMessage.includes('404') || errorMessage.includes('403')) {
					return null
				}
			}

			// Re-throw other errors
			throw error
		}
	}

	/**
	 * Get structure market data from ESI
	 * Requires authentication via authorized character
	 * Note: This endpoint is paginated, so we fetch all pages
	 * @param structureId - The structure ID
	 * @param authorizedCharacterId - Character ID with access to the structure
	 * @returns Market orders or null if not found/no access
	 */
	async getStructureMarketData(
		structureId: EveStructureId,
		authorizedCharacterId: EveCharacterId
	): Promise<EsiGetStructureMarketDataResponse | null> {
		try {
			using tokenStoreStub = getStub<EveTokenStore>(
				this.env.EVE_TOKEN_STORE,
				structureId ? String(structureId) : 'default'
			)
			// fetchEsiAllPages expects the element type, not the array type
			const result = await tokenStoreStub.fetchEsiAllPages<EsiGetStructureMarketDataResponseObject>(
				`/markets/structures/${String(structureId)}`,
				String(authorizedCharacterId)
			)

			// Validate the combined data using the schema (array of orders)
			const validatedData = EsiGetStructureMarketDataResponseSchema.parse(result.data)

			return validatedData
		} catch (error) {
			// If the structure doesn't exist, the character doesn't have access, or token is invalid, return null
			console.error(
				`Failed to fetch structure market data for structure ${structureId} with character ${authorizedCharacterId}:`,
				error
			)

			// Return null for 404 or 403 errors (structure not found or no access)
			if (error instanceof Error) {
				const errorMessage = error.message.toLowerCase()
				if (errorMessage.includes('404') || errorMessage.includes('403')) {
					return null
				}
			}

			// Re-throw other errors
			throw error
		}
	}

	// ========================================================================
	// MOON METHODS
	// ========================================================================

	/**
	 * Get moon metadata by moon ID.
	 */
	async getMoonById(moonId: EveMoonId): Promise<UniverseMoon | null> {
		const normalizedMoonId = this.normalizeMoonId(moonId)

		try {
			const moonRow = await this.findMoonRowByMoonId(normalizedMoonId)

			if (!moonRow) {
				return null
			}

			const moon = UniverseMoonSchema.parse({
				id: moonRow.id,
				moonId: moonRow.moonId,
				name: moonRow.name,
				planetId: moonRow.planetId,
				solarSystemId: moonRow.solarSystemId,
				createdAt: this.toIsoString(moonRow.createdAt),
				updatedAt: this.toIsoString(moonRow.updatedAt),
			})

			return moon
		} catch (error) {
			console.error(`Failed to get moon ${normalizedMoonId}`, error)
			throw error
		}
	}

	/**
	 * Get moon metadata and resource composition by moon ID.
	 */
	async getMoonWithResourcesById(moonId: EveMoonId): Promise<UniverseMoonWithResources | null> {
		const normalizedMoonId = this.normalizeMoonId(moonId)

		try {
			const moonRow = await this.findMoonRowByMoonId(normalizedMoonId)

			if (!moonRow) {
				return null
			}

			const moon = UniverseMoonSchema.parse({
				id: moonRow.id,
				moonId: moonRow.moonId,
				name: moonRow.name,
				planetId: moonRow.planetId,
				solarSystemId: moonRow.solarSystemId,
				createdAt: this.toIsoString(moonRow.createdAt),
				updatedAt: this.toIsoString(moonRow.updatedAt),
			})

			const resourceRows = await this.db
				.select({
					id: moonResources.id,
					productName: moonResources.productName,
					quantity: moonResources.quantity,
					oreTypeId: moonResources.oreTypeId,
					createdAt: moonResources.createdAt,
					updatedAt: moonResources.updatedAt,
				})
				.from(moonResources)
				.where(eq(moonResources.moonId, moonRow.id))

			const resources: UniverseMoonResource[] = UniverseMoonResourceSchema.array().parse(
				resourceRows.map((resource) => ({
					id: resource.id,
					moonId: moon.moonId,
					productName: resource.productName,
					quantity: resource.quantity,
					oreTypeId: resource.oreTypeId,
					createdAt: this.toIsoString(resource.createdAt),
					updatedAt: this.toIsoString(resource.updatedAt),
				}))
			)

			return UniverseMoonWithResourcesSchema.parse({
				...moon,
				resources,
			})
		} catch (error) {
			console.error(`Failed to get moon with resources ${normalizedMoonId}`, error)
			throw error
		}
	}

	// ========================================================================
	// INVENTORY RESOLUTION METHODS
	// ========================================================================

	/**
	 * Resolve multiple inventory flags by their IDs
	 * Uses in-memory LRU cache to reduce database load
	 * @param flagIds - Array of flag IDs to resolve
	 * @returns Record mapping flag IDs to their data (null if not found)
	 */
	async resolveInvFlags(flagIds: string[]): Promise<Record<string, InvFlag | null>> {
		try {
			const result: Record<string, InvFlag | null> = {}
			const cacheMisses: string[] = []

			// Check cache for each ID
			for (const flagId of flagIds) {
				const cached = this.invFlagsCache.get(flagId)
				if (cached !== undefined) {
					result[flagId] = cached
				} else {
					cacheMisses.push(flagId)
				}
			}

			// Fetch cache misses from database
			if (cacheMisses.length > 0) {
				const flags = await this.db
					.select()
					.from(invFlags)
					.where(inArray(invFlags.flagId, cacheMisses))

				// Update cache and result
				for (const flag of flags) {
					const invFlag: InvFlag = {
						flagId: flag.flagId,
						flagName: flag.flagName,
						flagText: flag.flagText,
						orderId: flag.orderId,
					}
					this.invFlagsCache.set(flag.flagId, invFlag)
					result[flag.flagId] = invFlag
				}

				// Mark not found items as null
				for (const missedId of cacheMisses) {
					if (!(missedId in result)) {
						result[missedId] = null
					}
				}
			}

			return result
		} catch (error) {
			console.error('Failed to resolve invFlags', error)
			throw error
		}
	}

	/**
	 * Resolve multiple inventory groups by their IDs
	 * Uses in-memory LRU cache to reduce database load
	 * @param groupIds - Array of group IDs to resolve
	 * @returns Record mapping group IDs to their data (null if not found)
	 */
	async resolveInvGroups(groupIds: string[]): Promise<Record<string, InvGroup | null>> {
		try {
			const result: Record<string, InvGroup | null> = {}
			const cacheMisses: string[] = []

			// Check cache for each ID
			for (const groupId of groupIds) {
				const cached = this.invGroupsCache.get(groupId)
				if (cached !== undefined) {
					result[groupId] = cached
				} else {
					cacheMisses.push(groupId)
				}
			}

			// Fetch cache misses from database
			if (cacheMisses.length > 0) {
				const groups = await this.db
					.select()
					.from(invGroups)
					.where(inArray(invGroups.groupId, cacheMisses))

				// Update cache and result
				for (const group of groups) {
					const invGroup: InvGroup = {
						groupId: group.groupId,
						categoryId: group.categoryId,
						groupName: group.groupName,
						iconId: group.iconId,
						useBasePrice: group.useBasePrice,
						anchored: group.anchored,
						anchorable: group.anchorable,
						fittableNonSingleton: group.fittableNonSingleton,
						published: group.published,
					}
					this.invGroupsCache.set(group.groupId, invGroup)
					result[group.groupId] = invGroup
				}

				// Mark not found items as null
				for (const missedId of cacheMisses) {
					if (!(missedId in result)) {
						result[missedId] = null
					}
				}
			}

			return result
		} catch (error) {
			console.error('Failed to resolve invGroups', error)
			throw error
		}
	}

	/**
	 * Resolve multiple type details by their names
	 * Uses in-memory LRU cache to reduce database load
	 * Note: typeIds are the same as itemIds in EVE Online
	 * @param typeNames - Array of type names to resolve
	 * @returns Record mapping type names to their full type data (null if not found)
	 */
	async resolveTypeIdsByNames(typeNames: string[]): Promise<Record<string, InvType | null>> {
		try {
			const result: Record<string, InvType | null> = {}
			const cacheMisses: string[] = []

			// Check cache for each name
			for (const typeName of typeNames) {
				const cached = this.typeIdsCache.get(typeName)
				if (cached !== undefined) {
					result[typeName] = cached
				} else {
					cacheMisses.push(typeName)
				}
			}

			// Fetch cache misses from database
			if (cacheMisses.length > 0) {
				const types = await this.db
					.select()
					.from(invTypes)
					.where(inArray(invTypes.typeName, cacheMisses))

				// Update cache and result
				for (const type of types) {
					const invType: InvType = { ...type }
					this.typeIdsCache.set(type.typeName, invType)
					this.typeNamesCache.set(type.typeId, invType) // Also cache reverse mapping
					result[type.typeName] = invType
				}

				// Mark not found items as null
				for (const missedName of cacheMisses) {
					if (!(missedName in result)) {
						result[missedName] = null
					}
				}
			}

			return result
		} catch (error) {
			console.error('Failed to resolve type details', error)
			throw error
		}
	}

	/**
	 * Resolve multiple type details by their IDs
	 * Uses in-memory LRU cache to reduce database load
	 * @param typeIds - Array of type IDs to resolve
	 * @returns Record mapping type IDs to their full type data (null if not found)
	 */
	async resolveTypeNamesByIds(typeIds: string[]): Promise<Record<string, InvType | null>> {
		try {
			const result: Record<string, InvType | null> = {}
			const cacheMisses: string[] = []

			// Check cache for each ID
			for (const typeId of typeIds) {
				const cached = this.typeNamesCache.get(typeId)
				if (cached !== undefined) {
					result[typeId] = cached
				} else {
					cacheMisses.push(typeId)
				}
			}

			// Fetch cache misses from database
			if (cacheMisses.length > 0) {
				const types = await this.db
					.select()
					.from(invTypes)
					.where(inArray(invTypes.typeId, cacheMisses))

				// Update cache and result
				for (const type of types) {
					const invType: InvType = { ...type }
					this.typeNamesCache.set(type.typeId, invType)
					this.typeIdsCache.set(type.typeName, invType) // Also cache reverse mapping
					result[type.typeId] = invType
				}

				// Mark not found items as null
				for (const missedId of cacheMisses) {
					if (!(missedId in result)) {
						result[missedId] = null
					}
				}
			}

			return result
		} catch (error) {
			console.error('Failed to resolve type details', error)
			throw error
		}
	}

	// ========================================================================
	// WEBSOCKET HANDLERS
	// ========================================================================

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

	// ========================================================================
	// KILLMAIL METHODS
	// ========================================================================

	/**
	 * Store killmail data, resolving all entity names
	 */
	async storeKillmail(
		killmailId: string,
		killmailHash: string,
		killmailData: KillmailDetail
	): Promise<Killmail> {
		return this.killmailService.storeKillmail(killmailId, killmailHash, killmailData)
	}

	/**
	 * Fetch killmail by ID and hash
	 */
	async fetchKillmailByIdAndHash(killmailId: string, killmailHash: string): Promise<Killmail | null> {
		return this.killmailService.fetchKillmailByIdAndHash(killmailId, killmailHash)
	}

	/**
	 * Get killmails by character ID
	 */
	async getKillmailsByCharacter(
		characterId: string,
		filters?: { startTime?: Date; endTime?: Date; lossesOnly?: boolean }
	): Promise<Killmail[]> {
		return this.killmailService.getKillmailsByCharacter(characterId, filters)
	}

	/**
	 * Get killmails by corporation ID
	 */
	async getKillmailsByCorporation(
		corporationId: string,
		filters?: { startTime?: Date; endTime?: Date; lossesOnly?: boolean }
	): Promise<Killmail[]> {
		return this.killmailService.getKillmailsByCorporation(corporationId, filters)
	}

	/**
	 * Get killmails by solar system ID
	 */
	async getKillmailsBySystem(
		solarSystemId: string,
		filters?: { startTime?: Date; endTime?: Date }
	): Promise<Killmail[]> {
		return this.killmailService.getKillmailsBySystem(solarSystemId, filters)
	}

	/**
	 * Get killmails by time range
	 */
	async getKillmailsByTimeRange(startTime: Date, endTime: Date): Promise<Killmail[]> {
		return this.killmailService.getKillmailsByTimeRange(startTime, endTime)
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

		return new Response('Universe Durable Object', { status: 200 })
	}
}
