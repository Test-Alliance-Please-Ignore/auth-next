/**
 * @repo/markets
 *
 * Shared types and interfaces for the Markets Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

import type {
	GetBatchMarketDataAtTimeInput,
	GetBatchMarketDataInput,
	GetBatchMarketDataResponse,
	GetRegionMarketDataInput,
	GetRegionMarketDataResponse,
} from './types'

/**
 * Public RPC interface for Markets Durable Object
 */
export interface Markets {
	/**
	 * Get market data for a region, optionally filtered by type and order type
	 * @param input - Query parameters
	 * @returns Array of market orders
	 */
	getRegionMarketData(input: GetRegionMarketDataInput): Promise<GetRegionMarketDataResponse>

	/**
	 * Get latest prices for multiple items at once (up to 500 items)
	 * Optimized for batch lookups with ~20-50ms response time
	 * @param input - Region and array of type IDs
	 * @returns Latest price summary per item and list of missing type IDs
	 */
	getBatchMarketData(input: GetBatchMarketDataInput): Promise<GetBatchMarketDataResponse>

	/**
	 * Get prices for multiple items at a specific point in time (up to 500 items)
	 * Used for time-relative SRP valuations — prices reflect the market at the moment of loss.
	 *
	 * Two-tier lookup:
	 * - atTime within raw snapshot window (≤7 days): queries market_orders for closest snapshot
	 * - atTime older than raw window: queries market_daily_prices for the nearest day's average
	 *
	 * The snapshotTime in the response reflects the actual data source timestamp used.
	 * @param input - Region, array of type IDs, and target timestamp
	 * @returns Price summary per item (bestSellPrice = best sell at that time) and missing type IDs
	 */
	getBatchMarketDataAtTime(
		input: GetBatchMarketDataAtTimeInput
	): Promise<GetBatchMarketDataResponse>

	/**
	 * Start automatic hourly snapshots for a region
	 * Takes an immediate snapshot, then schedules hourly snapshots via alarm
	 * @param regionId - EVE region ID to monitor
	 */
	startHourlySnapshots(regionId: string): Promise<void>

	/**
	 * Stop automatic hourly snapshots for a location
	 * Cancels the alarm and disables monitoring
	 * @param locationId - Location ID (region or structure) to stop monitoring
	 */
	stopHourlySnapshots(locationId: string): Promise<void>

	/**
	 * Get alarm status and configuration
	 * @returns Alarm status including location ID, type, and next alarm time
	 */
	getAlarmStatus(): Promise<{
		isActive: boolean
		locationId: string | null
		locationType: 'region' | 'structure' | null
		characterId: string | null
		nextAlarmTime: number | null
	}>

	/**
	 * Get list of locations with recent snapshots
	 * Used for discovering active monitors across all Durable Object instances
	 * @returns Array of location IDs and types that have had snapshots in the last 24 hours
	 */
	getActiveMonitors(): Promise<
		Array<{
			locationId: string
			locationType: 'region' | 'structure'
		}>
	>

	/**
	 * Start automatic hourly snapshots for a structure
	 * Takes an immediate snapshot, then schedules hourly snapshots via alarm
	 * @param structureId - EVE structure ID to monitor
	 * @param characterId - Character ID for authentication (required for structure access)
	 */
	startHourlySnapshotsForStructure(structureId: string, characterId: string): Promise<void>

	/**
	 * Get CCP universe-wide average prices for the requested type IDs at a given date.
	 *
	 * Two-tier lookup:
	 * - Historic: queries market_daily_prices (locationId='universe') for the exact priceDate
	 * - Fallback: serves from the ESI DO price cache if no DB row exists for that date
	 *
	 * Each returned item includes a `source` field so callers can surface a warning when
	 * historic data was unavailable and fallback cache was used instead.
	 *
	 * @param typeIds - EVE type IDs to look up
	 * @param priceDate - Target date in YYYY-MM-DD format (date of loss for SRP)
	 */
	getMarketPricesForTypes(
		typeIds: string[],
		priceDate: string
	): Promise<
		Array<{
			typeId: string
			averagePrice: number | null
			adjustedPrice: number | null
			source: 'historic' | 'fallback'
		}>
	>

	/**
	 * Get platinum insurance prices for the requested ship type IDs at a given date.
	 *
	 * Two-tier lookup:
	 * - Historic: queries insurance_daily_prices for the nearest snapshot on or before priceDate
	 * - Fallback: serves from the ESI DO insurance cache if no DB row exists
	 *
	 * Each returned item includes a `source` field so callers can surface a warning when
	 * historic data was unavailable and fallback cache was used instead.
	 *
	 * @param typeIds - EVE ship type IDs to look up
	 * @param priceDate - Target date in YYYY-MM-DD format (date of loss for SRP)
	 */
	getInsurancePricesForTypes(
		typeIds: string[],
		priceDate: string
	): Promise<
		Array<{
			typeId: string
			platinumCost: number | null
			platinumPayout: number | null
			source: 'historic' | 'fallback'
		}>
	>

	/**
	 * HTTP fetch handler for the Durable Object
	 * Handles direct HTTP requests to the DO (for alarm management endpoints)
	 * @param request - HTTP request
	 * @returns HTTP response
	 */
	fetch(request: any): Promise<any>
}

export type {
	GetBatchMarketDataAtTimeInput,
	GetBatchMarketDataInput,
	GetBatchMarketDataResponse,
	GetRegionMarketDataInput,
	GetRegionMarketDataResponse,
	GetRegionMarketDataResponseObject,
	LatestMarketPrice,
} from './types'

export { GetRegionMarketDataResponseObjectSchema, GetRegionMarketDataResponseSchema } from './types'
