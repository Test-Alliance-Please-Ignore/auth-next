import { useSyncExternalStore } from 'react'

import type { RequestStatus, SRPRequestResponse } from '../types'

interface LossRequestOverlayEntry {
	requestId: string
	requestStatus: RequestStatus | string
	updatedAt: number
}

interface LossRequestOverlayState {
	byKillmailId: Record<string, LossRequestOverlayEntry>
	killmailIdByRequestId: Record<string, string>
}

const STORAGE_KEY = 'srp.loss-request-overlay.v1'

const listeners = new Set<() => void>()

function readStateFromStorage(): LossRequestOverlayState {
	if (typeof window === 'undefined') {
		return { byKillmailId: {}, killmailIdByRequestId: {} }
	}
	try {
		const raw = window.sessionStorage.getItem(STORAGE_KEY)
		if (!raw) return { byKillmailId: {}, killmailIdByRequestId: {} }
		const parsed = JSON.parse(raw) as LossRequestOverlayState
		if (!parsed || typeof parsed !== 'object') {
			return { byKillmailId: {}, killmailIdByRequestId: {} }
		}
		return {
			byKillmailId: parsed.byKillmailId ?? {},
			killmailIdByRequestId: parsed.killmailIdByRequestId ?? {},
		}
	} catch {
		return { byKillmailId: {}, killmailIdByRequestId: {} }
	}
}

let state: LossRequestOverlayState = readStateFromStorage()

function emitChange(): void {
	for (const listener of listeners) listener()
}

function persistState(): void {
	if (typeof window === 'undefined') return
	try {
		window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
	} catch {
		// Ignore storage failures; store still works in-memory for this session.
	}
}

function setState(next: LossRequestOverlayState): void {
	state = next
	persistState()
	emitChange()
}

export function upsertLossRequestOverlay(params: {
	killmailId: string
	requestId: string
	requestStatus: RequestStatus | string
}): void {
	const { killmailId, requestId, requestStatus } = params
	const next: LossRequestOverlayState = {
		byKillmailId: {
			...state.byKillmailId,
			[killmailId]: {
				requestId,
				requestStatus,
				updatedAt: Date.now(),
			},
		},
		killmailIdByRequestId: {
			...state.killmailIdByRequestId,
			[requestId]: killmailId,
		},
	}
	setState(next)
}

export function updateOverlayRequestStatus(params: {
	requestId: string
	requestStatus: RequestStatus | string
}): void {
	const { requestId, requestStatus } = params
	const killmailId = state.killmailIdByRequestId[requestId]
	if (!killmailId) return
	const existing = state.byKillmailId[killmailId]
	if (!existing) return
	setState({
		byKillmailId: {
			...state.byKillmailId,
			[killmailId]: {
				...existing,
				requestStatus,
				updatedAt: Date.now(),
			},
		},
		killmailIdByRequestId: state.killmailIdByRequestId,
	})
}

export function removeOverlayByKillmailId(killmailId: string): void {
	const existing = state.byKillmailId[killmailId]
	if (!existing) return
	const nextByKillmailId = { ...state.byKillmailId }
	delete nextByKillmailId[killmailId]
	const nextKillmailIdByRequestId = { ...state.killmailIdByRequestId }
	delete nextKillmailIdByRequestId[existing.requestId]
	setState({
		byKillmailId: nextByKillmailId,
		killmailIdByRequestId: nextKillmailIdByRequestId,
	})
}

export function removeOverlayByRequestId(requestId: string): void {
	const killmailId = state.killmailIdByRequestId[requestId]
	if (!killmailId) return
	removeOverlayByKillmailId(killmailId)
}

export function mergeLossesWithOverlay<
	T extends {
		killmailId: string
		hasSRPRequest: boolean
		srpRequestId?: string
		srpRequestStatus?: string
	},
>(losses: T[] | undefined): T[] | undefined {
	if (!losses) return losses
	return losses.map((loss) => {
		const entry = state.byKillmailId[loss.killmailId]
		if (!entry) return loss
		return {
			...loss,
			hasSRPRequest: true,
			srpRequestId: entry.requestId,
			srpRequestStatus: entry.requestStatus,
		}
	})
}

export function reconcileOverlayFromServerLosses(
	losses: Array<{
		killmailId: string
		hasSRPRequest: boolean
		srpRequestId?: string
		srpRequestStatus?: string
	}>
): void {
	let nextState: LossRequestOverlayState | null = null

	const ensureMutable = () => {
		if (nextState) return nextState
		nextState = {
			byKillmailId: { ...state.byKillmailId },
			killmailIdByRequestId: { ...state.killmailIdByRequestId },
		}
		return nextState
	}

	for (const loss of losses) {
		if (!loss.hasSRPRequest || !loss.srpRequestId) {
			const existing = state.byKillmailId[loss.killmailId]
			if (!existing) continue
			const mutable = ensureMutable()
			delete mutable.byKillmailId[loss.killmailId]
			delete mutable.killmailIdByRequestId[existing.requestId]
			continue
		}

		const existing = state.byKillmailId[loss.killmailId]
		const incomingStatus = loss.srpRequestStatus ?? 'pending'
		if (
			existing &&
			existing.requestId === loss.srpRequestId &&
			existing.requestStatus === incomingStatus
		) {
			continue
		}

		const mutable = ensureMutable()
		mutable.byKillmailId[loss.killmailId] = {
			requestId: loss.srpRequestId,
			requestStatus: incomingStatus,
			updatedAt: Date.now(),
		}
		mutable.killmailIdByRequestId[loss.srpRequestId] = loss.killmailId
	}

	if (nextState) setState(nextState)
}

export function mergeRequestsWithOverlay<T extends { id: string; requestStatus: string }>(
	requests: T[]
): T[] {
	return requests.map((request) => {
		const killmailId = state.killmailIdByRequestId[request.id]
		if (!killmailId) return request
		const entry = state.byKillmailId[killmailId]
		if (!entry) return request
		return {
			...request,
			requestStatus: entry.requestStatus,
		}
	})
}

export function seedOverlayFromRequest(request: Pick<SRPRequestResponse, 'id' | 'requestStatus'>): void {
	updateOverlayRequestStatus({
		requestId: request.id,
		requestStatus: request.requestStatus,
	})
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

function getSnapshot(): LossRequestOverlayState {
	return state
}

export function useLossRequestOverlaySnapshot(): LossRequestOverlayState {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function __resetLossRequestOverlayStoreForTests(): void {
	setState({
		byKillmailId: {},
		killmailIdByRequestId: {},
	})
}
