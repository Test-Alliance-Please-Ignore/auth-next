/**
 * Inventory API client methods
 * Extends the main API client with inventory parsing methods
 */

import { ApiClient } from './api'

import type { InventoryParseResult } from '@repo/eve-types'

const INVENTORY_API_BASE = '/inventory'

export class InventoryApiClient extends ApiClient {
	/**
	 * Parse inventory text and return detailed item information
	 */
	async parseInventory(inventoryText: string): Promise<InventoryParseResult> {
		return this.post(`${INVENTORY_API_BASE}/parse`, { inventoryText })
	}
}

// Export singleton instance
export const inventoryApi = new InventoryApiClient()
