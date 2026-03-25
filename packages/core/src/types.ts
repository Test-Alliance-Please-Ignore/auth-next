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
	iskPerVolumeUnit: string
	maxVolume?: string
	notes?: string
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
	iskPerVolumeUnit: string
	maxVolume?: string
	notes?: string
	status?: FreightRouteStatus
}

/**
 * Input for updating an existing freight route (admin action)
 * All fields are optional - only provided fields will be updated
 */
export interface UpdateFreightRouteInput {
	pickupName?: string
	destinationName?: string
	iskPerVolumeUnit?: string
	maxVolume?: string
	notes?: string
	status?: FreightRouteStatus
}
