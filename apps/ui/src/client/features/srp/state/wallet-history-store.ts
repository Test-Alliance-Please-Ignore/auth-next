import { createStore } from '@tanstack/store'
import { useSyncExternalStore } from 'react'

export type WalletHistoryFilters = {
	reason?: string
	recipientId?: string
	alertsOnly?: boolean
	dateFrom?: string
	dateTo?: string
}

export interface WalletHistoryUiState {
	filters: WalletHistoryFilters
	page: number
	pageSize: number
}

const walletHistoryStore = createStore<WalletHistoryUiState>({
	filters: {},
	page: 1,
	pageSize: 50,
})

function persistentlyNormalizeFilters(filters: WalletHistoryFilters): WalletHistoryFilters {
	return {
		reason: filters.reason,
		recipientId: filters.recipientId,
		alertsOnly: filters.alertsOnly,
		dateFrom: filters.dateFrom,
		dateTo: filters.dateTo,
	}
}

export function updateWalletHistoryFilters(
	patch: Partial<WalletHistoryFilters> | ((previous: WalletHistoryFilters) => WalletHistoryFilters)
): void {
	walletHistoryStore.setState((state) => {
		const nextFilters =
			typeof patch === 'function' ? patch(state.filters) : { ...state.filters, ...patch }
		return {
			...state,
			filters: persistentlyNormalizeFilters(nextFilters),
			page: 1,
		}
	})
}

export function setWalletHistoryPage(page: number): void {
	walletHistoryStore.setState((state) => ({
		...state,
		page: Math.max(1, page),
	}))
}

export function setWalletHistoryPageSize(pageSize: number): void {
	walletHistoryStore.setState((state) => ({
		...state,
		pageSize: Math.max(1, pageSize),
		page: 1,
	}))
}

export function useWalletHistoryUiState<TSelected>(
	selector: (state: WalletHistoryUiState) => TSelected
): TSelected {
	return useSyncExternalStore(
		(listener) => walletHistoryStore.subscribe(listener).unsubscribe,
		() => selector(walletHistoryStore.state),
		() => selector(walletHistoryStore.state)
	)
}

export function getWalletHistoryUiState(): WalletHistoryUiState {
	return walletHistoryStore.state
}

export function __resetWalletHistoryStoreForTests(): void {
	walletHistoryStore.setState(() => ({
		filters: {},
		page: 1,
		pageSize: 50,
	}))
}
