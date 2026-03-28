/**
 * Freight route status
 */
export type FreightRouteStatus = 'active' | 'inactive'

/**
 * Freight route with full database fields
 */
export interface FreightRoute {
	id: string
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
	sortOrder: number
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
	sortOrder?: number
	status?: FreightRouteStatus
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
