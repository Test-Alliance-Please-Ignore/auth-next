import { describe, expect, it, vi } from 'vitest'

import { fetchWalletTransactions } from '../../../services/esi-fetch'

const rawTransaction = (transactionId: string, date = '2026-08-06T00:00:00Z') => ({
	transaction_id: transactionId,
	client_id: '100',
	date,
	is_buy: true,
	is_personal: false,
	journal_ref_id: '200',
	location_id: '300',
	quantity: 1,
	type_id: '400',
	unit_price: '500',
})

describe('wallet transaction ESI pagination', () => {
	it('stops after the stored watermark row without fetching older pages', async () => {
		const fetchCorporationWalletTransactionsPage = vi
			.fn()
			.mockResolvedValueOnce([rawTransaction('105'), rawTransaction('104', '2026-08-05T00:00:00Z')])
			.mockResolvedValueOnce([
				rawTransaction('104', '2026-08-05T00:00:00Z'),
				rawTransaction('103', '2026-08-04T00:00:00Z'),
				rawTransaction('100', '2026-08-04T00:00:00Z'),
			])
			.mockResolvedValueOnce([
				rawTransaction('100', '2026-08-04T00:00:00Z'),
				rawTransaction('99', '2026-08-04T00:00:00Z'),
			])
		const esi = { fetchCorporationWalletTransactionsPage } as never

		const result = await fetchWalletTransactions(esi, '123', 1, '456', {
			maxTransactionId: '100',
			maxTransactionDate: new Date('2026-08-05T00:00:00Z'),
		})

		expect(result).toMatchObject({
			pagesFetched: 3,
			stoppedAtWatermark: true,
			truncated: false,
		})
		expect(result.transactions.map((transaction) => transaction.transaction_id)).toEqual([
			'105',
			'104',
			'103',
			'100',
			'99',
		])
		expect(fetchCorporationWalletTransactionsPage).toHaveBeenCalledTimes(3)
		expect(fetchCorporationWalletTransactionsPage.mock.calls[1]).toEqual(['123', 1, '104'])
		expect(fetchCorporationWalletTransactionsPage.mock.calls[2]).toEqual(['123', 1, '100'])
	})

	it('follows cursors until ESI returns only the cursor row when no watermark exists', async () => {
		const fetchCorporationWalletTransactionsPage = vi
			.fn()
			.mockResolvedValueOnce([rawTransaction('3'), rawTransaction('2')])
			.mockResolvedValueOnce([rawTransaction('2'), rawTransaction('1')])
			.mockResolvedValueOnce([rawTransaction('1')])
		const esi = { fetchCorporationWalletTransactionsPage } as never

		const result = await fetchWalletTransactions(esi, '123', 1, '456')

		expect(result).toMatchObject({
			pagesFetched: 3,
			stoppedAtWatermark: false,
			truncated: false,
		})
		expect(result.transactions.map((transaction) => transaction.transaction_id)).toEqual([
			'3',
			'2',
			'1',
		])
		expect(fetchCorporationWalletTransactionsPage).toHaveBeenCalledTimes(3)
	})
})
