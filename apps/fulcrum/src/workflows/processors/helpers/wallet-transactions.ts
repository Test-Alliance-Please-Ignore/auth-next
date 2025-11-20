/**
 * Data enrichment functions for character wallet transactions
 * Resolves IDs to human-readable names using ESI Type Resolver
 */

import { getStub } from '@repo/do-utils'

import { resolveTypeIds } from '../../utils/type-resolver'
import { retryWithBackoff, isRateLimitError } from '../../utils/retry'

import { isStructureId } from '@repo/esi'
import type { CharacterMarketTransaction, Esi } from '@repo/esi'

/**
 * Enriched wallet transaction with resolved names
 */
export interface ProcessedWalletTransaction extends CharacterMarketTransaction {
	typeName?: string
	clientName?: string
	locationName?: string
	totalValue: string
	processedAt: string
}

/**
 * Array of processed wallet transactions
 */
export type ProcessedWalletTransactions = ProcessedWalletTransaction[]

/**
 * Enrich wallet transactions by resolving IDs to names
 * Uses ESI Type Resolver to batch resolve all IDs at once
 * Fetches structure info for location IDs classified as structures
 *
 * @param env - Worker environment with ESI_TYPE_RESOLVER and ESI bindings
 * @param transactions - Wallet transactions from ESI worker
 * @param characterId - Character ID for authenticated structure lookups
 * @returns Enriched transactions with resolved names
 */
export async function enrichWalletTransactions(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
		ESI: DurableObjectNamespace
	},
	transactions: CharacterMarketTransaction[],
	characterId: string,
): Promise<ProcessedWalletTransactions> {
	if (transactions.length === 0) {
		return []
	}

	// Collect all IDs that need resolution
	const typeIds: string[] = []
	const clientIds: string[] = []
	const stationLocationIds: string[] = []

	for (const transaction of transactions) {
		// Always resolve type_id
		typeIds.push(transaction.type_id)

		// Resolve client_id (character or corporation)
		clientIds.push(transaction.client_id)

		// Resolve location_id if it's a station
		// Note: Wallet transactions don't have location_type, so we'll try to resolve
		// all location IDs and see which ones work
		stationLocationIds.push(transaction.location_id)
	}

	// Batch resolve all IDs at once (deduplicated by resolveTypeIds)
	const uniqueTypeIds = Array.from(new Set(typeIds))
	const uniqueClientIds = Array.from(new Set(clientIds))
	const uniqueLocationIds = Array.from(new Set(stationLocationIds))
	const resolvableLocationIds = uniqueLocationIds.filter((id) => !isStructureId(id))
	const allIdsToResolve = [...uniqueTypeIds, ...uniqueClientIds, ...resolvableLocationIds]

	console.log('[enrichWalletTransactions] Starting enrichment', {
		totalTransactions: transactions.length,
		uniqueTypeIds: uniqueTypeIds.length,
		uniqueClientIds: uniqueClientIds.length,
		uniqueLocationIds: uniqueLocationIds.length,
		resolvableLocationIds: resolvableLocationIds.length,
		totalIdsToResolve: allIdsToResolve.length,
	})

	const nameMap = await resolveTypeIds(env, allIdsToResolve)

	// Identify location IDs that are classified as structures
	const structureLocationIds = Array.from(
		new Set(
			uniqueLocationIds.filter((id) => isStructureId(id)),
		)
	)

	console.log('[enrichWalletTransactions] Resolution complete', {
		nameMapSize: Object.keys(nameMap).length,
		structureLocationIds: structureLocationIds.length,
		sampleStructureIds: structureLocationIds.slice(0, 3),
		sampleClientIds: uniqueClientIds.slice(0, 3),
		sampleClientResolutions: uniqueClientIds.slice(0, 3).map((id) => ({
			clientId: id,
			clientName: nameMap[id],
			hasName: !!nameMap[id],
		})),
	})

	// Fetch structure info for large location IDs
	// Process sequentially with delays and exponential backoff retry to avoid rate limits (420/429 errors)
	// Use 'global' instance to share structure cache across all characters
	const structureNameMap: Record<string, string> = {}
	if (structureLocationIds.length > 0) {
		const esiStub = getStub<Esi>(env.ESI, 'global')
		const DELAY_MS = 200 // Delay between requests to avoid rate limits

		// Process sequentially to avoid rate limits
		for (const structureId of structureLocationIds) {
			try {
				// Retry with exponential backoff on rate limit errors
				const structureInfo = await retryWithBackoff(
					async () => {
						const info = await esiStub.fetchStructureInfo(characterId, structureId)
						return info
					},
					{
						maxRetries: 5,
						initialDelayMs: 1000, // Start with 1 second
						maxDelayMs: 60000, // Cap at 60 seconds
						backoffMultiplier: 2, // Double delay each retry
						onRetry: (attempt, error, delayMs) => {
							console.warn('[enrichWalletTransactions] Retrying structure fetch after rate limit', {
								structureId,
								attempt,
								delayMs,
								error: error.message,
							})
						},
					}
				)

				if (structureInfo) {
					structureNameMap[structureId] = structureInfo.name
				}
			} catch (error) {
				// If it's a rate limit error and we've exhausted retries, skip this structure
				if (isRateLimitError(error)) {
					console.warn('[enrichWalletTransactions] Rate limit error after retries, skipping structure', {
						structureId,
						error: error instanceof Error ? error.message : String(error),
					})
				} else {
					// Structure not found, no access, or other error - skip it
					console.warn('[enrichWalletTransactions] Failed to fetch structure info', {
						structureId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}

			// Add delay between requests to avoid rate limits
			if (structureLocationIds.indexOf(structureId) < structureLocationIds.length - 1) {
				await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
			}
		}

		console.log('[enrichWalletTransactions] Structure resolution complete', {
			requested: structureLocationIds.length,
			resolved: Object.keys(structureNameMap).length,
		})
	}

	// Build enriched transactions with resolved names
	const processedAt = new Date().toISOString()
	const enriched = transactions.map((transaction) => {
		// Resolve typeName
		const typeName = nameMap[transaction.type_id]

		// Resolve clientName
		const clientName = nameMap[transaction.client_id]

		// Resolve locationName:
		// - For structure IDs: fetch structure info
		// - Otherwise: rely on universe names (stations, etc.)
		let locationName: string | undefined

		if (isStructureId(transaction.location_id)) {
			// Structure lookup requires authenticated request
			locationName = structureNameMap[transaction.location_id]
		} else {
			locationName = nameMap[transaction.location_id]
		}

		// Calculate total value
		const totalValue = (transaction.quantity * transaction.unit_price).toString()

		const result: ProcessedWalletTransaction = {
			...transaction,
			typeName,
			clientName,
			locationName,
			totalValue,
			processedAt,
		}
		return result
	})

	// Log sample enriched transaction
	if (enriched.length > 0) {
		const sample = enriched[0]
		console.log('[enrichWalletTransactions] Sample enriched transaction', {
			typeId: sample.type_id,
			typeName: sample.typeName,
			clientId: sample.client_id,
			clientName: sample.clientName,
			locationId: sample.location_id,
			locationName: sample.locationName,
			totalValue: sample.totalValue,
		})
	}

	return enriched
}

