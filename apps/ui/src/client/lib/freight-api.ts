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

export type FreightLeaderboardPeriod = 'month' | 'previous-month' | 'all'

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

export type FreightContractSortKey =
	| 'pickup'
	| 'dropoff'
	| 'volume'
	| 'reward'
	| 'collateral'
	| 'daysToComplete'
	| 'expires'

export type FreightContractSortDirection = 'asc' | 'desc'

export interface FreightContractsPagination {
	page: number
	limit: number
	totalItems: number
	totalPages: number
	hasNextPage: boolean
	hasPreviousPage: boolean
}

export interface FreightContractsPage {
	items: FreightContract[]
	pagination: FreightContractsPagination
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

export interface FreightLeaderboard {
	entries: FreightLeaderboardEntry[]
	oldestContractDate: string | null
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
	async listContracts(filters?: {
		status?: string
		page?: number
		pageSize?: number
		sortBy?: FreightContractSortKey
		sortDirection?: FreightContractSortDirection
	}): Promise<FreightContractsPage> {
		const params = new URLSearchParams()
		if (filters?.status) params.set('status', filters.status)
		if (filters?.page !== undefined) params.set('page', String(filters.page))
		if (filters?.pageSize !== undefined) params.set('pageSize', String(filters.pageSize))
		if (filters?.sortBy) params.set('sortBy', filters.sortBy)
		if (filters?.sortDirection) params.set('sortDirection', filters.sortDirection)
		const query = params.toString()
		return this.get(`${FREIGHT_API_BASE}/contracts${query ? `?${query}` : ''}`)
	}

	/**
	 * Open a courier contract in the player's running EVE client (via ESI).
	 * Targets the user's main character.
	 */
	async openContractInGame(
		contractId: string
	): Promise<{ success: boolean; characterName: string }> {
		return this.post(`${FREIGHT_API_BASE}/contracts/${contractId}/open-in-game`)
	}

	/**
	 * Get courier contract leaderboard
	 */
	async getLeaderboard(period?: FreightLeaderboardPeriod): Promise<FreightLeaderboard> {
		const params = period && period !== 'all' ? `?period=${period}` : ''
		return this.get(`${FREIGHT_API_BASE}/leaderboard${params}`)
	}
}

// Export singleton instance
export const freightApi = new FreightApiClient()
