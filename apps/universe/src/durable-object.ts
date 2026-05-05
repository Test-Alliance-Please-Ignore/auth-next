import { DurableObject } from 'cloudflare:workers'

import { alias } from 'drizzle-orm/pg-core'

import { and, eq, ilike, inArray, ne, sql } from '@repo/db-utils'
import { getStub, LRUCache } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'
import {
	EsiGetStructureMarketDataResponseSchema,
	EsiGetStructureResponseSchema,
	UniverseMoonResourceSchema,
	UniverseMoonSchema,
	UniverseMoonWithResourcesSchema,
} from '@repo/universe'

import { createDb } from './db'
import {
	invCategories,
	invFlags,
	invGroups,
	invMarketGroups,
	invTypes,
	moonResources,
	moons,
	universeConstellations,
	universeNpcStations,
	universePlanets,
	universeRegions,
	universeSolarSystems,
	universeStargates,
} from './db/schema'
import { KillmailService } from './services/killmail.service'
import { parseInventory } from './utils/inventory-parser'

import type { InventoryParseResult } from '@repo/eve-types'
import type { EsiTypeResolver } from '@repo/esi'
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
	UniverseNpcStation,
	UniversePlanet,
	UniverseConstellation,
	UniverseRegion,
	UniverseSolarSystem,
	UniverseStargate,
	UniverseStaticMoon,
	TypeMetadata,
	Universe,
	UniverseMoon,
	UniverseMoonResource,
	UniverseMoonWithResources,
} from '@repo/universe'
import type { Env } from './context'

/**
 * Module-level cache for all solar system ID/name pairs, used by search fallback.
 * Refreshed hourly per worker instance.
 */
let allSolarSystemNamesCache: Array<{ id: string; name: string }> | null = null
let allSolarSystemNamesCacheExpiry = 0

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
	private regionIdsCache: LRUCache<UniverseRegion>
	private regionNamesCache: LRUCache<UniverseRegion>
	private constellationIdsCache: LRUCache<UniverseConstellation>
	private solarSystemIdsCache: LRUCache<UniverseSolarSystem>
	private solarSystemNamesCache: LRUCache<UniverseSolarSystem>
	private planetIdsCache: LRUCache<UniversePlanet>
	private planetNamesCache: LRUCache<UniversePlanet>
	private moonIdsCache: LRUCache<UniverseStaticMoon>
	private moonNamesCache: LRUCache<UniverseStaticMoon>
	private stargateIdsCache: LRUCache<UniverseStargate>
	private stargateNamesCache: LRUCache<UniverseStargate>
	private npcStationIdsCache: LRUCache<UniverseNpcStation>
	private npcStationNamesCache: LRUCache<UniverseNpcStation>
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
		this.invFlagsCache = new LRUCache<InvFlag>(200)
		this.invGroupsCache = new LRUCache<InvGroup>(200)
		this.typeIdsCache = new LRUCache<InvType>(2000) // Cache for type name -> full InvType object
		this.typeNamesCache = new LRUCache<InvType>(2000) // Cache for type ID -> full InvType object
		this.regionIdsCache = new LRUCache<UniverseRegion>(100)
		this.regionNamesCache = new LRUCache<UniverseRegion>(100)
		this.constellationIdsCache = new LRUCache<UniverseConstellation>(500)
		this.solarSystemIdsCache = new LRUCache<UniverseSolarSystem>(1000)
		this.solarSystemNamesCache = new LRUCache<UniverseSolarSystem>(1000)
		this.planetIdsCache = new LRUCache<UniversePlanet>(2000)
		this.planetNamesCache = new LRUCache<UniversePlanet>(2000)
		this.moonIdsCache = new LRUCache<UniverseStaticMoon>(3000)
		this.moonNamesCache = new LRUCache<UniverseStaticMoon>(3000)
		this.stargateIdsCache = new LRUCache<UniverseStargate>(1000)
		this.stargateNamesCache = new LRUCache<UniverseStargate>(1000)
		this.npcStationIdsCache = new LRUCache<UniverseNpcStation>(1000)
		this.npcStationNamesCache = new LRUCache<UniverseNpcStation>(1000)
		this.killmailService = new KillmailService(this.db, this.env)
	}

	// ========================================================================
	// PRIVATE HELPERS
	// ========================================================================

	async searchSolarSystems(query: string, limit = 20): Promise<UniverseSolarSystem[]> {
		const trimmedQuery = query.trim()
		if (trimmedQuery.length < 2) return []
		const safeLimit = Math.max(1, Math.min(limit, 50))

		const rows = await this.db
			.select()
			.from(universeSolarSystems)
			.where(ilike(universeSolarSystems.solarSystemName, `%${trimmedQuery}%`))
			.orderBy(universeSolarSystems.solarSystemName)
			.limit(safeLimit)

		const results = rows.map((row) => ({
			solarSystemId: row.solarSystemId,
			solarSystemName: row.solarSystemName,
			regionId: row.regionId,
			constellationId: row.constellationId,
			securityStatus: row.securityStatus,
		}))

		for (const system of results) {
			this.solarSystemIdsCache.set(system.solarSystemId, system)
			this.solarSystemNamesCache.set(system.solarSystemName, system)
		}

		if (results.length > 0) {
			return results
		}

		// Fallback: if SDE-backed DB lookup missed, search via ESI universe IDs + name resolution,
		// then hydrate full system rows through resolveSolarSystemsByIds (which backfills DB/cache).
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		if (!allSolarSystemNamesCache || allSolarSystemNamesCacheExpiry <= Date.now()) {
			const idsResult = await tokenStoreStub.fetchPublicEsi<number[]>(
				'/latest/universe/systems/?datasource=tranquility'
			)
			const ids = idsResult.data.map((id) => String(id))
			const resolverStub = getStub<EsiTypeResolver>(this.env.ESI_TYPE_RESOLVER, 'global')
			const namesById = await resolverStub.resolveIds(ids)
			allSolarSystemNamesCache = ids
				.map((id) => ({ id, name: namesById[id] }))
				.filter((row) => Boolean(row.name))
			allSolarSystemNamesCacheExpiry = Date.now() + 60 * 60 * 1000
		}

		const fallbackIds = (allSolarSystemNamesCache ?? [])
			.filter((row) => row.name.toLowerCase().includes(trimmedQuery.toLowerCase()))
			.slice(0, safeLimit)
			.map((row) => row.id)

		if (fallbackIds.length === 0) {
			return []
		}

		const hydrated = await this.resolveSolarSystemsByIds(fallbackIds)
		return fallbackIds
			.map((id) => hydrated[id])
			.filter((system): system is UniverseSolarSystem => Boolean(system))

	}

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
			const tokenStoreStub = getStub<EveTokenStore>(
				this.env.EVE_TOKEN_STORE,
				structureId ? String(structureId) : 'default'
			)

			logger.info('[UniverseDO] Fetching structure info', {
				structureId,
				authorizedCharacterId,
			})

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
			const tokenStoreStub = getStub<EveTokenStore>(
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

			// Fall back to ESI type resolver for any IDs not in the SDE
			const sdeUnresolved = Object.entries(result)
				.filter(([, v]) => v === null)
				.map(([id]) => id)

			if (sdeUnresolved.length > 0) {
				const resolverStub = getStub<EsiTypeResolver>(this.env.ESI_TYPE_RESOLVER, 'global')
				const fallbackNames = await resolverStub.resolveIds(sdeUnresolved).catch(() => ({}) as Record<string, string>)
				const newRows: typeof invTypes.$inferInsert[] = []
				for (const [id, name] of Object.entries(fallbackNames)) {
					if (name) {
						const stub: InvType = {
							typeId: id,
							typeName: name,
							groupId: '',
							description: '',
							mass: '0',
							volume: '0',
							capacity: '0',
							portionSize: 1,
							raceId: null,
							basePrice: null,
							published: false,
							marketGroupId: null,
							iconId: null,
							soundId: null,
							graphicId: '',
						}
						result[id] = stub
						this.typeNamesCache.set(id, stub)
						this.typeIdsCache.set(name, stub)
						newRows.push(stub)
					}
				}
				if (newRows.length > 0) {
					await this.db
						.insert(invTypes)
						.values(newRows)
						.onConflictDoUpdate({
							target: invTypes.typeId,
							set: { typeName: sql`EXCLUDED.type_name` },
						})
						.catch(() => {})
				}
			}

			return result
		} catch (error) {
			console.error('Failed to resolve type details', error)
			throw error
		}
	}

	/**
	 * Resolve type metadata (market group and category names) by type IDs.
	 */
	async resolveTypeMetadataByIds(typeIds: string[]): Promise<Record<string, TypeMetadata>> {
		if (typeIds.length === 0) {
			return {}
		}

		if (typeIds.length > 1000) {
			throw new Error('Maximum 1000 typeIds allowed per request')
		}

		try {
			const results = await this.db
				.select({
					typeId: invTypes.typeId,
					marketGroupId: invTypes.marketGroupId,
					marketGroupName: invMarketGroups.marketGroupName,
					categoryName: invCategories.categoryName,
				})
				.from(invTypes)
				.innerJoin(invGroups, eq(invTypes.groupId, invGroups.groupId))
				.innerJoin(invCategories, eq(invGroups.categoryId, invCategories.categoryId))
				.leftJoin(invMarketGroups, eq(invTypes.marketGroupId, invMarketGroups.marketGroupId))
				.where(inArray(invTypes.typeId, typeIds))

			const metadataMap: Record<string, TypeMetadata> = {}
			for (const row of results) {
				metadataMap[row.typeId] = {
					marketGroupId: row.marketGroupId ?? null,
					marketGroupName: row.marketGroupName ?? null,
					categoryName: row.categoryName,
				}
			}

			return metadataMap
		} catch (error) {
			console.error('Failed to resolve type metadata', error)
			throw error
		}
	}

	/**
	 * Returns all published type IDs eligible for daily market price tracking.
	 *
	 * Covers categories 6 (Ships), 7 (Modules), 32 (Subsystems), 66 (Rigs) via a
	 * direct category join, plus category 20 (Implants) filtered to the
	 * Attribute Enhancers (market group 24) and Hardwirings (market group 300)
	 * subtrees via a recursive CTE — excluding boosters and cerebral accelerators.
	 */
	async getMarketPriceWhitelist(): Promise<string[]> {
		// Direct category join for ships, modules, subsystems, rigs
		const directRows = await this.db
			.select({ typeId: invTypes.typeId })
			.from(invTypes)
			.innerJoin(invGroups, eq(invTypes.groupId, invGroups.groupId))
			.where(
				and(
					eq(invTypes.published, true),
					inArray(invGroups.categoryId, ['6', '7', '32', '66'])
				)
			)

		// Implants (category 20) filtered to attribute enhancers + skill hardwirings
		// via recursive market group hierarchy. Group 24 = Attribute Enhancers,
		// Group 300 = Hardwirings — both are stable SDE values.
		// Safe degradation: wrong group IDs → empty implant set, no crash.
		const implantResult = await this.db.execute<{ type_id: string }>(sql`
			WITH RECURSIVE allowed_groups AS (
				SELECT market_group_id
				FROM universe_eve_market_groups
				WHERE market_group_id IN ('24', '300')
				UNION ALL
				SELECT mg.market_group_id
				FROM universe_eve_market_groups mg
				INNER JOIN allowed_groups ag ON mg.parent_group_id = ag.market_group_id
			)
			SELECT t.type_id
			FROM universe_eve_inv_types t
			INNER JOIN universe_eve_inv_groups g ON t.group_id = g.group_id
			WHERE t.published = true
			  AND g.category_id = '20'
			  AND t.market_group_id IN (SELECT market_group_id FROM allowed_groups)
		`)

		const directTypeIds = directRows.map((r) => r.typeId)
		const implantTypeIds = implantResult.rows.map((r) => r.type_id)

		// Moon ore reprocessing outputs, fuel blocks, and magmatic gas needed for
		// moon scan profitability calculations.
		const moonMaterialTypeIds = [
			'35', '36', // Pyerite, Mexallon (base minerals in R4/R8/R16 outputs)
			'16633', '16634', '16635', '16636', '16637', '16638', '16639', '16640', // R4/R8 materials
			'16641', '16642', '16643', '16644', // R16 materials
			'16648', '16649', '16650', '16651', // R32 materials
			'16652', '16653', '16654', '16655', // R64 materials
			'4247',  // Nitrogen Fuel Block
			'81143', // Magmatic Gas
		]

		return [...new Set([...directTypeIds, ...implantTypeIds, ...moonMaterialTypeIds])]
	}

	/**
	 * Parse inventory export text into structured item metadata.
	 */
	async parseInventoryText(inventoryText: string): Promise<InventoryParseResult> {
		if (typeof inventoryText !== 'string') {
			throw new Error('inventoryText must be a string')
		}

		if (inventoryText.length > 1024 * 1024) {
			throw new Error('Input text too large (max 1MB)')
		}

		try {
			return await parseInventory(this.db, inventoryText)
		} catch (error) {
			console.error('Failed to parse inventory text', error)
			throw error
		}
	}

	/**
	 * Resolve regions by IDs.
	 */
	async resolveRegionsByIds(regionIds: string[]): Promise<Record<string, UniverseRegion | null>> {
		try {
			const result: Record<string, UniverseRegion | null> = {}
			const cacheMisses: string[] = []

			for (const regionId of regionIds) {
				const cached = this.regionIdsCache.get(regionId)
				if (cached !== undefined) {
					result[regionId] = cached
				} else {
					cacheMisses.push(regionId)
				}
			}

			if (cacheMisses.length > 0) {
				const regions = await this.db
					.select()
					.from(universeRegions)
					.where(inArray(universeRegions.regionId, cacheMisses))

				for (const region of regions) {
					const regionData: UniverseRegion = {
						regionId: region.regionId,
						regionName: region.regionName,
					}
					this.regionIdsCache.set(region.regionId, regionData)
					this.regionNamesCache.set(region.regionName, regionData)
					result[region.regionId] = regionData
				}

				for (const missedId of cacheMisses) {
					if (!(missedId in result)) {
						result[missedId] = null
					}
				}
			}

			const unresolved = Object.entries(result)
				.filter(([, v]) => v === null)
				.map(([id]) => id)

			if (unresolved.length > 0) {
				const resolverStub = getStub<EsiTypeResolver>(this.env.ESI_TYPE_RESOLVER, 'global')
				const fallbackNames = await resolverStub.resolveIds(unresolved).catch(() => ({}) as Record<string, string>)
				const newRows: typeof universeRegions.$inferInsert[] = []
				for (const [id, name] of Object.entries(fallbackNames)) {
					if (name) {
						const regionData: UniverseRegion = { regionId: id, regionName: name }
						result[id] = regionData
						this.regionIdsCache.set(id, regionData)
						this.regionNamesCache.set(name, regionData)
						newRows.push({ regionId: id, regionName: name })
					}
				}
				if (newRows.length > 0) {
					await this.db
						.insert(universeRegions)
						.values(newRows)
						.onConflictDoUpdate({
							target: universeRegions.regionId,
							set: { regionName: sql`EXCLUDED.region_name` },
						})
						.catch(() => {})
				}
			}

			return result
		} catch (error) {
			console.error('Failed to resolve regions by IDs', error)
			throw error
		}
	}

	/**
	 * Resolve regions by names.
	 */
	async resolveRegionsByNames(regionNames: string[]): Promise<Record<string, UniverseRegion | null>> {
		try {
			const result: Record<string, UniverseRegion | null> = {}
			const cacheMisses: string[] = []

			for (const regionName of regionNames) {
				const cached = this.regionNamesCache.get(regionName)
				if (cached !== undefined) {
					result[regionName] = cached
				} else {
					cacheMisses.push(regionName)
				}
			}

			if (cacheMisses.length > 0) {
				const regions = await this.db
					.select()
					.from(universeRegions)
					.where(inArray(universeRegions.regionName, cacheMisses))

				for (const region of regions) {
					const regionData: UniverseRegion = {
						regionId: region.regionId,
						regionName: region.regionName,
					}
					this.regionIdsCache.set(region.regionId, regionData)
					this.regionNamesCache.set(region.regionName, regionData)
					result[region.regionName] = regionData
				}

				for (const missedName of cacheMisses) {
					if (!(missedName in result)) {
						result[missedName] = null
					}
				}
			}

			return result
		} catch (error) {
			console.error('Failed to resolve regions by names', error)
			throw error
		}
	}

	async resolveConstellationsByIds(
		constellationIds: string[]
	): Promise<Record<string, UniverseConstellation | null>> {
		try {
			const result: Record<string, UniverseConstellation | null> = {}
			const cacheMisses: string[] = []

			for (const id of constellationIds) {
				const cached = this.constellationIdsCache.get(id)
				if (cached !== undefined) {
					result[id] = cached
				} else {
					cacheMisses.push(id)
				}
			}

				if (cacheMisses.length > 0) {
					let rows: typeof universeConstellations.$inferSelect[] = []
					try {
						rows = await this.db
							.select()
							.from(universeConstellations)
							.where(inArray(universeConstellations.constellationId, cacheMisses))
					} catch (error) {
						console.warn(
							'Constellation DB lookup failed; falling back to ESI for unresolved IDs',
							error
						)
					}

				for (const row of rows) {
					const data: UniverseConstellation = {
						constellationId: row.constellationId,
						constellationName: row.constellationName,
						regionId: row.regionId,
					}
					this.constellationIdsCache.set(row.constellationId, data)
					result[row.constellationId] = data
				}

				for (const missedId of cacheMisses) {
					if (!(missedId in result)) {
						result[missedId] = null
					}
				}
			}

			const unresolved = Object.entries(result)
				.filter(([, v]) => v === null)
				.map(([id]) => id)

			if (unresolved.length > 0) {
				const fetched = await Promise.allSettled(
					unresolved.map(async (id) => {
						const res = await fetch(
							`https://esi.evetech.net/latest/universe/constellations/${id}/?datasource=tranquility`
						)
						if (!res.ok) return null
						const data = (await res.json()) as {
							constellation_id: number
							name: string
							region_id: number
						}
						return {
							constellationId: String(data.constellation_id),
							constellationName: data.name,
							regionId: String(data.region_id),
						} satisfies UniverseConstellation
					})
				)

				const newRows: typeof universeConstellations.$inferInsert[] = []
				for (const settled of fetched) {
					if (settled.status === 'fulfilled' && settled.value) {
						const c = settled.value
						result[c.constellationId] = c
						this.constellationIdsCache.set(c.constellationId, c)
						newRows.push(c)
					}
				}
				if (newRows.length > 0) {
					await this.db
						.insert(universeConstellations)
						.values(newRows)
						.onConflictDoUpdate({
							target: universeConstellations.constellationId,
							set: {
								constellationName: sql`EXCLUDED.constellation_name`,
								regionId: sql`EXCLUDED.region_id`,
							},
						})
						.catch(() => {})
				}
			}

			return result
		} catch (error) {
			console.error('Failed to resolve constellations by IDs', error)
			throw error
		}
	}

	/**
	 * Resolve solar systems by IDs.
	 */
	async resolveSolarSystemsByIds(
		solarSystemIds: string[]
	): Promise<Record<string, UniverseSolarSystem | null>> {
		try {
			const result: Record<string, UniverseSolarSystem | null> = {}
			const cacheMisses: string[] = []

			for (const solarSystemId of solarSystemIds) {
				const cached = this.solarSystemIdsCache.get(solarSystemId)
				if (cached !== undefined) {
					result[solarSystemId] = cached
				} else {
					cacheMisses.push(solarSystemId)
				}
			}

				if (cacheMisses.length > 0) {
					let systems: typeof universeSolarSystems.$inferSelect[] = []
					try {
						systems = await this.db
							.select()
							.from(universeSolarSystems)
							.where(inArray(universeSolarSystems.solarSystemId, cacheMisses))
					} catch (error) {
						console.warn(
							'Solar system DB lookup failed; falling back to ESI for unresolved IDs',
							error
						)
					}

				for (const system of systems) {
					const systemData: UniverseSolarSystem = {
						solarSystemId: system.solarSystemId,
						solarSystemName: system.solarSystemName,
						regionId: system.regionId,
						constellationId: system.constellationId,
						securityStatus: system.securityStatus,
					}
					this.solarSystemIdsCache.set(system.solarSystemId, systemData)
					this.solarSystemNamesCache.set(system.solarSystemName, systemData)
					result[system.solarSystemId] = systemData
				}

				for (const missedId of cacheMisses) {
					if (!(missedId in result)) {
						result[missedId] = null
					}
				}
			}

			const unresolved = Object.entries(result)
				.filter(([, v]) => v === null)
				.map(([id]) => id)

			if (unresolved.length > 0) {
				const fetched = await Promise.allSettled(
					unresolved.map(async (id) => {
						const res = await fetch(
							`https://esi.evetech.net/latest/universe/systems/${id}/?datasource=tranquility`
						)
						if (!res.ok) return null
						const data = (await res.json()) as {
							system_id: number
							name: string
							constellation_id: number
							security_status: number
						}
						return {
							systemId: String(data.system_id),
							systemName: data.name,
							constellationId: String(data.constellation_id),
							securityStatus: String(data.security_status),
						}
					})
				)

				// Resolve constellations (which also provides regionId) for all fetched systems
				const constellationIds: string[] = []
				for (const s of fetched) {
					if (s.status === 'fulfilled' && s.value) constellationIds.push(s.value.constellationId)
				}
				const constellationMap = constellationIds.length > 0
					? await this.resolveConstellationsByIds([...new Set(constellationIds)])
					: {}

				const newRows: typeof universeSolarSystems.$inferInsert[] = []
				for (const settled of fetched) {
					if (settled.status === 'fulfilled' && settled.value) {
						const s = settled.value
						const constellation = constellationMap[s.constellationId]
						if (!constellation) continue
						const systemData: UniverseSolarSystem = {
							solarSystemId: s.systemId,
							solarSystemName: s.systemName,
							constellationId: s.constellationId,
							regionId: constellation.regionId,
							securityStatus: s.securityStatus,
						}
						result[s.systemId] = systemData
						this.solarSystemIdsCache.set(s.systemId, systemData)
						this.solarSystemNamesCache.set(s.systemName, systemData)
						newRows.push(systemData)
					}
				}
				if (newRows.length > 0) {
					await this.db
						.insert(universeSolarSystems)
						.values(newRows)
						.onConflictDoUpdate({
							target: universeSolarSystems.solarSystemId,
							set: {
								solarSystemName: sql`EXCLUDED.solar_system_name`,
								constellationId: sql`EXCLUDED.constellation_id`,
								regionId: sql`EXCLUDED.region_id`,
								securityStatus: sql`EXCLUDED.security_status`,
							},
						})
						.catch(() => {})
				}
			}

			return result
		} catch (error) {
			console.error('Failed to resolve solar systems by IDs', error)
			throw error
		}
	}

	/**
	 * Resolve solar systems by names.
	 */
	async resolveSolarSystemsByNames(
		solarSystemNames: string[]
	): Promise<Record<string, UniverseSolarSystem | null>> {
		try {
			const result: Record<string, UniverseSolarSystem | null> = {}
			const cacheMisses: string[] = []

			for (const solarSystemName of solarSystemNames) {
				const cached = this.solarSystemNamesCache.get(solarSystemName)
				if (cached !== undefined) {
					result[solarSystemName] = cached
				} else {
					cacheMisses.push(solarSystemName)
				}
			}

			if (cacheMisses.length > 0) {
				const systems = await this.db
					.select()
					.from(universeSolarSystems)
					.where(inArray(universeSolarSystems.solarSystemName, cacheMisses))

				for (const system of systems) {
					const systemData: UniverseSolarSystem = {
						solarSystemId: system.solarSystemId,
						solarSystemName: system.solarSystemName,
						regionId: system.regionId,
						constellationId: system.constellationId,
						securityStatus: system.securityStatus,
					}
					this.solarSystemIdsCache.set(system.solarSystemId, systemData)
					this.solarSystemNamesCache.set(system.solarSystemName, systemData)
					result[system.solarSystemName] = systemData
				}

				for (const missedName of cacheMisses) {
					if (!(missedName in result)) {
						result[missedName] = null
					}
				}
			}

			return result
		} catch (error) {
			console.error('Failed to resolve solar systems by names', error)
			throw error
		}
	}

	/**
	 * Resolve planets by IDs.
	 */
	async resolvePlanetsByIds(planetIds: string[]): Promise<Record<string, UniversePlanet | null>> {
		try {
			const result: Record<string, UniversePlanet | null> = {}
			const cacheMisses: string[] = []

			for (const planetId of planetIds) {
				const cached = this.planetIdsCache.get(planetId)
				if (cached !== undefined) {
					result[planetId] = cached
				} else {
					cacheMisses.push(planetId)
				}
			}

			if (cacheMisses.length > 0) {
				const planets = await this.db
					.select()
					.from(universePlanets)
					.where(inArray(universePlanets.planetId, cacheMisses))

				for (const planet of planets) {
					const planetData: UniversePlanet = {
						planetId: planet.planetId,
						planetName: planet.planetName,
						solarSystemId: planet.solarSystemId,
						celestialIndex: planet.celestialIndex,
						typeId: planet.typeId,
					}
					this.planetIdsCache.set(planet.planetId, planetData)
					this.planetNamesCache.set(planet.planetName, planetData)
					result[planet.planetId] = planetData
				}

				for (const missedId of cacheMisses) {
					if (!(missedId in result)) {
						result[missedId] = null
					}
				}
			}

			return result
		} catch (error) {
			console.error('Failed to resolve planets by IDs', error)
			throw error
		}
	}

	/**
	 * Resolve planets by names.
	 */
	async resolvePlanetsByNames(
		planetNames: string[]
	): Promise<Record<string, UniversePlanet | null>> {
		try {
			const result: Record<string, UniversePlanet | null> = {}
			const cacheMisses: string[] = []

			for (const planetName of planetNames) {
				const cached = this.planetNamesCache.get(planetName)
				if (cached !== undefined) {
					result[planetName] = cached
				} else {
					cacheMisses.push(planetName)
				}
			}

			if (cacheMisses.length > 0) {
				const planets = await this.db
					.select()
					.from(universePlanets)
					.where(inArray(universePlanets.planetName, cacheMisses))

				for (const planet of planets) {
					const planetData: UniversePlanet = {
						planetId: planet.planetId,
						planetName: planet.planetName,
						solarSystemId: planet.solarSystemId,
						celestialIndex: planet.celestialIndex,
						typeId: planet.typeId,
					}
					this.planetIdsCache.set(planet.planetId, planetData)
					this.planetNamesCache.set(planet.planetName, planetData)
					result[planet.planetName] = planetData
				}

				for (const missedName of cacheMisses) {
					if (!(missedName in result)) {
						result[missedName] = null
					}
				}
			}

			return result
		} catch (error) {
			console.error('Failed to resolve planets by names', error)
			throw error
		}
	}

	/**
	 * Resolve static moons by IDs.
	 */
	async resolveStaticMoonsByIds(
		moonIds: string[]
	): Promise<Record<string, UniverseStaticMoon | null>> {
		try {
			const result: Record<string, UniverseStaticMoon | null> = {}
			const cacheMisses: string[] = []

			for (const moonId of moonIds) {
				const cached = this.moonIdsCache.get(moonId)
				if (cached !== undefined) {
					result[moonId] = cached
				} else {
					cacheMisses.push(moonId)
				}
			}

			if (cacheMisses.length > 0) {
				const moonsRows = await this.db
					.select()
					.from(moons)
					.where(inArray(moons.moonId, cacheMisses))

				for (const moon of moonsRows) {
					const moonData: UniverseStaticMoon = {
						moonId: moon.moonId,
						moonName: moon.name,
						planetId: moon.planetId,
						solarSystemId: moon.solarSystemId,
					}
					this.moonIdsCache.set(moon.moonId, moonData)
					this.moonNamesCache.set(moon.name, moonData)
					result[moon.moonId] = moonData
				}

				for (const missedId of cacheMisses) {
					if (!(missedId in result)) {
						result[missedId] = null
					}
				}
			}

			return result
		} catch (error) {
			console.error('Failed to resolve static moons by IDs', error)
			throw error
		}
	}

	/**
	 * Resolve static moons by names.
	 */
	async resolveStaticMoonsByNames(
		moonNames: string[]
	): Promise<Record<string, UniverseStaticMoon | null>> {
		try {
			const result: Record<string, UniverseStaticMoon | null> = {}
			const cacheMisses: string[] = []

			for (const moonName of moonNames) {
				const cached = this.moonNamesCache.get(moonName)
				if (cached !== undefined) {
					result[moonName] = cached
				} else {
					cacheMisses.push(moonName)
				}
			}

			if (cacheMisses.length > 0) {
				const moonsRows = await this.db
					.select()
					.from(moons)
					.where(inArray(moons.name, cacheMisses))

				for (const moon of moonsRows) {
					const moonData: UniverseStaticMoon = {
						moonId: moon.moonId,
						moonName: moon.name,
						planetId: moon.planetId,
						solarSystemId: moon.solarSystemId,
					}
					this.moonIdsCache.set(moon.moonId, moonData)
					this.moonNamesCache.set(moon.name, moonData)
					result[moon.name] = moonData
				}

				for (const missedName of cacheMisses) {
					if (!(missedName in result)) {
						result[missedName] = null
					}
				}
			}

			return result
		} catch (error) {
			console.error('Failed to resolve static moons by names', error)
			throw error
		}
	}

	/**
	 * Resolve stargates by IDs.
	 */
	async resolveStargatesByIds(
		stargateIds: string[]
	): Promise<Record<string, UniverseStargate | null>> {
		try {
			const result: Record<string, UniverseStargate | null> = {}
			const cacheMisses: string[] = []

			for (const stargateId of stargateIds) {
				const cached = this.stargateIdsCache.get(stargateId)
				if (cached !== undefined) {
					result[stargateId] = cached
				} else {
					cacheMisses.push(stargateId)
				}
			}

			if (cacheMisses.length > 0) {
				const stargates = await this.db
					.select()
					.from(universeStargates)
					.where(inArray(universeStargates.stargateId, cacheMisses))

				for (const stargate of stargates) {
					const stargateData: UniverseStargate = {
						stargateId: stargate.stargateId,
						stargateName: stargate.stargateName,
						solarSystemId: stargate.solarSystemId,
						destinationSolarSystemId: stargate.destinationSolarSystemId,
						destinationStargateId: stargate.destinationStargateId,
						typeId: stargate.typeId,
					}
					this.stargateIdsCache.set(stargate.stargateId, stargateData)
					this.stargateNamesCache.set(stargate.stargateName, stargateData)
					result[stargate.stargateId] = stargateData
				}

				for (const missedId of cacheMisses) {
					if (!(missedId in result)) {
						result[missedId] = null
					}
				}
			}

			return result
		} catch (error) {
			console.error('Failed to resolve stargates by IDs', error)
			throw error
		}
	}

	/**
	 * Resolve stargates by names.
	 */
	async resolveStargatesByNames(
		stargateNames: string[]
	): Promise<Record<string, UniverseStargate | null>> {
		try {
			const result: Record<string, UniverseStargate | null> = {}
			const cacheMisses: string[] = []

			for (const stargateName of stargateNames) {
				const cached = this.stargateNamesCache.get(stargateName)
				if (cached !== undefined) {
					result[stargateName] = cached
				} else {
					cacheMisses.push(stargateName)
				}
			}

			if (cacheMisses.length > 0) {
				const stargates = await this.db
					.select()
					.from(universeStargates)
					.where(inArray(universeStargates.stargateName, cacheMisses))

				for (const stargate of stargates) {
					const stargateData: UniverseStargate = {
						stargateId: stargate.stargateId,
						stargateName: stargate.stargateName,
						solarSystemId: stargate.solarSystemId,
						destinationSolarSystemId: stargate.destinationSolarSystemId,
						destinationStargateId: stargate.destinationStargateId,
						typeId: stargate.typeId,
					}
					this.stargateIdsCache.set(stargate.stargateId, stargateData)
					this.stargateNamesCache.set(stargate.stargateName, stargateData)
					result[stargate.stargateName] = stargateData
				}

				for (const missedName of cacheMisses) {
					if (!(missedName in result)) {
						result[missedName] = null
					}
				}
			}

			return result
		} catch (error) {
			console.error('Failed to resolve stargates by names', error)
			throw error
		}
	}

	/**
	 * Resolve NPC stations by IDs.
	 */
	async resolveNpcStationsByIds(
		stationIds: string[]
	): Promise<Record<string, UniverseNpcStation | null>> {
		try {
			const result: Record<string, UniverseNpcStation | null> = {}
			const cacheMisses: string[] = []

			for (const stationId of stationIds) {
				const cached = this.npcStationIdsCache.get(stationId)
				if (cached !== undefined) {
					result[stationId] = cached
				} else {
					cacheMisses.push(stationId)
				}
			}

			if (cacheMisses.length > 0) {
				const stations = await this.db
					.select()
					.from(universeNpcStations)
					.where(inArray(universeNpcStations.stationId, cacheMisses))

				for (const station of stations) {
					const stationData: UniverseNpcStation = {
						stationId: station.stationId,
						stationName: station.stationName,
						solarSystemId: station.solarSystemId,
						orbitId: station.orbitId,
						ownerId: station.ownerId,
						operationId: station.operationId,
						typeId: station.typeId,
						useOperationName: station.useOperationName,
					}
					this.npcStationIdsCache.set(station.stationId, stationData)
					this.npcStationNamesCache.set(station.stationName, stationData)
					result[station.stationId] = stationData
				}

				for (const missedId of cacheMisses) {
					if (!(missedId in result)) {
						result[missedId] = null
					}
				}
			}

			return result
		} catch (error) {
			console.error('Failed to resolve NPC stations by IDs', error)
			throw error
		}
	}

	/**
	 * Resolve NPC stations by names.
	 */
	async resolveNpcStationsByNames(
		stationNames: string[]
	): Promise<Record<string, UniverseNpcStation | null>> {
		try {
			const result: Record<string, UniverseNpcStation | null> = {}
			const cacheMisses: string[] = []

			for (const stationName of stationNames) {
				const cached = this.npcStationNamesCache.get(stationName)
				if (cached !== undefined) {
					result[stationName] = cached
				} else {
					cacheMisses.push(stationName)
				}
			}

			if (cacheMisses.length > 0) {
				const stations = await this.db
					.select()
					.from(universeNpcStations)
					.where(inArray(universeNpcStations.stationName, cacheMisses))

				for (const station of stations) {
					const stationData: UniverseNpcStation = {
						stationId: station.stationId,
						stationName: station.stationName,
						solarSystemId: station.solarSystemId,
						orbitId: station.orbitId,
						ownerId: station.ownerId,
						operationId: station.operationId,
						typeId: station.typeId,
						useOperationName: station.useOperationName,
					}
					this.npcStationIdsCache.set(station.stationId, stationData)
					this.npcStationNamesCache.set(station.stationName, stationData)
					result[station.stationName] = stationData
				}

				for (const missedName of cacheMisses) {
					if (!(missedName in result)) {
						result[missedName] = null
					}
				}
			}

			return result
		} catch (error) {
			console.error('Failed to resolve NPC stations by names', error)
			throw error
		}
	}

	/**
	 * Get all solar systems in a region.
	 */
	async getSystemsByRegionId(regionId: string): Promise<UniverseSolarSystem[]> {
		const rows = await this.db
			.select()
			.from(universeSolarSystems)
			.where(eq(universeSolarSystems.regionId, regionId))
		return rows.map((r) => ({
			solarSystemId: r.solarSystemId,
			solarSystemName: r.solarSystemName,
			regionId: r.regionId,
			constellationId: r.constellationId,
			securityStatus: r.securityStatus,
		}))
	}

	/**
	 * Get all moons in a solar system.
	 */
	async getMoonsBySystemId(systemId: string): Promise<UniverseStaticMoon[]> {
		const rows = await this.db
			.select()
			.from(moons)
			.where(eq(moons.solarSystemId, systemId))
		return rows.map((r) => ({
			moonId: r.moonId,
			moonName: r.name,
			planetId: r.planetId,
			solarSystemId: r.solarSystemId,
		}))
	}

	/**
	 * Get all stargates for a set of solar systems (for jump connections on map).
	 */
	async getStargatesBySystemIds(systemIds: string[]): Promise<UniverseStargate[]> {
		if (systemIds.length === 0) return []
		const rows = await this.db
			.select()
			.from(universeStargates)
			.where(inArray(universeStargates.solarSystemId, systemIds))
		return rows.map((r) => ({
			stargateId: r.stargateId,
			stargateName: r.stargateName,
			solarSystemId: r.solarSystemId,
			destinationSolarSystemId: r.destinationSolarSystemId,
			destinationStargateId: r.destinationStargateId,
			typeId: r.typeId,
		}))
	}

	/**
	 * Get system and moon counts per region (for region overview map).
	 */
	async getRegionStats(regionIds: string[]): Promise<Record<string, { systemCount: number; moonCount: number }>> {
		if (regionIds.length === 0) return {}

		const [systemRows, moonRows] = await Promise.all([
			this.db
				.select({
					regionId: universeSolarSystems.regionId,
					systemCount: sql<string>`count(*)`.as('system_count'),
				})
				.from(universeSolarSystems)
				.where(inArray(universeSolarSystems.regionId, regionIds))
				.groupBy(universeSolarSystems.regionId),

			this.db
				.select({
					regionId: universeSolarSystems.regionId,
					moonCount: sql<string>`count(${moons.moonId})`.as('moon_count'),
				})
				.from(moons)
				.innerJoin(universeSolarSystems, eq(moons.solarSystemId, universeSolarSystems.solarSystemId))
				.where(inArray(universeSolarSystems.regionId, regionIds))
				.groupBy(universeSolarSystems.regionId),
		])

		const result: Record<string, { systemCount: number; moonCount: number }> = {}
		for (const r of systemRows) {
			result[r.regionId] = { systemCount: Number(r.systemCount), moonCount: 0 }
		}
		for (const r of moonRows) {
			if (result[r.regionId]) result[r.regionId].moonCount = Number(r.moonCount)
		}
		return result
	}

	/**
	 * Map moon IDs to their region IDs (for aggregating scan coverage by region).
	 */
	async getMoonRegionIds(moonIds: string[]): Promise<Record<string, string>> {
		if (moonIds.length === 0) return {}

		const rows = await this.db
			.select({
				moonId: moons.moonId,
				regionId: universeSolarSystems.regionId,
			})
			.from(moons)
			.innerJoin(universeSolarSystems, eq(moons.solarSystemId, universeSolarSystems.solarSystemId))
			.where(inArray(moons.moonId, moonIds))

		const result: Record<string, string> = {}
		for (const r of rows) result[r.moonId] = r.regionId
		return result
	}

	/**
	 * Get unique cross-region stargate connections (for drawing inter-region lines on universe map).
	 */
	async getRegionConnections(regionIds: string[]): Promise<Array<{ fromRegionId: string; toRegionId: string }>> {
		if (regionIds.length === 0) return []

		const ss1 = alias(universeSolarSystems, 'ss1')
		const ss2 = alias(universeSolarSystems, 'ss2')

		const rows = await this.db
			.selectDistinct({
				fromRegionId: ss1.regionId,
				toRegionId: ss2.regionId,
			})
			.from(universeStargates)
			.innerJoin(ss1, eq(universeStargates.solarSystemId, ss1.solarSystemId))
			.innerJoin(ss2, eq(universeStargates.destinationSolarSystemId, ss2.solarSystemId))
			.where(and(ne(ss1.regionId, ss2.regionId), inArray(ss1.regionId, regionIds)))

		// Deduplicate bidirectional connections (A→B and B→A both appear)
		const seen = new Set<string>()
		const connections: Array<{ fromRegionId: string; toRegionId: string }> = []
		for (const row of rows) {
			const key = [row.fromRegionId, row.toRegionId].sort().join('|')
			if (!seen.has(key)) {
				seen.add(key)
				connections.push({ fromRegionId: row.fromRegionId, toRegionId: row.toRegionId })
			}
		}
		return connections
	}

	/**
	 * Search for types by name (partial LIKE match)
	 * Only returns published types. Results ordered by name.
	 */
	async searchTypes(query: string, limit: number = 20): Promise<InvType[]> {
		if (!query || query.trim().length < 2) return []

		const results = await this.db
			.select()
			.from(invTypes)
			.where(and(ilike(invTypes.typeName, `%${query}%`), eq(invTypes.published, true)))
			.limit(limit)

		return results.map((r) => ({ ...r }))
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
	async fetchKillmailByIdAndHash(
		killmailId: string,
		killmailHash: string
	): Promise<Killmail | null> {
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
