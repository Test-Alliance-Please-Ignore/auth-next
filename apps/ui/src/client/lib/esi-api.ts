/**
 * ESI API client methods
 * Provides access to EVE Online ESI endpoints via backend proxy
 */

import { ApiClient } from './api'

const ESI_API_BASE = '/esi'

export interface EsiLocationSearchResult {
	id: string
	name: string
	systemId: string
	systemName: string
	regionId: string
	regionName: string
	type: 'system' | 'station' | 'structure'
}

export interface EsiOrganizationSearchResult {
	id: string
	name: string
	ticker: string | null
	type: 'corporation' | 'alliance'
	parentAlliance: { id: string; name: string; ticker: string | null } | null
}

export interface EsiSystemDetails {
	system_id: number
	name: string
	constellation_id: number
	security_status: number
	star_id?: number
	stargates?: number[]
	stations?: number[]
}

export interface EsiCelestialOption {
	id: string
	name: string
	planetId?: string
}

export interface EsiStationDetails {
	station_id: number
	name: string
	system_id: number
	type_id?: number
	owner?: number
}

export class EsiApiClient extends ApiClient {
	/**
	 * Search for solar systems by name
	 */
	async searchSystems(query: string): Promise<EsiLocationSearchResult[]> {
		if (!query || query.length < 2) {
			return []
		}

		const params = new URLSearchParams()
		params.set('q', query)

		return this.get(`/universe/search/systems?${params.toString()}`)
	}

	/**
	 * Search for NPC stations by name
	 */
	async searchStations(query: string): Promise<EsiLocationSearchResult[]> {
		if (!query || query.length < 2) {
			return []
		}

		const params = new URLSearchParams()
		params.set('q', query)

		return this.get(`${ESI_API_BASE}/search/stations?${params.toString()}`)
	}

	/**
	 * Search for player structures by name
	 */
	async searchStructures(query: string): Promise<EsiLocationSearchResult[]> {
		if (!query || query.length < 2) {
			return []
		}

		const params = new URLSearchParams()
		params.set('q', query)

		return this.get(`${ESI_API_BASE}/search/structures?${params.toString()}`)
	}

	async searchOrganizations(query: string, strict = false): Promise<EsiOrganizationSearchResult[]> {
		if (!query || query.length < 2) return []
		const params = new URLSearchParams({ q: query })
		if (strict) params.set('strict', 'true')
		return this.get(`${ESI_API_BASE}/search/organizations?${params.toString()}`)
	}

	/**
	 * Search across all location types
	 */
	async searchLocations(query: string): Promise<EsiLocationSearchResult[]> {
		if (!query || query.length < 2) {
			return []
		}

		// Run searches in parallel
		const [systems, stations, structures] = await Promise.all([
			this.searchSystems(query),
			this.searchStations(query),
			this.searchStructures(query).catch(() => []), // Structures might fail without auth
		])

		// Combine and deduplicate results
		return [...systems, ...stations, ...structures]
	}

	/**
	 * Get system details by ID
	 */
	async getSystemDetails(systemId: string): Promise<EsiSystemDetails> {
		return this.get(`${ESI_API_BASE}/universe/systems/${systemId}`)
	}

	async getSystemCelestials(systemId: string): Promise<{
		planets: EsiCelestialOption[]
		moons: EsiCelestialOption[]
	}> {
		return this.get(`${ESI_API_BASE}/universe/systems/${systemId}/celestials`)
	}

	/**
	 * Get station details by ID
	 */
	async getStationDetails(stationId: string): Promise<EsiStationDetails> {
		return this.get(`${ESI_API_BASE}/universe/stations/${stationId}`)
	}
}

// Export singleton instance
export const esiApi = new EsiApiClient()
