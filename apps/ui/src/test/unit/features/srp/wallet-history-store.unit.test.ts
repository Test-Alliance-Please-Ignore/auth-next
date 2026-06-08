import { beforeEach, describe, expect, it } from 'vitest'

import {
	__resetWalletHistoryStoreForTests,
	getWalletHistoryUiState,
	setWalletHistoryPage,
	setWalletHistoryPageSize,
	updateWalletHistoryFilters,
} from '@/features/srp/state/wallet-history-store'

describe('wallet history store', () => {
	beforeEach(() => {
		__resetWalletHistoryStoreForTests()
	})

	it('resets page when filters change', () => {
		setWalletHistoryPage(4)
		updateWalletHistoryFilters({ reason: 'test' })
		expect(getWalletHistoryUiState().page).toBe(1)
		expect(getWalletHistoryUiState().filters.reason).toBe('test')
	})

	it('updates page size and resets page', () => {
		setWalletHistoryPage(4)
		setWalletHistoryPageSize(100)
		expect(getWalletHistoryUiState().page).toBe(1)
		expect(getWalletHistoryUiState().pageSize).toBe(100)
	})

	it('supports incremental filter updates', () => {
		updateWalletHistoryFilters({ alertsOnly: true })
		expect(getWalletHistoryUiState().filters.alertsOnly).toBe(true)
	})
})
