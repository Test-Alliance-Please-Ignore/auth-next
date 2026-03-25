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
}

// Export singleton instance
export const freightApi = new FreightApiClient()
