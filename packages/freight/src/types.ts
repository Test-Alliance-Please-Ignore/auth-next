import type { EveConstellationId, EveRegionId, EveStructureId, EveSystemId } from '@repo/eve-types'

/**
 * Freight location (legacy - used by LocationDisplay component)
 */
export interface FreightLocation {
	solarSystemId: EveSystemId
	regionId: EveRegionId
	structureId: EveStructureId
	constellationId?: EveConstellationId
}

/**
 * Freight route status
 */
export type FreightRouteStatus = 'active' | 'inactive'

/**
 * Result of asking ESI to open a freight contract in the running client.
 */
export type FreightOpenContractResult =
	| {
			success: true
			characterName: string
	  }
	| {
			success: false
			error: 'token_unavailable' | 'scope_missing' | 'client_unreachable' | 'esi_rate_limited'
			message: string
			characterName: string
	  }

/**
 * Freight route with full database fields
 */
export interface FreightRoute {
	id: string
	pickupName: string
	destinationName: string
	pickupSystemId?: string
	destinationSystemId?: string
	iskPerVolumeUnit: string // ISK per m³, stored as string to avoid BigInt issues
	minReward?: string // Minimum contract reward (ISK), stored as string
	maxVolume?: string // Optional maximum volume (m³) per contract
	collateralFeeRate?: string // Collateral fee as decimal (e.g. "0.01" = 1%)
	expiration?: number // Days until contract expires (e.g. 7)
	daysToComplete?: number // Days for hauler to complete (e.g. 3)
	notes?: string // Admin notes about route restrictions, risks, or special handling
	sortOrder: number // Display order (lower numbers appear first)
	status: FreightRouteStatus
	createdAt: Date
	updatedAt: Date
}

/**
 * Input for creating a new freight route (admin action)
 */
export interface CreateFreightRouteInput {
	pickupName: string
	destinationName: string
	pickupSystemId?: string
	destinationSystemId?: string
	iskPerVolumeUnit: string
	minReward?: string
	maxVolume?: string
	collateralFeeRate?: string
	expiration?: number
	daysToComplete?: number
	notes?: string
	sortOrder?: number // Display order (lower numbers appear first, default 0)
	status?: FreightRouteStatus // Defaults to 'active' if not specified
}

/**
 * Input for updating an existing freight route (admin action)
 * All fields are optional - only provided fields will be updated
 */
export interface UpdateFreightRouteInput {
	pickupName?: string
	destinationName?: string
	pickupSystemId?: string
	destinationSystemId?: string
	iskPerVolumeUnit?: string
	minReward?: string
	maxVolume?: string
	collateralFeeRate?: string
	expiration?: number
	daysToComplete?: number
	notes?: string
	sortOrder?: number
	status?: FreightRouteStatus
}
