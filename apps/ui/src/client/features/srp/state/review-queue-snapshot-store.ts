import type { RequestStatus, RequestListResponse } from '../types'
import type { SRPRequestResponse } from '../types'

type ReviewQueueParams = {
	limit?: number
	offset?: number
	characterName?: string
	shipTypeName?: string
	solarSystemName?: string
	dateFrom?: string
	dateTo?: string
}

export interface ReviewQueueSnapshotEntry {
	status: RequestStatus
	params: ReviewQueueParams
	data: RequestListResponse
	updatedAt: number
}

export type ReviewQueueSnapshotState = Record<string, ReviewQueueSnapshotEntry>

const STORAGE_KEY = 'srp.review-queue-snapshot.v1'

let state: ReviewQueueSnapshotState = readStateFromStorage()

function readStateFromStorage(): ReviewQueueSnapshotState {
	if (typeof window === 'undefined') return {}
	try {
		const raw = window.sessionStorage.getItem(STORAGE_KEY)
		if (!raw) return {}
		const parsed = JSON.parse(raw) as ReviewQueueSnapshotState
		return parsed && typeof parsed === 'object' ? parsed : {}
	} catch {
		return {}
	}
}

function persistState(): void {
	if (typeof window === 'undefined') return
	try {
		window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
	} catch {
		// Ignore storage failures; keep in-memory fallback for current session.
	}
}

function normalizeParams(params: ReviewQueueParams): ReviewQueueParams {
	return {
		limit: params.limit,
		offset: params.offset,
		characterName: params.characterName,
		shipTypeName: params.shipTypeName,
		solarSystemName: params.solarSystemName,
		dateFrom: params.dateFrom,
		dateTo: params.dateTo,
	}
}

export function getReviewQueueSnapshotKey(
	status: RequestStatus,
	params: ReviewQueueParams
): string {
	return `${status}:${JSON.stringify(normalizeParams(params))}`
}

export function getReviewQueueSnapshot(
	status: RequestStatus,
	params: ReviewQueueParams
): RequestListResponse | undefined {
	const key = getReviewQueueSnapshotKey(status, params)
	return state[key]?.data
}

export function setReviewQueueSnapshot(
	status: RequestStatus,
	params: ReviewQueueParams,
	data: RequestListResponse
): void {
	const key = getReviewQueueSnapshotKey(status, params)
	state = {
		...state,
		[key]: {
			status,
			params: normalizeParams(params),
			data,
			updatedAt: Date.now(),
		},
	}
	persistState()
}

export function clearReviewQueueSnapshots(): void {
	state = {}
	if (typeof window !== 'undefined') {
		window.sessionStorage.removeItem(STORAGE_KEY)
	}
}

function matchesSnapshotFilters(
	request: SRPRequestResponse,
	params: ReviewQueueParams
): boolean {
	if (params.characterName && request.characterName !== params.characterName) return false
	if (params.shipTypeName && request.shipTypeName !== params.shipTypeName) return false
	if (params.solarSystemName && request.solarSystemName !== params.solarSystemName) return false

	if (params.dateFrom || params.dateTo) {
		const requestTime = request.lossDate ? Date.parse(request.lossDate) : Number.NaN
		if (Number.isNaN(requestTime)) return false
		if (params.dateFrom) {
			const from = Date.parse(params.dateFrom)
			if (!Number.isNaN(from) && requestTime < from) return false
		}
		if (params.dateTo) {
			const to = Date.parse(params.dateTo)
			if (!Number.isNaN(to) && requestTime > to) return false
		}
	}

	return true
}

export function upsertRequestAcrossReviewQueueSnapshots(request: SRPRequestResponse): void {
	let changed = false
	const nextState: ReviewQueueSnapshotState = {}
	for (const [key, entry] of Object.entries(state)) {
		let entryChanged = false
		const idx = entry.data.requests.findIndex((row) => row.id === request.id)
		let nextRequests = entry.data.requests
		let nextTotal = entry.data.total

		const shouldInclude =
			entry.status === request.requestStatus && matchesSnapshotFilters(request, entry.params)

		if (idx >= 0) {
			changed = true
			entryChanged = true
			if (shouldInclude) {
				nextRequests = [...entry.data.requests]
				nextRequests[idx] = request
			} else {
				nextRequests = entry.data.requests.filter((row) => row.id !== request.id)
				nextTotal = Math.max(0, nextTotal - 1)
			}
		} else if (
			shouldInclude &&
			(entry.params.offset === undefined || entry.params.offset === 0)
		) {
			changed = true
			entryChanged = true
			nextRequests = [request, ...entry.data.requests]
			if (entry.params.limit && nextRequests.length > entry.params.limit) {
				nextRequests = nextRequests.slice(0, entry.params.limit)
			}
			nextTotal = nextTotal + 1
		}

		nextState[key] = {
			...entry,
			data: {
				...entry.data,
				requests: nextRequests,
				total: nextTotal,
			},
			updatedAt: entryChanged ? Date.now() : entry.updatedAt,
		}
	}

	if (!changed) return
	state = nextState
	persistState()
}

export function transitionRequestStatusAcrossReviewQueueSnapshots(
	requestId: string,
	nextStatus: RequestStatus
): void {
	let changed = false
	const nextState: ReviewQueueSnapshotState = {}
	const candidatesToInsert: SRPRequestResponse[] = []

	for (const [key, entry] of Object.entries(state)) {
		const idx = entry.data.requests.findIndex((row) => row.id === requestId)
		if (idx < 0) {
			nextState[key] = entry
			continue
		}

		changed = true
		const current = entry.data.requests[idx]
		const transitioned: SRPRequestResponse = {
			...current,
			requestStatus: nextStatus,
		}
		candidatesToInsert.push(transitioned)

		const keepInPlace =
			entry.status === nextStatus && matchesSnapshotFilters(transitioned, entry.params)
		if (keepInPlace) {
			const nextRequests = [...entry.data.requests]
			nextRequests[idx] = transitioned
			nextState[key] = {
				...entry,
				data: {
					...entry.data,
					requests: nextRequests,
				},
				updatedAt: Date.now(),
			}
			continue
		}

		nextState[key] = {
			...entry,
			data: {
				...entry.data,
				requests: entry.data.requests.filter((row) => row.id !== requestId),
				total: Math.max(0, entry.data.total - 1),
			},
			updatedAt: Date.now(),
		}
	}

	if (!changed) return

	for (const [key, entry] of Object.entries(nextState)) {
		if (entry.status !== nextStatus) continue
		if (entry.params.offset != null && entry.params.offset > 0) continue
		const alreadyPresent = entry.data.requests.some((row) => row.id === requestId)
		if (alreadyPresent) continue
		const candidate = candidatesToInsert.find((row) => matchesSnapshotFilters(row, entry.params))
		if (!candidate) continue
		const nextRequests = [candidate, ...entry.data.requests]
		const limit = entry.params.limit
		nextState[key] = {
			...entry,
			data: {
				...entry.data,
				requests: limit ? nextRequests.slice(0, limit) : nextRequests,
				total: entry.data.total + 1,
			},
			updatedAt: Date.now(),
		}
	}

	state = nextState
	persistState()
}

export function snapshotReviewQueueStateForRollback(): ReviewQueueSnapshotState {
	return structuredClone(state)
}

export function restoreReviewQueueStateFromRollback(next: ReviewQueueSnapshotState): void {
	state = structuredClone(next)
	persistState()
}

export function __resetReviewQueueSnapshotStoreForTests(): void {
	clearReviewQueueSnapshots()
}
