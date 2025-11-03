/**
 * @repo/markets
 *
 * Shared types and interfaces for the Markets Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

import type { GetRegionMarketDataInput, GetRegionMarketDataResponse } from './types'

/**
 * Public RPC interface for Markets Durable Object
 */
export interface Markets {
	// Add your RPC methods here
	getRegionMarketData(input: GetRegionMarketDataInput): Promise<GetRegionMarketDataResponse>
}

export type { GetRegionMarketDataInput, GetRegionMarketDataResponse } from './types'
