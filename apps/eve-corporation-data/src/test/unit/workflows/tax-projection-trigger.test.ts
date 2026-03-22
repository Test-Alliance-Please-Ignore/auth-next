import { describe, expect, it } from 'vitest'

import {
	buildTaxProjectionRefreshInput,
	createTaxProjectionTriggerRunId,
} from '../../../workflows/utils/tax-projection-trigger'

describe('tax-projection-trigger helpers', () => {
	it('builds payload with only non-empty wallet source watermarks', () => {
		const input = buildTaxProjectionRefreshInput({
			corporationId: '98000001',
			upstreamRunId: 'wf-1',
			triggeredAt: new Date('2026-03-20T00:00:00.000Z'),
			stats: {
				walletJournalPersistedNewRows: 3,
				walletJournalMaxId: '333',
				walletJournalMaxDate: '2026-03-20T01:00:00.000Z',
				walletTransactionsPersistedNewRows: 0,
				walletTransactionsMaxId: '999',
				walletTransactionsMaxDate: '2026-03-20T01:30:00.000Z',
			},
		})

		expect(input.walletJournal).toEqual({
			fetchedCount: 3,
			maxId: '333',
			maxDate: new Date('2026-03-20T01:00:00.000Z'),
		})
		expect(input.walletTransactions).toBeNull()
		expect(input.includeCharacterWallets).toBe(true)
	})

	it('builds a deterministic trigger run id from corporation + watermark payload', () => {
		const first = createTaxProjectionTriggerRunId({
			corporationId: '98000001',
			stats: {
				walletJournalPersistedNewRows: 3,
				walletJournalMaxId: '333',
				walletJournalMaxDate: '2026-03-20T01:00:00.000Z',
				walletTransactionsPersistedNewRows: 1,
				walletTransactionsMaxId: '444',
				walletTransactionsMaxDate: '2026-03-20T02:00:00.000Z',
			},
		})
		const second = createTaxProjectionTriggerRunId({
			corporationId: '98000001',
			stats: {
				walletJournalPersistedNewRows: 3,
				walletJournalMaxId: '333',
				walletJournalMaxDate: '2026-03-20T01:00:00.000Z',
				walletTransactionsPersistedNewRows: 1,
				walletTransactionsMaxId: '444',
				walletTransactionsMaxDate: '2026-03-20T02:00:00.000Z',
			},
		})
		const changed = createTaxProjectionTriggerRunId({
			corporationId: '98000001',
			stats: {
				walletJournalPersistedNewRows: 3,
				walletJournalMaxId: '333',
				walletJournalMaxDate: '2026-03-20T01:00:00.000Z',
				walletTransactionsPersistedNewRows: 2,
				walletTransactionsMaxId: '444',
				walletTransactionsMaxDate: '2026-03-20T02:00:00.000Z',
			},
		})

		expect(first).toBe(second)
		expect(first).not.toBe(changed)
		expect(first.startsWith('tax-proj-98000001-')).toBe(true)
	})
})
