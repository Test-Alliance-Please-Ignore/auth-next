import { getStub } from '@repo/do-utils'

import { resolveTypeIds } from '../../utils/type-resolver'
import { retryWithBackoff, isRateLimitError } from '../../utils/retry'

import { isStructureId } from '@repo/esi'
import type { CharacterWalletJournalEntry, Esi } from '@repo/esi'

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

function formatCurrency(value: number | undefined): string | undefined {
	if (value === undefined || Number.isNaN(value)) {
		return undefined
	}
	return value.toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})
}

function toTitleCase(input: string): string {
	return input
		.split('_')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ')
}

function normalizeId(value?: string): string | undefined {
	if (!value) {
		return undefined
	}

	return value
}

export async function enrichWalletJournalEntries(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
		ESI: DurableObjectNamespace
	},
	entries: CharacterWalletJournalEntry[],
	characterId: string,
): Promise<ProcessedWalletJournalEntries> {
	if (entries.length === 0) {
		return []
	}

	const idsToResolve = new Set<string>()
	const structureIds = new Set<string>()

	for (const entry of entries) {
		const firstPartyId = normalizeId(entry.first_party_id)
		if (firstPartyId) {
			idsToResolve.add(firstPartyId)
		}

		const secondPartyId = normalizeId(entry.second_party_id)
		if (secondPartyId) {
			idsToResolve.add(secondPartyId)
		}

		const taxReceiverId = normalizeId(entry.tax_receiver_id)
		if (taxReceiverId) {
			idsToResolve.add(taxReceiverId)
		}

		const contextId = normalizeId(entry.context_id)
		if (contextId && entry.context_id_type) {
			if (entry.context_id_type === 'structure_id' || isStructureId(contextId)) {
				structureIds.add(contextId)
			} else {
				idsToResolve.add(contextId)
			}
		}
	}

	const nameMap = await resolveTypeIds(env, Array.from(idsToResolve))

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
					},
				)

				if (structureInfo) {
					structureNameMap[structureId] = structureInfo.name
				}
			} catch (error) {
				if (isRateLimitError(error)) {
					console.warn(
						'[enrichWalletJournalEntries] Rate limit when fetching structure info, continuing without name',
						{ structureId, error: error instanceof Error ? error.message : String(error) },
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

		const firstPartyName = entry.first_party_id ? nameMap[entry.first_party_id] : undefined
		const secondPartyName = entry.second_party_id ? nameMap[entry.second_party_id] : undefined
		const taxReceiverName = entry.tax_receiver_id ? nameMap[entry.tax_receiver_id] : undefined

		let contextName: string | undefined
		if (entry.context_id) {
			if (entry.context_id_type === 'structure_id' || isStructureId(entry.context_id)) {
				contextName = structureNameMap[entry.context_id] ?? entry.context_id
			} else {
				contextName = nameMap[entry.context_id] ?? entry.context_id
			}
		}

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
			contextResolvedType: entry.context_id_type,
			processedAt,
		}
	})
}

