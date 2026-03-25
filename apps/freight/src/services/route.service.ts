import { and, eq } from '@repo/db-utils'

import { freightRoutes } from '../db/schema'
import { generateUuidV7 } from '../utils/uuid'

import type {
	CreateFreightRouteInput,
	FreightRoute,
	FreightRouteStatus,
	UpdateFreightRouteInput,
} from '@repo/freight'
import type { FreightDb } from '../db'

/**
 * Route Service
 *
 * Handles freight route operations including:
 * - Creation, updates, and deletions
 * - Route status management (active/inactive)
 * - Route lookups and filtering
 */
export class RouteService {
	constructor(private db: FreightDb) {}

	/**
	 * Create a new freight route
	 */
	async createRoute(_adminId: string, data: CreateFreightRouteInput): Promise<FreightRoute> {
		console.log('[RouteService.createRoute] Starting route creation', { data })

		try {
			const routeId = generateUuidV7()

			console.log('[RouteService.createRoute] Generated route ID', { routeId })

			const insertData = {
				id: routeId,
				pickupSystemId: data.pickupLocation.solarSystemId,
				pickupRegionId: data.pickupLocation.regionId,
				pickupStructureId: data.pickupLocation.structureId,
				pickupConstellationId: data.pickupLocation.constellationId || null,
				destinationSystemId: data.dropoffLocation.solarSystemId,
				destinationRegionId: data.dropoffLocation.regionId,
				destinationStructureId: data.dropoffLocation.structureId,
				destinationConstellationId: data.dropoffLocation.constellationId || null,
				iskPerVolumeUnit: data.iskPerVolumeUnit,
				maxVolume: data.maxVolume || null,
				collateralFeeRate: data.collateralFeeRate || null,
				expiration: data.expiration || null,
				daysToComplete: data.daysToComplete || null,
				notes: data.notes || null,
				status: data.status || ('active' as const),
			}

			console.log('[RouteService.createRoute] Insert data prepared', insertData)

			const [route] = await this.db.insert(freightRoutes).values(insertData).returning()

			console.log('[RouteService.createRoute] Route inserted successfully', { routeId: route.id })

			const response = this.toFreightRouteResponse(route)
			console.log('[RouteService.createRoute] Returning response', { routeId: response.id })

			return response
		} catch (error) {
			console.error('[RouteService.createRoute] Error creating route', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				data,
			})
			throw error
		}
	}

	/**
	 * Get a specific freight route by ID
	 */
	async getRoute(routeId: string): Promise<FreightRoute | null> {
		const route = await this.db.query.freightRoutes.findFirst({
			where: eq(freightRoutes.id, routeId),
		})

		if (!route) {
			return null
		}

		return this.toFreightRouteResponse(route)
	}

	/**
	 * List freight routes with optional filters
	 */
	async listRoutes(filters?: { status?: FreightRouteStatus }): Promise<FreightRoute[]> {
		const conditions = []

		// Apply status filter if provided
		if (filters?.status) {
			conditions.push(eq(freightRoutes.status, filters.status))
		}

		const results = await this.db.query.freightRoutes.findMany({
			where: conditions.length > 0 ? and(...conditions) : undefined,
			orderBy: (freightRoutes, { desc }) => [desc(freightRoutes.createdAt)],
		})

		return results.map((route) => this.toFreightRouteResponse(route))
	}

	/**
	 * Update an existing freight route
	 */
	async updateRoute(
		_adminId: string,
		routeId: string,
		data: UpdateFreightRouteInput
	): Promise<FreightRoute> {
		console.log('[RouteService.updateRoute] Starting route update', { routeId, data })

		// Check if route exists
		const existingRoute = await this.db.query.freightRoutes.findFirst({
			where: eq(freightRoutes.id, routeId),
		})

		if (!existingRoute) {
			throw new Error('Route not found')
		}

		// Build update data object
		const updateData: Record<string, unknown> = {
			updatedAt: new Date(),
		}

		if (data.pickupLocation) {
			updateData.pickupSystemId = data.pickupLocation.solarSystemId
			updateData.pickupRegionId = data.pickupLocation.regionId
			updateData.pickupStructureId = data.pickupLocation.structureId
			updateData.pickupConstellationId = data.pickupLocation.constellationId || null
		}

		if (data.dropoffLocation) {
			updateData.destinationSystemId = data.dropoffLocation.solarSystemId
			updateData.destinationRegionId = data.dropoffLocation.regionId
			updateData.destinationStructureId = data.dropoffLocation.structureId
			updateData.destinationConstellationId = data.dropoffLocation.constellationId || null
		}

		if (data.iskPerVolumeUnit !== undefined) {
			updateData.iskPerVolumeUnit = data.iskPerVolumeUnit
		}

		if (data.maxVolume !== undefined) {
			updateData.maxVolume = data.maxVolume
		}

		if (data.notes !== undefined) {
			updateData.notes = data.notes
		}

		if (data.collateralFeeRate !== undefined) {
			updateData.collateralFeeRate = data.collateralFeeRate
		}

		if (data.expiration !== undefined) {
			updateData.expiration = data.expiration
		}

		if (data.daysToComplete !== undefined) {
			updateData.daysToComplete = data.daysToComplete
		}

		if (data.status !== undefined) {
			updateData.status = data.status
		}

		console.log('[RouteService.updateRoute] Update data prepared', updateData)

		const [updated] = await this.db
			.update(freightRoutes)
			.set(updateData)
			.where(eq(freightRoutes.id, routeId))
			.returning()

		console.log('[RouteService.updateRoute] Route updated successfully', { routeId: updated.id })

		return this.toFreightRouteResponse(updated)
	}

	/**
	 * Activate a freight route (set status to active)
	 */
	async activateRoute(adminId: string, routeId: string): Promise<FreightRoute> {
		console.log('[RouteService.activateRoute] Activating route', { routeId, adminId })
		return this.updateRoute(adminId, routeId, { status: 'active' })
	}

	/**
	 * Deactivate a freight route (set status to inactive)
	 */
	async deactivateRoute(adminId: string, routeId: string): Promise<FreightRoute> {
		console.log('[RouteService.deactivateRoute] Deactivating route', { routeId, adminId })
		return this.updateRoute(adminId, routeId, { status: 'inactive' })
	}

	/**
	 * Convert database record to FreightRoute response type
	 */
	private toFreightRouteResponse(route: typeof freightRoutes.$inferSelect): FreightRoute {
		return {
			id: route.id,
			pickupLocation: {
				solarSystemId: route.pickupSystemId as any,
				regionId: route.pickupRegionId as any,
				structureId: route.pickupStructureId as any,
				constellationId: route.pickupConstellationId as any,
			},
			dropoffLocation: {
				solarSystemId: route.destinationSystemId as any,
				regionId: route.destinationRegionId as any,
				structureId: route.destinationStructureId as any,
				constellationId: route.destinationConstellationId as any,
			},
			iskPerVolumeUnit: route.iskPerVolumeUnit,
			maxVolume: route.maxVolume || undefined,
			collateralFeeRate: route.collateralFeeRate || undefined,
			expiration: route.expiration || undefined,
			daysToComplete: route.daysToComplete || undefined,
			notes: route.notes || undefined,
			status: route.status,
			createdAt: route.createdAt,
			updatedAt: route.updatedAt,
		}
	}
}
