import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../context'

const AUTH_CHARACTER_ID = '2114114257' // Test Auth character

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
 * ESI Search Response
 */
interface EsiSearchResponse {
	solar_system?: number[]
	station?: number[]
	structure?: number[]
}

/**
 * ESI Service
 *
 * Handles interaction with EVE Online ESI API for location searches and lookups.
 * Uses EveTokenStore for ESI requests with built-in caching and authentication.
 */
export class EsiService {
	private cache: Map<string, { data: unknown; expiresAt: number }>
	private tokenStore: EveTokenStore

	constructor(env: Env) {
		this.cache = new Map()
		this.tokenStore = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	}

	/**
	 * Search for solar systems by name
	 */
	async searchSystems(query: string): Promise<EsiLocationSearchResult[]> {
		logger.info('searchSystems called', { query })

		if (!query || query.length < 2) {
			logger.info('searchSystems: query too short', { query })
			return []
		}

		try {
			// Search for systems using ESI character search endpoint
			const searchPath = `/latest/characters/${AUTH_CHARACTER_ID}/search/?categories=solar_system&search=${encodeURIComponent(query)}&strict=false`
			logger.info('searchSystems: calling fetchEsi', { searchPath, characterId: AUTH_CHARACTER_ID })

			const searchResult = await this.tokenStore.fetchEsi<EsiSearchResponse>(
				searchPath,
				AUTH_CHARACTER_ID
			)
			logger.info('searchSystems: got response', {
				cached: searchResult.cached,
				hasData: !!searchResult.data,
				solarSystemCount: searchResult.data.solar_system?.length || 0,
			})

			const searchResponse = searchResult.data

			if (!searchResponse.solar_system || searchResponse.solar_system.length === 0) {
				logger.info('searchSystems: no results found')
				return []
			}

			// Get details for each system (batched)
			const systemIds = searchResponse.solar_system.slice(0, 20) // Limit to 20 results
			logger.info('searchSystems: fetching system details', { systemIdCount: systemIds.length })

			const systemDetails = await Promise.all(
				systemIds.map((id) => this.getSystemDetails(id.toString()))
			)

			// Get constellation details to map to regions
			const constellationIds = [...new Set(systemDetails.map((s) => s.constellation_id.toString()))]
			logger.info('searchSystems: fetching constellation details', {
				constellationIdCount: constellationIds.length,
			})

			const constellationDetails = await Promise.all(
				constellationIds.map((id) => this.getConstellationDetails(id))
			)
			const constellationMap = Object.fromEntries(
				constellationDetails.map((c) => [c.constellation_id, c])
			)

			// Get region names
			const regionIds = [...new Set(constellationDetails.map((c) => c.region_id.toString()))]
			logger.info('searchSystems: resolving region names', { regionIdCount: regionIds.length })

			const regionNames = await this.getNames(regionIds.map((id) => parseInt(id)))

			const results = systemDetails.map((system) => {
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

			logger.info('searchSystems: returning results', { resultCount: results.length })
			return results
		} catch (error) {
			logger.error('Error searching systems:', {
				error,
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
			return []
		}
	}

	/**
	 * Search for NPC stations by name
	 */
	async searchStations(query: string): Promise<EsiLocationSearchResult[]> {
		if (!query || query.length < 2) {
			return []
		}

		try {
			// Search for stations using ESI character search endpoint
			const searchPath = `/latest/characters/${AUTH_CHARACTER_ID}/search/?categories=station&search=${encodeURIComponent(query)}&strict=false`
			logger.info('searchStations: calling fetchEsi', {
				searchPath,
				characterId: AUTH_CHARACTER_ID,
			})

			const searchResult = await this.tokenStore.fetchEsi<EsiSearchResponse>(
				searchPath,
				AUTH_CHARACTER_ID
			)
			logger.info('searchStations: got response', {
				cached: searchResult.cached,
				hasData: !!searchResult.data,
				stationCount: searchResult.data.station?.length || 0,
			})

			const searchResponse = searchResult.data

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
			// Search for structures using ESI character search endpoint
			const searchPath = `/latest/characters/${AUTH_CHARACTER_ID}/search/?categories=structure&search=${encodeURIComponent(query)}&strict=false`
			logger.info('searchStructures: calling fetchEsi', {
				searchPath,
				characterId: AUTH_CHARACTER_ID,
			})

			const searchResult = await this.tokenStore.fetchEsi<EsiSearchResponse>(
				searchPath,
				AUTH_CHARACTER_ID
			)
			logger.info('searchStructures: got response', {
				cached: searchResult.cached,
				hasData: !!searchResult.data,
				structureCount: searchResult.data.structure?.length || 0,
			})

			const searchResponse = searchResult.data

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

		const path = `/latest/universe/systems/${systemId}/`
		const result = await this.tokenStore.fetchPublicEsi<EsiSystemDetails>(path)
		const data = result.data

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

		const path = `/latest/universe/constellations/${constellationId}/`
		const result = await this.tokenStore.fetchPublicEsi<EsiConstellationDetails>(path)
		const data = result.data

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

		const path = `/latest/universe/stations/${stationId}/`
		const result = await this.tokenStore.fetchEsi<EsiStationDetails>(path, AUTH_CHARACTER_ID)
		const data = result.data

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

		const path = `/latest/universe/structures/${structureId}/`
		const result = await this.tokenStore.fetchEsi<EsiStructureDetails>(path, AUTH_CHARACTER_ID)
		const data = result.data

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
			const names = await this.tokenStore.resolveIds(stringIds)

			// Convert back to number keys
			return Object.fromEntries(Object.entries(names).map(([id, name]) => [parseInt(id), name]))
		} catch (error) {
			logger.error('Error fetching names from EveTokenStore:', error)
			return {}
		}
	}
}
