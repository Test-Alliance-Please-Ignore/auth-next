/**
 * @repo/freight
 *
 * Shared types and interfaces for the Freight Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

import type {
	CreateFreightRouteInput,
	FreightRoute,
	FreightRouteStatus,
	UpdateFreightRouteInput,
} from './types'

/**
 * Public RPC interface for Freight Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Freight } from '@repo/freight'
 * import { getStub } from '@repo/do-utils'
 *
 * const stub = getStub<Freight>(env.FREIGHT, 'default')
 * const routes = await stub.listRoutes()
 * ```
 */
export interface Freight {
	/**
	 * Create a new freight route (admin only)
	 */
	createRoute(adminId: string, data: CreateFreightRouteInput): Promise<FreightRoute>

	/**
	 * Get a specific freight route by ID
	 */
	getRoute(routeId: string): Promise<FreightRoute | null>

	/**
	 * List freight routes with optional filters
	 */
	listRoutes(filters?: { status?: FreightRouteStatus }): Promise<FreightRoute[]>

	/**
	 * Update an existing freight route (admin only)
	 */
	updateRoute(adminId: string, routeId: string, data: UpdateFreightRouteInput): Promise<FreightRoute>

	/**
	 * Activate a freight route (admin only)
	 */
	activateRoute(adminId: string, routeId: string): Promise<FreightRoute>

	/**
	 * Deactivate a freight route (admin only)
	 */
	deactivateRoute(adminId: string, routeId: string): Promise<FreightRoute>
}

/**
 * Re-export types for consumers
 */
export type {
	CreateFreightRouteInput,
	FreightLocation,
	FreightRoute,
	FreightRouteStatus,
	UpdateFreightRouteInput,
} from './types'
