import * as z from 'zod'

import { EveRegionId, EveTypeId } from '@repo/eve-types'

// ============================================================================
// Single/Filtered Market Data Query
// ============================================================================

export interface GetRegionMarketDataInput {
	regionId: EveRegionId
	typeId?: EveTypeId
	orderType?: 'buy' | 'sell' | 'all'
	useCachedData?: boolean
}

// ============================================================================
// Batch Market Data Query (up to 500 items)
// ============================================================================

export interface GetBatchMarketDataInput {
	regionId: EveRegionId
	typeIds: EveTypeId[] // Max 500 items
	useCachedData?: boolean
}

export const GetRegionMarketDataResponseObjectSchema = z.object({
	duration: z.coerce.string().transform((val) => parseInt(val)),
	is_buy_order: z.boolean(),
	issued: z.coerce.string().transform((val) => new Date(val)),
	location_id: z.coerce.string(),
	min_volume: z.coerce.string(),
	order_id: z.coerce.string(),
	price: z.coerce.string().transform((val) => parseFloat(val)),
	range: z.enum([
		'station',
		'solarsystem',
		'region',
		'1',
		'2',
		'3',
		'4',
		'5',
		'10',
		'20',
		'30',
		'40',
	]),
	system_id: z.coerce.string(),
	type_id: z.coerce.string(),
	volume_remain: z.coerce.string(),
	volume_total: z.coerce.string(),
})

export type GetRegionMarketDataResponseObject = z.infer<
	typeof GetRegionMarketDataResponseObjectSchema
>

export const GetRegionMarketDataResponseSchema = z.array(GetRegionMarketDataResponseObjectSchema)
export type GetRegionMarketDataResponse = z.infer<typeof GetRegionMarketDataResponseSchema>

// ============================================================================
// Batch Market Data Response
// ============================================================================

/**
 * Latest market price summary for a single item
 * Includes best buy/sell prices, volumes, and spread metrics
 */
export interface LatestMarketPrice {
	typeId: string
	snapshotTime: Date

	// Best buy order (highest price)
	bestBuyPrice: string | null
	bestBuyOrderId: string | null
	bestBuyLocation: string | null
	bestBuyVolume: string | null
	totalBuyVolume: string
	buyOrderCount: number

	// Best sell order (lowest price)
	bestSellPrice: string | null
	bestSellOrderId: string | null
	bestSellLocation: string | null
	bestSellVolume: string | null
	totalSellVolume: string
	sellOrderCount: number

	// Spread metrics
	spreadAmount: string | null
	spreadPercent: string | null
}

/**
 * Response for batch market data queries
 * Includes both found prices and list of missing type IDs
 */
export interface GetBatchMarketDataResponse {
	prices: LatestMarketPrice[]
	missingTypeIds: string[]
}
