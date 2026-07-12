import { getStub } from '@repo/do-utils'
import { getIdClassification, isStructureId, normalizeIdToString } from '@repo/eve-types'

import { formatCurrency, toTitleCase } from '../../utils/formatting'
import type { CharacterAffiliationCoordinator } from './character-affiliation'
import type { EntityLinkCoordinator } from './entity-links'
import { StructureResolutionCoordinator } from './structure-resolution'
import type { CoreBinding } from '../../../types/core-binding'

import type { CharacterWalletJournalEntry, Esi, EsiTypeResolver } from '@repo/esi'
import { logger } from '@repo/hono-helpers'

/** context_id_type values that represent entity IDs resolvable by /universe/names/ */
const RESOLVABLE_CONTEXT_TYPES = new Set([
	'character_id',
	'corporation_id',
	'alliance_id',
	'station_id',
	'system_id',
	'type_id',
])

export interface ProcessedWalletJournalEntry extends CharacterWalletJournalEntry {
	refTypeLabel: string
	amountNumber: number
	amountFormatted: string
	balanceFormatted?: string
	taxFormatted?: string
	firstPartyName?: string
	firstPartyDisplayName?: string
	firstPartyDisplayHref?: string
	secondPartyName?: string
	secondPartyDisplayName?: string
	secondPartyDisplayHref?: string
	taxReceiverName?: string
	taxReceiverDisplayName?: string
	taxReceiverDisplayHref?: string
	contextName?: string
	contextDisplayHref?: string
	contextResolvedType?: string
	processedAt: string
}

export type ProcessedWalletJournalEntries = ProcessedWalletJournalEntry[]

export async function enrichWalletJournalEntries(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
		ESI: DurableObjectNamespace
		EVE_TOKEN_STORE: DurableObjectNamespace
		CORE: CoreBinding
	},
	entries: CharacterWalletJournalEntry[],
	characterId: string,
	structureResolutionCoordinator?: StructureResolutionCoordinator,
	affiliationCoordinator?: CharacterAffiliationCoordinator,
	entityLinkCoordinator?: EntityLinkCoordinator,
): Promise<ProcessedWalletJournalEntries> {
	if (entries.length === 0) {
		return []
	}

	const idsToResolve = new Set<string>()
	const structureIds = new Set<string>()

	for (const entry of entries) {
		const firstPartyId = normalizeIdToString(entry.first_party_id)
		if (firstPartyId) {
			idsToResolve.add(firstPartyId)
		}

		const secondPartyId = normalizeIdToString(entry.second_party_id)
		if (secondPartyId) {
			idsToResolve.add(secondPartyId)
		}

		const taxReceiverId = normalizeIdToString(entry.tax_receiver_id)
		if (taxReceiverId) {
			idsToResolve.add(taxReceiverId)
		}

		const contextId = normalizeIdToString(entry.context_id)
		if (contextId) {
			if (entry.context_id_type === 'structure_id' || isStructureId(contextId)) {
				structureIds.add(contextId)
			} else if (RESOLVABLE_CONTEXT_TYPES.has(entry.context_id_type ?? '')) {
				idsToResolve.add(contextId)
			}
		}
	}

	const nameMap: Record<string, string> = {}
	if (idsToResolve.size > 0) {
		try {
			const resolver = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')
			const resolved = await resolver.resolveIds(Array.from(idsToResolve))
			Object.assign(nameMap, resolved)
		} catch (error) {
			logger.error('Failed to resolve type IDs:', {
				error: error instanceof Error ? error.message : String(error),
				idCount: idsToResolve.size,
			})
		}
	}

	const structureNameMap =
		structureIds.size > 0
			? await (structureResolutionCoordinator ?? new StructureResolutionCoordinator()).resolveStructureNames(
					{ ESI: env.ESI },
					characterId,
					structureIds,
					'enrichWalletJournalEntries'
			)
			: {}

	const displayNameMap =
		affiliationCoordinator && idsToResolve.size > 0
			? await affiliationCoordinator.resolveDisplayNames(
					{ ESI: env.ESI },
					characterId,
					entries.flatMap((entry) => {
						const candidates = []
						const firstPartyId = normalizeIdToString(entry.first_party_id)
						if (firstPartyId && nameMap[firstPartyId]) {
							candidates.push({
								characterId: firstPartyId,
								characterName: nameMap[firstPartyId],
							})
						}
						const secondPartyId = normalizeIdToString(entry.second_party_id)
						if (secondPartyId && nameMap[secondPartyId]) {
							candidates.push({
								characterId: secondPartyId,
								characterName: nameMap[secondPartyId],
							})
						}
						const taxReceiverId = normalizeIdToString(entry.tax_receiver_id)
						if (taxReceiverId && nameMap[taxReceiverId]) {
							candidates.push({
								characterId: taxReceiverId,
								characterName: nameMap[taxReceiverId],
							})
						}
						return candidates
					}),
					'enrichWalletJournalEntries',
				)
			: {}

	const displayHrefMap =
		entityLinkCoordinator && idsToResolve.size > 0
			? await entityLinkCoordinator.resolveDisplayHrefs(
					env.CORE,
					entries.flatMap((entry) => {
						const candidates: Array<{ entityId: string; entityType?: string | null }> = []
						const firstPartyId = normalizeIdToString(entry.first_party_id)
						if (firstPartyId) {
							candidates.push({ entityId: firstPartyId })
						}
						const secondPartyId = normalizeIdToString(entry.second_party_id)
						if (secondPartyId) {
							candidates.push({ entityId: secondPartyId })
						}
						const taxReceiverId = normalizeIdToString(entry.tax_receiver_id)
						if (taxReceiverId) {
							candidates.push({ entityId: taxReceiverId })
						}
						const contextId = normalizeIdToString(entry.context_id)
						if (contextId) {
							candidates.push({ entityId: contextId, entityType: entry.context_id_type })
						}
						return candidates
					}),
					'enrichWalletJournalEntries',
				)
			: {}

	if (structureIds.size > 0) {
		logger.log('[enrichWalletJournalEntries] Structure resolution complete', {
			requested: structureIds.size,
			resolved: Object.keys(structureNameMap).length,
			denied: structureResolutionCoordinator?.getDeniedCount() ?? 0,
		})
	}

	const processedAt = new Date().toISOString()

	let fallbackBalance: number | undefined

	return entries.map((entry) => {
		const amountNumber = Number(entry.amount)
		const balanceNumber = entry.balance ? Number(entry.balance) : undefined

		if (!Number.isNaN(balanceNumber ?? NaN)) {
			fallbackBalance = balanceNumber
		} else if (fallbackBalance !== undefined && !Number.isNaN(amountNumber)) {
			fallbackBalance = fallbackBalance + amountNumber
		}

		const firstPartyId = normalizeIdToString(entry.first_party_id)
		const secondPartyId = normalizeIdToString(entry.second_party_id)
		const taxReceiverId = normalizeIdToString(entry.tax_receiver_id)
		const contextId = normalizeIdToString(entry.context_id)

		const firstPartyName = firstPartyId ? nameMap[firstPartyId] : undefined
		const secondPartyName = secondPartyId ? nameMap[secondPartyId] : undefined
		const taxReceiverName = taxReceiverId ? nameMap[taxReceiverId] : undefined

		let contextName: string | undefined
		if (contextId) {
			if (structureIds.has(contextId)) {
				contextName = structureNameMap[contextId] ?? contextId
			} else {
				contextName = nameMap[contextId] ?? contextId
			}
		}

		const classificationType = contextId ? getIdClassification(contextId).type : undefined
		const derivedContextType =
			classificationType && classificationType !== 'invalid' && classificationType !== 'unknown'
				? classificationType
				: undefined

		const taxNumber = entry.tax ? Number(entry.tax) : undefined

		return {
			...entry,
			refTypeLabel: toTitleCase(entry.ref_type),
			amountNumber: Number.isNaN(amountNumber) ? 0 : amountNumber,
			amountFormatted: formatCurrency(Number.isNaN(amountNumber) ? 0 : amountNumber) ?? '0.00',
			balanceFormatted: formatCurrency(balanceNumber ?? fallbackBalance),
			taxFormatted: formatCurrency(taxNumber),
			firstPartyName,
			firstPartyDisplayName: firstPartyId ? displayNameMap[firstPartyId] ?? firstPartyName : undefined,
			firstPartyDisplayHref: firstPartyId ? displayHrefMap[firstPartyId] : undefined,
			secondPartyName,
			secondPartyDisplayName: secondPartyId ? displayNameMap[secondPartyId] ?? secondPartyName : undefined,
			secondPartyDisplayHref: secondPartyId ? displayHrefMap[secondPartyId] : undefined,
			taxReceiverName,
			taxReceiverDisplayName: taxReceiverId ? displayNameMap[taxReceiverId] ?? taxReceiverName : undefined,
			taxReceiverDisplayHref: taxReceiverId ? displayHrefMap[taxReceiverId] : undefined,
			contextName,
			contextDisplayHref: contextId ? displayHrefMap[contextId] : undefined,
			contextResolvedType: entry.context_id_type ?? derivedContextType,
			processedAt,
		}
	})
}
