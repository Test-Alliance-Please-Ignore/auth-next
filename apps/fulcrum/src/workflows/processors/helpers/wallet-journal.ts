import { getStub } from '@repo/do-utils'
import { getIdClassification, isStructureId, normalizeIdToString } from '@repo/esi'

import { formatCurrency, toTitleCase } from '../../utils/formatting'
import { isRateLimitError, retryWithBackoff } from '../../utils/retry'

import type { CharacterWalletJournalEntry, Esi, EsiTypeResolver } from '@repo/esi'

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
	secondPartyName?: string
	taxReceiverName?: string
	contextName?: string
	contextResolvedType?: string
	processedAt: string
}

export type ProcessedWalletJournalEntries = ProcessedWalletJournalEntry[]

export async function enrichWalletJournalEntries(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
		ESI: DurableObjectNamespace
	},
	entries: CharacterWalletJournalEntry[],
	characterId: string
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
			console.error('Failed to resolve type IDs:', {
				error: error instanceof Error ? error.message : String(error),
				idCount: idsToResolve.size,
			})
		}
	}

	const structureNameMap: Record<string, string> = {}
	if (structureIds.size > 0) {
		const esiStub = getStub<Esi>(env.ESI, 'global')
		for (const structureId of structureIds) {
			try {
				const structureInfo = await retryWithBackoff(
					async () => await esiStub.fetchStructureInfo(characterId, structureId),
					{
						maxRetries: 5,
						initialDelayMs: 1000,
						maxDelayMs: 60000,
						backoffMultiplier: 2,
						onRetry: (attempt, error, delayMs) => {
							console.warn('[enrichWalletJournalEntries] Retrying structure fetch', {
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
				if (isRateLimitError(error)) {
					console.warn(
						'[enrichWalletJournalEntries] Rate limit when fetching structure info, continuing without name',
						{ structureId, error: error instanceof Error ? error.message : String(error) }
					)
				} else {
					console.warn('[enrichWalletJournalEntries] Failed to fetch structure info', {
						structureId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}
		}
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
			secondPartyName,
			taxReceiverName,
			contextName,
			contextResolvedType: entry.context_id_type ?? derivedContextType,
			processedAt,
		}
	})
}
