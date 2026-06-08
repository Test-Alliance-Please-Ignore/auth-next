import { createStore } from '@tanstack/store'
import { useSyncExternalStore } from 'react'

interface PaymentQueueState {
	dismissedRequestIds: string[]
}

const paymentQueueStore = createStore<PaymentQueueState>({
	dismissedRequestIds: [],
})

export function dismissPaymentQueueRequest(requestId: string): void {
	paymentQueueStore.setState((state) => {
		if (state.dismissedRequestIds.includes(requestId)) return state
		return {
			dismissedRequestIds: [...state.dismissedRequestIds, requestId],
		}
	})
}

export function prunePaymentQueueDismissals(activeRequestIds: Iterable<string>): void {
	const active = new Set(activeRequestIds)
	paymentQueueStore.setState((state) => {
		const nextDismissedRequestIds = state.dismissedRequestIds.filter((id) => active.has(id))
		if (nextDismissedRequestIds.length === state.dismissedRequestIds.length) {
			let unchanged = true
			for (let i = 0; i < nextDismissedRequestIds.length; i += 1) {
				if (nextDismissedRequestIds[i] !== state.dismissedRequestIds[i]) {
					unchanged = false
					break
				}
			}
			if (unchanged) return state
		}
		return {
			dismissedRequestIds: nextDismissedRequestIds,
		}
	})
}

export function resetPaymentQueueDismissals(): void {
	paymentQueueStore.setState(() => ({
		dismissedRequestIds: [],
	}))
}

export function usePaymentQueueState<TSelected>(
	selector: (state: PaymentQueueState) => TSelected
): TSelected {
	return useSyncExternalStore(
		(listener) => paymentQueueStore.subscribe(listener).unsubscribe,
		() => selector(paymentQueueStore.state),
		() => selector(paymentQueueStore.state)
	)
}

export function getPaymentQueueState(): PaymentQueueState {
	return paymentQueueStore.state
}

export function __resetPaymentQueueStoreForTests(): void {
	resetPaymentQueueDismissals()
}
