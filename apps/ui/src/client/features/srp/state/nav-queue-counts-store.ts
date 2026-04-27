import { useSyncExternalStore } from 'react'

interface SrpNavQueueCountsState {
	reviewQueueCount: number
	paymentQueueCount: number
	srpAlertCount: number
}

const listeners = new Set<() => void>()

let state: SrpNavQueueCountsState = {
	reviewQueueCount: 0,
	paymentQueueCount: 0,
	srpAlertCount: 0,
}

function emitChange(): void {
	for (const listener of listeners) listener()
}

function setState(next: SrpNavQueueCountsState): void {
	if (
		next.reviewQueueCount === state.reviewQueueCount &&
		next.paymentQueueCount === state.paymentQueueCount &&
		next.srpAlertCount === state.srpAlertCount
	) {
		return
	}
	state = next
	emitChange()
}

function coerceCount(input: number | undefined, fallback: number): number {
	if (typeof input !== 'number' || !Number.isFinite(input)) return fallback
	return Math.max(0, Math.trunc(input))
}

export function updateSrpNavQueueCounts(input: {
	reviewQueueCount?: number
	paymentQueueCount?: number
	srpAlertCount?: number
}): void {
	setState({
		reviewQueueCount: coerceCount(input.reviewQueueCount, state.reviewQueueCount),
		paymentQueueCount: coerceCount(input.paymentQueueCount, state.paymentQueueCount),
		srpAlertCount: coerceCount(input.srpAlertCount, state.srpAlertCount),
	})
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

function getSnapshot(): SrpNavQueueCountsState {
	return state
}

export function useSrpNavQueueCountsSnapshot(): SrpNavQueueCountsState {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function __resetSrpNavQueueCountsStoreForTests(): void {
	setState({
		reviewQueueCount: 0,
		paymentQueueCount: 0,
		srpAlertCount: 0,
	})
}

