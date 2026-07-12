/**
 * Data enrichment functions for character wallet transactions
 * Resolves IDs to human-readable names using ESI Type Resolver
 */

import { getStub } from '@repo/do-utils'
import { isStructureId } from '@repo/eve-types'

import { formatCurrency } from '../../utils/formatting'
import type { CharacterAffiliationCoordinator } from './character-affiliation'
import type { EntityLinkCoordinator } from './entity-links'
import { StructureResolutionCoordinator } from './structure-resolution'
import type { CoreBinding } from '../../../types/core-binding'

import type { CharacterMarketTransaction, EsiTypeResolver } from '@repo/esi'
import type { Universe } from '@repo/universe'
import { logger } from '@repo/hono-helpers'

/**
 * Enriched wallet transaction with resolved names
 */
export interface ProcessedWalletTransaction extends CharacterMarketTransaction {
	typeName?: string
	clientName?: string
	clientDisplayName?: string
	clientDisplayHref?: string
	locationName?: string
	marketGroupName?: string | null
	categoryName?: string
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
		UNIVERSE: DurableObjectNamespace
		ESI: DurableObjectNamespace
		EVE_TOKEN_STORE: DurableObjectNamespace
		CORE: CoreBinding
	},
	transactions: CharacterMarketTransaction[],
	characterId: string,
	structureResolutionCoordinator?: StructureResolutionCoordinator,
	affiliationCoordinator?: CharacterAffiliationCoordinator,
	entityLinkCoordinator?: EntityLinkCoordinator,
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

	logger.log('[enrichWalletTransactions] Starting enrichment', {
		totalTransactions: transactions.length,
		uniqueTypeIds: uniqueTypeIds.length,
		uniqueClientIds: uniqueClientIds.length,
		uniqueLocationIds: uniqueLocationIds.length,
		resolvableLocationIds: resolvableLocationIds.length,
		totalIdsToResolve: allIdsToResolve.length,
	})

	const typeResolver = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')
	const nameMap = await typeResolver.resolveIds(allIdsToResolve)

	// Fetch type metadata (market group and category) for all unique type IDs
	const typeMetadataMap: Record<
		string,
		{
			marketGroupName: string | null
			categoryName: string
		}
	> = {}
	if (uniqueTypeIds.length > 0) {
		try {
			const universeStub = getStub<Universe>(env.UNIVERSE, 'default')

			// Batch fetch metadata in chunks of 1000 (API limit)
			const BATCH_SIZE = 1000
			for (let i = 0; i < uniqueTypeIds.length; i += BATCH_SIZE) {
				const batch = uniqueTypeIds.slice(i, i + BATCH_SIZE)
				const batchMetadata = await universeStub.resolveTypeMetadataByIds(batch)
				Object.assign(typeMetadataMap, batchMetadata)
			}
		} catch (error) {
			logger.error('[enrichWalletTransactions] Error fetching type metadata:', {
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	// Identify location IDs that are classified as structures
	const structureLocationIds = Array.from(
		new Set(uniqueLocationIds.filter((id) => isStructureId(id)))
	)

	logger.log('[enrichWalletTransactions] Resolution complete', {
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

	const structureNameMap =
		structureLocationIds.length > 0
			? await (structureResolutionCoordinator ?? new StructureResolutionCoordinator()).resolveStructureNames(
					{ ESI: env.ESI },
					characterId,
					structureLocationIds,
					'enrichWalletTransactions'
				)
			: {}

	const displayNameMap =
		affiliationCoordinator && uniqueClientIds.length > 0
			? await affiliationCoordinator.resolveDisplayNames(
					{ ESI: env.ESI },
					characterId,
					uniqueClientIds.map((clientId) => ({
						characterId: clientId,
						characterName: nameMap[clientId],
					})),
					'enrichWalletTransactions',
				)
			: {}

	const displayHrefMap =
		entityLinkCoordinator && uniqueClientIds.length > 0
			? await entityLinkCoordinator.resolveDisplayHrefs(
					env.CORE,
					uniqueClientIds.map((clientId) => ({ entityId: clientId })),
					'enrichWalletTransactions',
				)
			: {}

	if (structureLocationIds.length > 0) {
		logger.log('[enrichWalletTransactions] Structure resolution complete', {
			requested: structureLocationIds.length,
			resolved: Object.keys(structureNameMap).length,
			denied: structureResolutionCoordinator?.getDeniedCount() ?? 0,
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
		const totalValue = formatCurrency(transaction.quantity * transaction.unit_price) ?? '0.00'

		const typeMetadata = typeMetadataMap[transaction.type_id]
		const result: ProcessedWalletTransaction = {
			...transaction,
			typeName,
			clientName,
			clientDisplayName: displayNameMap[transaction.client_id] ?? clientName,
			clientDisplayHref: displayHrefMap[transaction.client_id],
			locationName,
			marketGroupName: typeMetadata?.marketGroupName ?? null,
			categoryName: typeMetadata?.categoryName,
			totalValue,
			processedAt,
		}
		return result
	})

	// Log sample enriched transaction
	if (enriched.length > 0) {
		const sample = enriched[0]
		logger.log('[enrichWalletTransactions] Sample enriched transaction', {
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
