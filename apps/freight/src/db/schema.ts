import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

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
 * Location names are stored as free text set by admins.
 */
export const freightRoutes = pgTable(
	'freight_routes',
	{
		id: uuid('id').defaultRandom().primaryKey(),

		// Location names (admin-set free text)
		pickupName: text('pickup_name').notNull().default(''),
		destinationName: text('destination_name').notNull().default(''),

		// Legacy location IDs (nullable, kept for backward compatibility)
		pickupSystemId: text('pickup_system_id'),
		pickupRegionId: text('pickup_region_id'),
		pickupStructureId: text('pickup_structure_id'),
		pickupConstellationId: text('pickup_constellation_id'),
		destinationSystemId: text('destination_system_id'),
		destinationRegionId: text('destination_region_id'),
		destinationStructureId: text('destination_structure_id'),
		destinationConstellationId: text('destination_constellation_id'),

		// Pricing and constraints
		iskPerVolumeUnit: text('isk_per_volume_unit').notNull(), // ISK per m³, stored as text to avoid BigInt issues
		minReward: text('min_reward'), // Minimum contract reward (ISK), stored as text
		maxVolume: text('max_volume'), // Optional maximum volume (m³) per contract
		collateralFeeRate: text('collateral_fee_rate'), // Collateral fee as decimal (e.g. "0.01" = 1%)

		// Contract defaults
		expiration: integer('expiration'), // Days until contract expires (e.g. 7)
		daysToComplete: integer('days_to_complete'), // Days for hauler to complete (e.g. 3)

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
