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
		const fetchCorporationWalletJournalUntilWatermark = vi.fn().mockResolvedValue({
			data: [rawJournalEntry(101), rawJournalEntry(100)],
			pages: 5,
			pagesFetched: 2,
			stoppedAtWatermark: true,
		})
		const fetchCorporationWalletJournal = vi.fn()
		const esi = { fetchCorporationWalletJournalUntilWatermark, fetchCorporationWalletJournal }

		const result = await fetchWalletJournal(esi as never, '123', 1, '456', {
			maxJournalId: '100',
			maxJournalDate: new Date('2026-08-05T00:00:00Z'),
		})

		expect(fetchCorporationWalletJournalUntilWatermark).toHaveBeenCalledWith('123', 1, {
			maxId: '100',
			maxDate: '2026-08-05T00:00:00.000Z',
		})
		expect(fetchCorporationWalletJournal).not.toHaveBeenCalled()
		expect(result.map((entry) => entry.id)).toEqual([101, 100])
	})

	it('uses full pagination when no journal watermark exists', async () => {
		const fetchCorporationWalletJournalUntilWatermark = vi.fn()
		const fetchCorporationWalletJournal = vi.fn().mockResolvedValue([rawJournalEntry(100)])
		const esi = { fetchCorporationWalletJournalUntilWatermark, fetchCorporationWalletJournal }

		const result = await fetchWalletJournal(esi as never, '123', 1, '456')

		expect(fetchCorporationWalletJournal).toHaveBeenCalledWith('123', 1)
		expect(fetchCorporationWalletJournalUntilWatermark).not.toHaveBeenCalled()
		expect(result.map((entry) => entry.id)).toEqual([100])
	})
})
