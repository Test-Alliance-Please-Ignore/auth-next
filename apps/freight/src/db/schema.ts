import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Freight route status enum
 *
 * - active: Route is available for use
 * - inactive: Route is temporarily disabled
 */
export const freightRouteStatusEnum = pgEnum('freight_route_status', ['active', 'inactive'])

/**
 * Freight Routes table
 *
 * Admin-defined official freight routes with pickup/destination locations and pricing.
 *
 * Note: Location names are fetched from ESI dynamically using the stored IDs.
 * - Systems: /universe/systems/{system_id}/
 * - Structures: /universe/structures/{structure_id}/
 * - Regions: /universe/regions/{region_id}/
 */
export const freightRoutes = pgTable(
	'freight_routes',
	{
		id: uuid('id').defaultRandom().primaryKey(),

		// Pickup location
		pickupSystemId: text('pickup_system_id').notNull(),
		pickupRegionId: text('pickup_region_id').notNull(),
		pickupStructureId: text('pickup_structure_id').notNull(),
		pickupConstellationId: text('pickup_constellation_id'),

		// Destination location
		destinationSystemId: text('destination_system_id').notNull(),
		destinationRegionId: text('destination_region_id').notNull(),
		destinationStructureId: text('destination_structure_id').notNull(),
		destinationConstellationId: text('destination_constellation_id'),

		// Pricing and constraints
		iskPerVolumeUnit: text('isk_per_volume_unit').notNull(), // ISK per m³, stored as text to avoid BigInt issues
		maxVolume: text('max_volume'), // Optional maximum volume (m³) per contract

		// Metadata
		notes: text('notes'), // Admin notes about route restrictions, risks, or special handling
		status: freightRouteStatusEnum('status').notNull().default('active'),

		// Timestamps
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow(),
	},
	(table) => [
		index('freight_routes_status_idx').on(table.status),
		index('freight_routes_pickup_system_id_idx').on(table.pickupSystemId),
		index('freight_routes_destination_system_id_idx').on(table.destinationSystemId),
		index('freight_routes_created_at_idx').on(table.createdAt),
	]
)

/**
 * Export schema for Drizzle queries
 */
export const schema = {
	freightRoutes,
}
