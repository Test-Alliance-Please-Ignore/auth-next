/**
 * Data enrichment functions for character contracts
 * Resolves entity IDs to human-readable names using ESI Type Resolver
 * Fetches contract items for item_exchange and auction contracts
 */

import { getStub } from '@repo/do-utils'
import { getEsiInstanceForCharacter } from '@repo/esi'

import type { CharacterContract, CharacterContractItem, EsiTypeResolver } from '@repo/esi'
import type { CharacterAffiliationCoordinator } from './character-affiliation'
import type { EntityLinkCoordinator } from './entity-links'
import type { CoreBinding } from '../../../types/core-binding'
import { logger } from '@repo/hono-helpers'

/**
 * Contract item with resolved type name
 */
export interface ProcessedContractItem extends CharacterContractItem {
	typeName?: string
}

/**
 * Enriched character contract with resolved names and items
 */
export interface ProcessedContract extends CharacterContract {
	issuerName?: string
	issuerDisplayName?: string
	issuerDisplayHref?: string
	issuerCorporationName?: string
	issuerCorporationDisplayHref?: string
	acceptorName?: string
	acceptorDisplayName?: string
	acceptorDisplayHref?: string
	assigneeName?: string
	assigneeDisplayName?: string
	assigneeDisplayHref?: string
	startLocationName?: string
	endLocationName?: string
	items?: ProcessedContractItem[]
	_itemsFetchError?: string
	processedAt: string
}

interface ContractItemsResult {
	itemsMap: Map<string, CharacterContractItem[]>
	errorsMap: Map<string, string>
	topLevelError?: string
}

export type ProcessedContracts = ProcessedContract[]

/**
 * Fetch items for contracts that can contain items (item_exchange, auction)
 * Skips courier and loan contracts. Fetches in parallel with concurrency limit.
 * Returns both items and per-contract error information for diagnostics.
 */
async function fetchContractItems(
	esiBinding: DurableObjectNamespace,
	contracts: CharacterContract[],
	characterId: string,
): Promise<ContractItemsResult> {
	const itemsMap = new Map<string, CharacterContractItem[]>()
	const errorsMap = new Map<string, string>()
	const contractsWithItems = contracts.filter(
		(c) => c.type === 'item_exchange' || c.type === 'auction',
	)

	if (contractsWithItems.length === 0) {
		return { itemsMap, errorsMap }
	}

	let stub: ReturnType<typeof getEsiInstanceForCharacter>
	try {
		stub = getEsiInstanceForCharacter(esiBinding, characterId)
	} catch (stubError) {
		const msg = stubError instanceof Error ? stubError.message : String(stubError)
		return {
			itemsMap,
			errorsMap,
			topLevelError: `Failed to create ESI stub: ${msg}`,
		}
	}

	// Fetch in batches of 10 to avoid overwhelming ESI
	const batchSize = 10
	for (let i = 0; i < contractsWithItems.length; i += batchSize) {
		const batch = contractsWithItems.slice(i, i + batchSize)
		const results = await Promise.allSettled(
			batch.map(async (contract) => {
				const items = await stub.fetchContractItems(characterId, contract.contract_id)
				return { contractId: contract.contract_id, items }
			}),
		)
		for (const [idx, result] of results.entries()) {
			const contractId = batch[idx].contract_id
			if (result.status === 'fulfilled') {
				itemsMap.set(result.value.contractId, result.value.items)
			} else {
				const reason =
					result.reason instanceof Error ? result.reason.message : String(result.reason)
				errorsMap.set(contractId, reason)
			}
		}
	}

	return { itemsMap, errorsMap }
}

/**
 * Enrich character contracts by resolving IDs to names and fetching items
 *
 * @param env - Worker environment with ESI_TYPE_RESOLVER and ESI bindings
 * @param contracts - Character contracts from ESI
 * @param characterId - Character ID (for logging)
 * @returns Enriched contracts with resolved names and items
 */
export async function enrichContracts(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
		ESI: DurableObjectNamespace
		EVE_TOKEN_STORE: DurableObjectNamespace
		CORE: CoreBinding
	},
	contracts: CharacterContract[],
	characterId: string,
	affiliationCoordinator?: CharacterAffiliationCoordinator,
	entityLinkCoordinator?: EntityLinkCoordinator,
): Promise<ProcessedContracts> {
	if (contracts.length === 0) {
		return []
	}

	// Fetch contract items and resolve entity names in parallel
	const [contractItemsResult, nameMap] = await Promise.all([
		fetchContractItems(env.ESI, contracts, characterId).catch((error) => {
			const msg = error instanceof Error ? error.message : String(error)
			return {
				itemsMap: new Map<string, CharacterContractItem[]>(),
				errorsMap: new Map<string, string>(),
				topLevelError: `Top-level fetch failure: ${msg}`,
			} satisfies ContractItemsResult
		}),
		resolveEntityNames(env, contracts),
	])

	const displayNameMap =
		affiliationCoordinator && contracts.length > 0
			? await affiliationCoordinator.resolveDisplayNames(
					{ ESI: env.ESI },
					characterId,
					contracts.flatMap((contract) => {
						const candidates: Array<{
							characterId: string
							characterName?: string
							forceCharacter?: boolean
						}> = []
						if (nameMap[contract.issuer_id]) {
							candidates.push({
								characterId: contract.issuer_id,
								characterName: nameMap[contract.issuer_id],
								forceCharacter: true,
							})
						}
						if (contract.acceptor_id && nameMap[contract.acceptor_id]) {
							candidates.push({
								characterId: contract.acceptor_id,
								characterName: nameMap[contract.acceptor_id],
								forceCharacter: true,
							})
						}
						if (
							contract.assignee_id &&
							nameMap[contract.assignee_id] &&
							contract.availability === 'personal'
						) {
							candidates.push({
								characterId: contract.assignee_id,
								characterName: nameMap[contract.assignee_id],
								forceCharacter: true,
							})
						}
						return candidates
					}),
					'enrichContracts',
				)
			: {}

	const displayHrefMap =
		entityLinkCoordinator && contracts.length > 0
			? await entityLinkCoordinator.resolveDisplayHrefs(
					env.CORE,
					contracts.flatMap((contract) => {
						const candidates: Array<{ entityId: string; entityType?: string | null }> = []
						candidates.push({ entityId: contract.issuer_id, entityType: 'character' })
						if (contract.acceptor_id) candidates.push({ entityId: contract.acceptor_id })
						if (contract.assignee_id) candidates.push({ entityId: contract.assignee_id })
						candidates.push({ entityId: contract.issuer_corporation_id, entityType: 'corporation' })
						return candidates
					}),
					'enrichContracts',
				)
			: {}

	const { itemsMap: contractItemsMap, errorsMap, topLevelError } = contractItemsResult

	// Collect all type IDs from contract items for name resolution
	const typeIds = new Set<string>()
	for (const items of contractItemsMap.values()) {
		for (const item of items) {
			typeIds.add(item.type_id)
		}
	}

	// Resolve item type names
	const typeNameMap: Record<string, string> = {}
	if (typeIds.size > 0) {
		try {
			const resolver = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')
			const resolved = await resolver.resolveIds([...typeIds])
			Object.assign(typeNameMap, resolved)
		} catch (error) {
			logger.error('[enrichContracts] Failed to resolve type IDs:', {
				error: error instanceof Error ? error.message : String(error),
				typeCount: typeIds.size,
			})
		}
	}

	const processedAt = new Date().toISOString()
	return contracts.map((contract) => {
		const rawItems = contractItemsMap.get(contract.contract_id)
		const items = rawItems?.map((item) => ({
			...item,
			typeName: typeNameMap[item.type_id],
		}))

		// Determine per-contract error
		const perContractError = errorsMap.get(contract.contract_id)
		const isItemContract = contract.type === 'item_exchange' || contract.type === 'auction'
		const itemsFetchError = topLevelError ?? perContractError ?? (isItemContract && !rawItems ? 'No items in map (unknown reason)' : undefined)

		return {
			...contract,
			issuerName: nameMap[contract.issuer_id],
			issuerDisplayName: displayNameMap[contract.issuer_id] ?? nameMap[contract.issuer_id],
			issuerDisplayHref: displayHrefMap[contract.issuer_id],
			issuerCorporationName: nameMap[contract.issuer_corporation_id],
			issuerCorporationDisplayHref: displayHrefMap[contract.issuer_corporation_id],
			acceptorName: contract.acceptor_id ? nameMap[contract.acceptor_id] : undefined,
			acceptorDisplayName: contract.acceptor_id
				? displayNameMap[contract.acceptor_id] ?? nameMap[contract.acceptor_id]
				: undefined,
			acceptorDisplayHref: contract.acceptor_id ? displayHrefMap[contract.acceptor_id] : undefined,
			assigneeName: contract.assignee_id ? nameMap[contract.assignee_id] : undefined,
			assigneeDisplayName: contract.assignee_id
				? displayNameMap[contract.assignee_id] ?? nameMap[contract.assignee_id]
				: undefined,
			assigneeDisplayHref: contract.assignee_id ? displayHrefMap[contract.assignee_id] : undefined,
			items,
			_itemsFetchError: itemsFetchError,
			processedAt,
		}
	})
}

/**
 * Resolve entity IDs (characters, corps) to names
 */
async function resolveEntityNames(
	env: { ESI_TYPE_RESOLVER: DurableObjectNamespace },
	contracts: CharacterContract[],
): Promise<Record<string, string>> {
	const idsToResolve = new Set<string>()
	for (const contract of contracts) {
		idsToResolve.add(contract.issuer_id)
		idsToResolve.add(contract.issuer_corporation_id)
		if (contract.acceptor_id) idsToResolve.add(contract.acceptor_id)
		if (contract.assignee_id) idsToResolve.add(contract.assignee_id)
	}

	const idsArray = [...idsToResolve].filter(Boolean)
	const nameMap: Record<string, string> = {}

	if (idsArray.length > 0) {
		try {
			const resolver = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')
			const resolved = await resolver.resolveIds(idsArray)
			Object.assign(nameMap, resolved)
		} catch (error) {
			logger.error('[enrichContracts] Failed to resolve IDs:', {
				error: error instanceof Error ? error.message : String(error),
				idCount: idsArray.length,
			})
		}
	}

	return nameMap
}
