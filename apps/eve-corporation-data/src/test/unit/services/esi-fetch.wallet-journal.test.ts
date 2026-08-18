import { describe, expect, it, vi } from 'vitest'

import { fetchWalletJournal } from '../../../services/esi-fetch'

const rawJournalEntry = (id: number) => ({
	id,
	amount: 100,
	balance: 200,
	date: '2026-08-06T00:00:00Z',
	description: 'Test journal entry',
	ref_type: 'bounty_prizes',
})

describe('wallet journal ESI pagination', () => {
	it('uses bounded pagination when a journal watermark exists', async () => {
		const fetchEsiPagesUntilWatermark = vi.fn().mockResolvedValue({
			data: [rawJournalEntry(101), rawJournalEntry(100)],
			pages: 5,
			pagesFetched: 2,
			stoppedAtWatermark: true,
		})
		const fetchEsiAllPages = vi.fn()
		const tokenStore = { fetchEsiPagesUntilWatermark, fetchEsiAllPages }

		const result = await fetchWalletJournal(tokenStore as never, '123', 1, '456', {
			maxJournalId: '100',
			maxJournalDate: new Date('2026-08-05T00:00:00Z'),
		})

		expect(fetchEsiPagesUntilWatermark).toHaveBeenCalledWith(
			'/corporations/123/wallets/1/journal',
			'456',
			{
				maxId: '100',
				maxDate: new Date('2026-08-05T00:00:00Z'),
			},
			{ cacheMode: 'no-store' }
		)
		expect(fetchEsiAllPages).not.toHaveBeenCalled()
		expect(result.map((entry) => entry.id)).toEqual(['101', '100'])
	})

	it('uses full pagination when no journal watermark exists', async () => {
		const fetchEsiPagesUntilWatermark = vi.fn()
		const fetchEsiAllPages = vi.fn().mockResolvedValue({
			data: [rawJournalEntry(100)],
			pages: 1,
		})
		const tokenStore = { fetchEsiPagesUntilWatermark, fetchEsiAllPages }

		const result = await fetchWalletJournal(tokenStore as never, '123', 1, '456')

		expect(fetchEsiAllPages).toHaveBeenCalledWith('/corporations/123/wallets/1/journal', '456', {
			cacheMode: 'no-store',
		})
		expect(fetchEsiPagesUntilWatermark).not.toHaveBeenCalled()
		expect(result.map((entry) => entry.id)).toEqual(['100'])
	})
})
