import { getStub } from '@repo/do-utils'
import { getEsiInstanceForCharacter, getPublicEsiInstance } from '@repo/esi'
import { logger } from '@repo/hono-helpers'

import type { Esi, EsiTypeResolver } from '@repo/esi'
import type { Env } from '../context'

const AUTH_CHARACTER_ID = '2114114257' // Test Auth character

/**
 * Module-level cache for all solar system names.
 * Loaded lazily on first search, persists for the Worker instance lifetime.
 */
let systemNamesCache: Array<{ id: number; name: string }> | null = null
let systemNamesCacheExpiry = 0

/**
 * ESI Location Search Result
 */
export interface EsiLocationSearchResult {
	id: string
	name: string
	systemId: string
	systemName: string
	regionId: string
	regionName: string
	type: 'system' | 'station' | 'structure'
}

/**
 * ESI System Details
 */
export interface EsiSystemDetails {
	system_id: number
	name: string
	constellation_id: number
	security_status: number
	star_id?: number
	stargates?: number[]
	stations?: number[]
}

/**
 * ESI Constellation Details
 */
export interface EsiConstellationDetails {
	constellation_id: number
	name: string
	region_id: number
}

/**
 * ESI Station Details
 */
export interface EsiStationDetails {
	station_id: number
	name: string
	system_id: number
	type_id?: number
	owner?: number
}

/**
 * ESI Structure Details
 */
export interface EsiStructureDetails {
	structure_id: number
	name: string
	solar_system_id: number
	type_id?: number
	owner_id?: number
}

/**
 * ESI Service
 *
 * Handles EVE ESI location searches and lookups through the shared ESI boundary.
 */
export class EsiService {
	private cache: Map<string, { data: unknown; expiresAt: number }>
	private readonly authenticatedEsi: Esi
	private readonly publicEsi: Esi
	private readonly typeResolver: EsiTypeResolver

	constructor(env: Env) {
		this.cache = new Map()
		this.authenticatedEsi = getEsiInstanceForCharacter(env.ESI, AUTH_CHARACTER_ID)
		this.publicEsi = getPublicEsiInstance(env.ESI)
		this.typeResolver = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')
	}

	/**
	 * Search for solar systems by name using a locally cached system name index.
	 * Loads all ~8500 system names from public ESI endpoints on first call,
	 * then filters locally for reliable substring matching.
	 */
	async searchSystems(query: string): Promise<EsiLocationSearchResult[]> {
		logger.info('searchSystems called', { query })

		if (!query || query.length < 2) {
			return []
		}

		try {
			const allSystems = await this.getAllSystemNames()
			const lowerQuery = query.toLowerCase()

			// Filter by substring match, limit to 20
			const matched = allSystems
				.filter((s) => s.name.toLowerCase().includes(lowerQuery))
				.slice(0, 20)

			if (matched.length === 0) {
				return []
			}

			// Enrich matched systems with constellation/region info
			const systemDetails = await Promise.all(
				matched.map((s) => this.getSystemDetails(s.id.toString()))
			)

			const constellationIds = [...new Set(systemDetails.map((s) => s.constellation_id.toString()))]
			const constellationDetails = await Promise.all(
				constellationIds.map((id) => this.getConstellationDetails(id))
			)
			const constellationMap = Object.fromEntries(
				constellationDetails.map((c) => [c.constellation_id, c])
			)

			const regionIds = [...new Set(constellationDetails.map((c) => c.region_id.toString()))]
			const regionNames = await this.getNames(regionIds.map((id) => parseInt(id)))

			return systemDetails.map((system) => {
				const constellation = constellationMap[system.constellation_id]
				return {
					id: system.system_id.toString(),
					name: system.name,
					systemId: system.system_id.toString(),
					systemName: system.name,
					regionId: constellation?.region_id.toString() || '0',
					regionName: regionNames[constellation?.region_id] || 'Unknown',
					type: 'system' as const,
				}
			})
		} catch (error) {
			logger.error('Error searching systems:', {
				error,
				message: error instanceof Error ? error.message : String(error),
			})
			return []
		}
	}

	/**
	 * Load all solar system names from ESI public endpoints.
	 * Caches in module-level variable for the Worker instance lifetime (1 hour refresh).
	 */
	private async getAllSystemNames(): Promise<Array<{ id: number; name: string }>> {
		if (systemNamesCache && systemNamesCacheExpiry > Date.now()) {
			return systemNamesCache
		}

		logger.info('Loading all system names from ESI...')

		// Step 1: Get all system IDs (public endpoint, no auth)
		const allIds = await this.publicEsi.fetchUniverseSolarSystemIds()
		logger.info('Loaded system IDs', { count: allIds.length })

		// Step 2: Resolve names in batches of 1000 via resolveIds
		const BATCH_SIZE = 1000
		const systems: Array<{ id: number; name: string }> = []

		for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
			const batch = allIds.slice(i, i + BATCH_SIZE)
			const nameMap = await this.typeResolver.resolveIds(batch.map(String))

			for (const [id, name] of Object.entries(nameMap)) {
				systems.push({ id: parseInt(id), name })
			}
		}

		logger.info('Loaded all system names', { count: systems.length })

		// Cache for 1 hour
		systemNamesCache = systems
		systemNamesCacheExpiry = Date.now() + 60 * 60 * 1000

		return systems
	}

	/**
	 * Search for NPC stations by name
	 */
	async searchStations(query: string): Promise<EsiLocationSearchResult[]> {
		if (!query || query.length < 2) {
			return []
		}

		try {
			const searchResponse = await this.authenticatedEsi.fetchCharacterSearch(AUTH_CHARACTER_ID, {
				categories: ['station'],
				search: query,
				strict: false,
			})
			logger.info('searchStations: got response', {
				stationCount: searchResponse.station?.length || 0,
			})

			if (!searchResponse.station || searchResponse.station.length === 0) {
				logger.info('searchStations: no results found')
				return []
			}

			// Get details for each station (batched)
			const stationIds = searchResponse.station.slice(0, 20) // Limit to 20 results
			const stationDetailsResults = await Promise.allSettled(
				stationIds.map((id) => this.getStationDetails(id.toString()))
			)

			// Filter out failed fetches
			const stationDetails = stationDetailsResults
				.filter(
					(result): result is PromiseFulfilledResult<EsiStationDetails> =>
						result.status === 'fulfilled'
				)
				.map((result) => result.value)

			if (stationDetails.length === 0) {
				logger.info('searchStations: no accessible stations found')
				return []
			}

			// Get system details to get region info
			const systemIds = [...new Set(stationDetails.map((s) => s.system_id))]
			const systemDetailsMap = await Promise.all(
				systemIds.map((id) => this.getSystemDetails(id.toString()))
			)
			const systemMap = Object.fromEntries(systemDetailsMap.map((s) => [s.system_id, s]))

			// Get constellation details to map to regions
			const constellationIds = [
				...new Set(systemDetailsMap.map((s) => s.constellation_id.toString())),
			]
			const constellationDetails = await Promise.all(
				constellationIds.map((id) => this.getConstellationDetails(id))
			)
			const constellationMap = Object.fromEntries(
				constellationDetails.map((c) => [c.constellation_id, c])
			)

			// Get region names
			const regionIds = [...new Set(constellationDetails.map((c) => c.region_id.toString()))]
			const regionNames = await this.getNames(regionIds.map((id) => parseInt(id)))

			return stationDetails.map((station) => {
				const system = systemMap[station.system_id]
				const constellation = system ? constellationMap[system.constellation_id] : undefined
				return {
					id: station.station_id.toString(),
					name: station.name,
					systemId: station.system_id.toString(),
					systemName: system?.name || 'Unknown',
					regionId: constellation?.region_id.toString() || '0',
					regionName: constellation ? regionNames[constellation.region_id] || 'Unknown' : 'Unknown',
					type: 'station' as const,
				}
			})
		} catch (error) {
			logger.error('Error searching stations:', {
				error,
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
			return []
		}
	}

	/**
	 * Search for player structures by name (requires authentication)
	 */
	async searchStructures(query: string): Promise<EsiLocationSearchResult[]> {
		if (!query || query.length < 2) {
			return []
		}

		try {
			const searchResponse = await this.authenticatedEsi.fetchCharacterSearch(AUTH_CHARACTER_ID, {
				categories: ['structure'],
				search: query,
				strict: false,
			})
			logger.info('searchStructures: got response', {
				structureCount: searchResponse.structure?.length || 0,
			})

			if (!searchResponse.structure || searchResponse.structure.length === 0) {
				logger.info('searchStructures: no results found')
				return []
			}

			// Get details for each structure (batched)
			const structureIds = searchResponse.structure.slice(0, 20) // Limit to 20 results
			const structureDetailsResults = await Promise.allSettled(
				structureIds.map((id) => this.getStructureDetails(id.toString()))
			)

			// Filter out failed fetches (403 Forbidden, etc.)
			const structureDetails = structureDetailsResults
				.filter(
					(result): result is PromiseFulfilledResult<EsiStructureDetails> =>
						result.status === 'fulfilled'
				)
				.map((result) => result.value)

			if (structureDetails.length === 0) {
				logger.info('searchStructures: no accessible structures found')
				return []
			}

			// Get system details to get region info
			const systemIds = [...new Set(structureDetails.map((s) => s.solar_system_id))]
			const systemDetailsMap = await Promise.all(
				systemIds.map((id) => this.getSystemDetails(id.toString()))
			)
			const systemMap = Object.fromEntries(systemDetailsMap.map((s) => [s.system_id, s]))

			// Get constellation details to map to regions
			const constellationIds = [
				...new Set(systemDetailsMap.map((s) => s.constellation_id.toString())),
			]
			const constellationDetails = await Promise.all(
				constellationIds.map((id) => this.getConstellationDetails(id))
			)
			const constellationMap = Object.fromEntries(
				constellationDetails.map((c) => [c.constellation_id, c])
			)

			// Get region names
			const regionIds = [...new Set(constellationDetails.map((c) => c.region_id.toString()))]
			const regionNames = await this.getNames(regionIds.map((id) => parseInt(id)))

			return structureDetails.map((structure) => {
				const system = systemMap[structure.solar_system_id]
				const constellation = system ? constellationMap[system.constellation_id] : undefined
				return {
					id: structure.structure_id.toString(),
					name: structure.name,
					systemId: structure.solar_system_id.toString(),
					systemName: system?.name || 'Unknown',
					regionId: constellation?.region_id.toString() || '0',
					regionName: constellation ? regionNames[constellation.region_id] || 'Unknown' : 'Unknown',
					type: 'structure' as const,
				}
			})
		} catch (error) {
			logger.error('Error searching structures:', {
				error,
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
			return []
		}
	}

	/**
	 * Get system details by ID
	 */
	async getSystemDetails(systemId: string): Promise<EsiSystemDetails> {
		const cacheKey = `system:${systemId}`
		const cached = this.cache.get(cacheKey)

		if (cached && cached.expiresAt > Date.now()) {
			return cached.data as EsiSystemDetails
		}

		const system = await this.publicEsi.fetchUniverseSolarSystem(systemId)
		const data: EsiSystemDetails = {
			system_id: system.solar_system_id,
			name: system.name,
			constellation_id: system.constellation_id,
			security_status: system.security_status,
			star_id: system.star_id,
			stargates: system.stargates,
			stations: system.stations,
		}

		// Cache for 30 minutes (systems are static)
		this.cache.set(cacheKey, {
			data,
			expiresAt: Date.now() + 30 * 60 * 1000,
		})

		return data
	}

	/**
	 * Get constellation details by ID
	 */
	async getConstellationDetails(constellationId: string): Promise<EsiConstellationDetails> {
		const cacheKey = `constellation:${constellationId}`
		const cached = this.cache.get(cacheKey)

		if (cached && cached.expiresAt > Date.now()) {
			return cached.data as EsiConstellationDetails
		}

		const data = await this.publicEsi.fetchUniverseConstellation(constellationId)

		// Cache for 30 minutes (constellations are static)
		this.cache.set(cacheKey, {
			data,
			expiresAt: Date.now() + 30 * 60 * 1000,
		})

		return data
	}

	/**
	 * Get station details by ID (requires authentication)
	 */
	async getStationDetails(stationId: string): Promise<EsiStationDetails> {
		const cacheKey = `station:${stationId}`
		const cached = this.cache.get(cacheKey)

		if (cached && cached.expiresAt > Date.now()) {
			return cached.data as EsiStationDetails
		}

		const station = await this.publicEsi.fetchUniverseStation(stationId)
		const data: EsiStationDetails = {
			station_id: station.station_id,
			name: station.name,
			system_id: station.solar_system_id,
			type_id: station.type_id,
			owner: station.owner,
		}

		// Cache for 30 minutes (stations are static)
		this.cache.set(cacheKey, {
			data,
			expiresAt: Date.now() + 30 * 60 * 1000,
		})

		return data
	}

	/**
	 * Get structure details by ID (requires authentication)
	 */
	async getStructureDetails(structureId: string): Promise<EsiStructureDetails> {
		const cacheKey = `structure:${structureId}`
		const cached = this.cache.get(cacheKey)

		if (cached && cached.expiresAt > Date.now()) {
			return cached.data as EsiStructureDetails
		}

		const structure = await this.authenticatedEsi.fetchStructureInfo(AUTH_CHARACTER_ID, structureId)
		if (!structure) {
			throw new Error(`Structure ${structureId} was not found or is inaccessible`)
		}
		const data: EsiStructureDetails = {
			structure_id: Number(structureId),
			name: structure.name,
			solar_system_id: Number(structure.solar_system_id),
			type_id: structure.type_id ? Number(structure.type_id) : undefined,
			owner_id: structure.owner_id ? Number(structure.owner_id) : undefined,
		}

		// Cache for 5 minutes (structures can change)
		this.cache.set(cacheKey, {
			data,
			expiresAt: Date.now() + 5 * 60 * 1000,
		})

		return data
	}

	/**
	 * Get names for a list of IDs (bulk lookup)
	 */
	private async getNames(ids: number[]): Promise<Record<number, string>> {
		if (ids.length === 0) {
			return {}
		}

		try {
			// Convert number IDs to strings for resolveIds
			const stringIds = ids.map((id) => id.toString())
			const names = await this.typeResolver.resolveIds(stringIds)

			// Convert back to number keys
			return Object.fromEntries(Object.entries(names).map(([id, name]) => [parseInt(id), name]))
		} catch (error) {
			logger.error('Error fetching names from EveTokenStore:', error)
			return {}
		}
	}
}
