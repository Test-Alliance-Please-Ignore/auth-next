/**
 * React Query hooks for inventory parsing
 */

import { useMutation } from '@tanstack/react-query'

import { inventoryApi } from '../lib/inventory-api'

import type { InventoryParseResult } from '@repo/eve-types'

/**
 * Query keys for inventory parsing cache management
 */
export const inventoryKeys = {
	all: ['inventory'] as const,
	parse: (text: string) => [...inventoryKeys.all, 'parse', text] as const,
}

/**
 * Mutation hook to parse inventory text
 * Returns detailed item information with errors for unparseable lines
 */
export function useParseInventory() {
	return useMutation<InventoryParseResult, Error, string>({
		mutationFn: (inventoryText: string) => inventoryApi.parseInventory(inventoryText),
	})
}
