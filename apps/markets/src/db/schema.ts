import { boolean, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

/**
 * Database schema for the markets worker
 *
 * Stores EVE Online market data as time-series snapshots for historical analysis.
 * Design optimized for:
 * - Point-in-time queries (get market state at specific time)
 * - Time-range aggregations (price trends, volume analysis)
 * - Batch lookups (up to 500 items efficiently)
 * - Region + Type filtered queries (most common pattern)
 */

// ============================================================================
// MARKET SNAPSHOTS
// ============================================================================

/**
 * Market snapshots - Metadata about when market data was captured
 * Each snapshot represents a complete capture of market data for a location (region or structure)
 */
export const marketSnapshots = pgTable(
	'market_snapshots',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		locationId: text('location_id').notNull(), // EVE region ID or structure ID
		locationType: text('location_type').notNull().$type<'region' | 'structure'>(),
		snapshotTime: timestamp('snapshot_time', { withTimezone: true }).notNull(),
		status: text('status').notNull().$type<'pending' | 'complete' | 'failed'>(),
		orderCount: integer('order_count').default(0).notNull(), // Total orders in snapshot
		errorMessage: text('error_message'), // If status = 'failed'
		fetchDurationMs: integer('fetch_duration_ms'), // Performance tracking
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		// Primary query pattern: find snapshots by location + time range
		index('market_snapshots_location_time_idx').on(table.locationId, table.snapshotTime.desc()),
		// For finding latest complete snapshot
		index('market_snapshots_location_status_time_idx').on(
			table.locationId,
			table.status,
			table.snapshotTime.desc()
		),
	]
)

// ============================================================================
// MARKET ORDERS
// ============================================================================

/**
 * Market orders - Individual market orders from snapshots
 * Denormalized for query performance (includes source location for direct filtering)
 */
export const marketOrders = pgTable(
	'market_orders',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		snapshotId: uuid('snapshot_id')
			.notNull()
			.references(() => marketSnapshots.id, { onDelete: 'cascade' }),

		// Denormalized fields for efficient filtering
		sourceLocationId: text('source_location_id').notNull(), // Region or structure ID from parent snapshot
		sourceLocationType: text('source_location_type').notNull().$type<'region' | 'structure'>(),
		snapshotTime: timestamp('snapshot_time', { withTimezone: true }).notNull(), // From parent snapshot

		// Order details from ESI API
		orderId: text('order_id').notNull(), // ESI order ID
		typeId: text('type_id').notNull(), // Item type ID
		locationId: text('location_id').notNull(), // Station/structure ID where order is placed
		systemId: text('system_id').notNull(), // Solar system ID

		// Price and volume (stored as text to avoid BigInt serialization issues)
		price: text('price').notNull(), // Price per unit in ISK
		volumeRemain: text('volume_remain').notNull(),
		volumeTotal: text('volume_total').notNull(),
		minVolume: text('min_volume').notNull(),

		// Order characteristics
		isBuyOrder: boolean('is_buy_order').notNull(),
		duration: integer('duration').notNull(), // Days
		issued: timestamp('issued', { withTimezone: true }).notNull(),
		range: text('range')
			.notNull()
			.$type<
				'station' | 'solarsystem' | 'region' | '1' | '2' | '3' | '4' | '5' | '10' | '20' | '30' | '40'
			>(),

		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		// PRIMARY QUERY PATTERN: Filter by source location + type + time range
		// This is the most common query: "Show me price history for Tritanium in Jita"
		index('market_orders_source_type_time_idx').on(
			table.sourceLocationId,
			table.typeId,
			table.snapshotTime.desc()
		),

		// For buy vs sell analysis
		index('market_orders_source_type_buy_time_idx').on(
			table.sourceLocationId,
			table.typeId,
			table.isBuyOrder,
			table.snapshotTime.desc()
		),

		// For finding all orders in a snapshot (bulk operations)
		index('market_orders_snapshot_idx').on(table.snapshotId),

		// For station/structure-specific queries (e.g., "all orders at this specific station")
		index('market_orders_location_type_time_idx').on(
			table.locationId,
			table.typeId,
			table.snapshotTime.desc()
		),

		// For detecting duplicate orders across snapshots
		index('market_orders_order_snapshot_idx').on(table.orderId, table.snapshotId),
	]
)

// ============================================================================
// LATEST MARKET PRICES (Materialized View)
// ============================================================================

/**
 * Latest market prices - Pre-computed best prices per item
 * Optimized for batch lookups (up to 500 items in ~20-50ms)
 * Updated automatically when new snapshots complete
 */
export const latestMarketPrices = pgTable(
	'latest_market_prices',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		locationId: text('location_id').notNull(), // Region or structure ID
		locationType: text('location_type').notNull().$type<'region' | 'structure'>(),
		typeId: text('type_id').notNull(),

		// Latest snapshot info
		snapshotId: uuid('snapshot_id').notNull(),
		snapshotTime: timestamp('snapshot_time', { withTimezone: true }).notNull(),

		// Best buy order (highest price)
		bestBuyPrice: text('best_buy_price'),
		bestBuyOrderId: text('best_buy_order_id'),
		bestBuyLocation: text('best_buy_location'),
		bestBuyVolume: text('best_buy_volume'),
		totalBuyVolume: text('total_buy_volume').default('0').notNull(),
		buyOrderCount: integer('buy_order_count').default(0).notNull(),

		// Best sell order (lowest price)
		bestSellPrice: text('best_sell_price'),
		bestSellOrderId: text('best_sell_order_id'),
		bestSellLocation: text('best_sell_location'),
		bestSellVolume: text('best_sell_volume'),
		totalSellVolume: text('total_sell_volume').default('0').notNull(),
		sellOrderCount: integer('sell_order_count').default(0).notNull(),

		// Spread metrics
		spreadAmount: text('spread_amount'),
		spreadPercent: text('spread_percent'),

		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		// Primary lookup index for batch queries (handles 500-item IN clauses efficiently)
		index('latest_prices_location_idx').on(table.locationId),

		// Composite index for single-item and batch queries
		index('latest_prices_location_type_idx').on(table.locationId, table.typeId),

		// Unique constraint to prevent duplicates
		unique('latest_prices_location_type_unique').on(table.locationId, table.typeId),
	]
)

// ============================================================================
// API KEYS
// ============================================================================

/**
 * API keys - Authentication tokens for third-party API access
 * Used for read-only access to market data via REST API
 */
export const apiKeys = pgTable(
	'api_keys',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		key: text('key').notNull(), // The actual API key (bearer token)
		name: text('name').notNull(), // Descriptive name for the key
		description: text('description'), // Optional description
		isActive: boolean('is_active').default(true).notNull(), // Can be disabled without deletion

		// Usage tracking
		requestCount: integer('request_count').default(0).notNull(), // Total requests made
		totalBandwidth: text('total_bandwidth').default('0').notNull(), // Total bytes served (as text for large numbers)
		lastUsedAt: timestamp('last_used_at', { withTimezone: true }), // Last successful request

		// Metadata
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		// Primary lookup pattern: validate key on every request
		unique('api_keys_key_unique').on(table.key),

		// For listing active keys
		index('api_keys_active_idx').on(table.isActive),
	]
)
