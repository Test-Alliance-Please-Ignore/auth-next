/**
 * Freight API client methods
 * Extends the main API client with freight-specific methods
 */

import { ApiClient } from './api'

import type {
	CreateFreightRouteInput,
	FreightRoute,
	FreightRouteStatus,
	UpdateFreightRouteInput,
} from '@repo/freight'

const FREIGHT_API_BASE = '/freight'

/**
 * Enriched contract data returned by the API (with resolved names)
 */
export interface FreightContract {
	id: string
	corporationId: string
	contractId: string
	acceptorId: string | null
	assigneeId: string
	availability: string
	buyout: string | null
	collateral: string | null
	dateAccepted: string | null
	dateCompleted: string | null
	dateExpired: string
	dateIssued: string
	daysToComplete: number | null
	endLocationId: string | null
	forCorporation: boolean
	issuerCorporationId: string
	issuerId: string
	price: string | null
	reward: string | null
	startLocationId: string | null
	status: string
	title: string | null
	type: string
	volume: string | null
	updatedAt: string
	issuerName: string | null
	acceptorName: string | null
	startLocationName: string | null
	endLocationName: string | null
}

/**
 * Leaderboard entry returned by the API (with resolved names)
 */
export interface FreightLeaderboardEntry {
	acceptorId: string
	acceptorName: string | null
	contractsCompleted: number
	totalVolume: number
	totalReward: number
}

export class FreightApiClient extends ApiClient {
	/**
	 * List all freight routes
	 */
	async listRoutes(filters?: { status?: FreightRouteStatus }): Promise<FreightRoute[]> {
		const params = new URLSearchParams()
		if (filters?.status) params.set('status', filters.status)

		const query = params.toString()
		return this.get(`${FREIGHT_API_BASE}/routes${query ? `?${query}` : ''}`)
	}

	/**
	 * Get a specific freight route by ID
	 */
	async getRoute(routeId: string): Promise<FreightRoute> {
		return this.get(`${FREIGHT_API_BASE}/routes/${routeId}`)
	}

	/**
	 * Create a new freight route
	 */
	async createRoute(data: CreateFreightRouteInput): Promise<FreightRoute> {
		return this.post(`${FREIGHT_API_BASE}/routes`, data)
	}

	/**
	 * Update an existing freight route
	 */
	async updateRoute(routeId: string, data: UpdateFreightRouteInput): Promise<FreightRoute> {
		return this.put(`${FREIGHT_API_BASE}/routes/${routeId}`, data)
	}

	/**
	 * Activate a freight route
	 */
	async activateRoute(routeId: string): Promise<FreightRoute> {
		return this.post(`${FREIGHT_API_BASE}/routes/${routeId}/activate`)
	}

	/**
	 * Deactivate a freight route
	 */
	async deactivateRoute(routeId: string): Promise<FreightRoute> {
		return this.post(`${FREIGHT_API_BASE}/routes/${routeId}/deactivate`)
	}
	/**
	 * Delete a freight route
	 */
	async deleteRoute(routeId: string): Promise<void> {
		return this.delete(`${FREIGHT_API_BASE}/routes/${routeId}`)
	}

	/**
	 * List alliance courier contracts
	 */
	async listContracts(filters?: { status?: string }): Promise<FreightContract[]> {
		const params = new URLSearchParams()
		if (filters?.status) params.set('status', filters.status)
		const query = params.toString()
		return this.get(`${FREIGHT_API_BASE}/contracts${query ? `?${query}` : ''}`)
	}

	/**
	 * Get courier contract leaderboard
	 */
	async getLeaderboard(period?: '30d' | 'all'): Promise<FreightLeaderboardEntry[]> {
		const params = period && period !== 'all' ? `?period=${period}` : ''
		return this.get(`${FREIGHT_API_BASE}/leaderboard${params}`)
	}
}

// Export singleton instance
export const freightApi = new FreightApiClient()
