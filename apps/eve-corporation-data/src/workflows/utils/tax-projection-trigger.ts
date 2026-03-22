import type { SyncStats } from '../types'

type TaxWalletSourceWatermark = {
	maxId: string | null
	maxDate: Date | null
	fetchedCount: number
}

export type TaxProjectionRefreshInput = {
	corporationId: string
	upstreamRunId: string
	triggeredAt: Date
	walletJournal?: TaxWalletSourceWatermark | null
	walletTransactions?: TaxWalletSourceWatermark | null
	includeCharacterWallets?: boolean
}

type WalletProjectionStats = Pick<
	SyncStats,
	| 'walletJournalPersistedNewRows'
	| 'walletJournalMaxId'
	| 'walletJournalMaxDate'
	| 'walletTransactionsPersistedNewRows'
	| 'walletTransactionsMaxId'
	| 'walletTransactionsMaxDate'
>

function shortHash(input: string): string {
	let hash = 5381
	for (let i = 0; i < input.length; i += 1) {
		hash = (hash * 33) ^ input.charCodeAt(i)
	}
	return (hash >>> 0).toString(36)
}

function normalizeToken(value: string, fallback: string): string {
	const trimmed = value.trim()
	if (!trimmed) {
		return fallback
	}
	const compact = trimmed.replace(/[^a-zA-Z0-9]/g, '')
	return compact.length > 0 ? compact.toLowerCase().slice(0, 16) : fallback
}

export function createTaxProjectionTriggerRunId(input: {
	corporationId: string
	stats: WalletProjectionStats
}): string {
	const payload = JSON.stringify({
		corporationId: input.corporationId,
		walletJournalPersistedNewRows: Math.max(input.stats.walletJournalPersistedNewRows ?? 0, 0),
		walletJournalMaxId: input.stats.walletJournalMaxId ?? null,
		walletJournalMaxDate: input.stats.walletJournalMaxDate ?? null,
		walletTransactionsPersistedNewRows: Math.max(
			input.stats.walletTransactionsPersistedNewRows ?? 0,
			0
		),
		walletTransactionsMaxId: input.stats.walletTransactionsMaxId ?? null,
		walletTransactionsMaxDate: input.stats.walletTransactionsMaxDate ?? null,
	})
	const corpToken = normalizeToken(input.corporationId, 'corp')
	return `tax-proj-${corpToken}-${shortHash(payload)}`
}

export function buildTaxProjectionRefreshInput(input: {
	corporationId: string
	upstreamRunId: string
	triggeredAt: Date
	includeCharacterWallets?: boolean
	stats: WalletProjectionStats
}): TaxProjectionRefreshInput {
	const walletJournalPersistedNewRows = Math.max(input.stats.walletJournalPersistedNewRows ?? 0, 0)
	const walletTransactionsPersistedNewRows = Math.max(
		input.stats.walletTransactionsPersistedNewRows ?? 0,
		0
	)

	return {
		corporationId: input.corporationId,
		upstreamRunId: input.upstreamRunId,
		triggeredAt: input.triggeredAt,
		walletJournal:
			walletJournalPersistedNewRows > 0
				? {
						fetchedCount: walletJournalPersistedNewRows,
						maxId: input.stats.walletJournalMaxId ?? null,
						maxDate: input.stats.walletJournalMaxDate
							? new Date(input.stats.walletJournalMaxDate)
							: null,
					}
				: null,
		walletTransactions:
			walletTransactionsPersistedNewRows > 0
				? {
						fetchedCount: walletTransactionsPersistedNewRows,
						maxId: input.stats.walletTransactionsMaxId ?? null,
						maxDate: input.stats.walletTransactionsMaxDate
							? new Date(input.stats.walletTransactionsMaxDate)
							: null,
					}
				: null,
		includeCharacterWallets: input.includeCharacterWallets ?? true,
	}
}
