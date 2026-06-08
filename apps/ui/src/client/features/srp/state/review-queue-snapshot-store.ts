import { createStore } from '@tanstack/store'
import { useSyncExternalStore } from 'react'

import type { RequestStatus, RequestListResponse, SRPRequestResponse } from '../types'

export type ReviewQueueParams = {
	limit?: number
	offset?: number
	characterName?: string
	shipTypeName?: string
	solarSystemName?: string
	dateFrom?: string
	dateTo?: string
}

export type ReviewQueueSortBy = 'submitted' | 'loss'
export type ReviewQueueSortDirection = 'asc' | 'desc'

export interface ReviewQueueSnapshotEntry {
	status: RequestStatus
	params: ReviewQueueParams
	data: RequestListResponse
	updatedAt: number
}

export type ReviewQueueUiState = {
	activeTab: RequestStatus
	filters: ReviewQueueParams
	page: number
	pageSize: number
	sortBy: ReviewQueueSortBy
	sortDirection: ReviewQueueSortDirection
}

export type ReviewQueueSnapshotState = Record<string, ReviewQueueSnapshotEntry>
export type ReviewQueueEntityState = Record<string, SRPRequestResponse>

export interface ReviewQueueStoreState {
	ui: ReviewQueueUiState
	snapshots: ReviewQueueSnapshotState
	entities: ReviewQueueEntityState
}

export const REVIEW_QUEUE_CACHE_TTL_MS = 1000 * 60 * 5

const STORAGE_KEY = 'srp.review-queue-state.v1'
const LEGACY_SNAPSHOT_STORAGE_KEY = 'srp.review-queue-snapshot.v1'
const LEGACY_ACTIVE_TAB_STORAGE_KEY = 'srp:review-queue:active-tab'

const REVIEW_QUEUE_TAB_VALUES = new Set<RequestStatus>([
	'pending',
	'needs_context',
	'rejected',
	'approved',
	'paid',
])

const listeners = new Set<() => void>()

function getDefaultSortDirectionForStatus(status: RequestStatus): ReviewQueueSortDirection {
	return status === 'approved' || status === 'rejected' || status === 'paid' ? 'desc' : 'asc'
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

function isUnfilteredParams(params: ReviewQueueParams): boolean {
	return !(
		params.characterName ||
		params.shipTypeName ||
		params.solarSystemName ||
		params.dateFrom ||
		params.dateTo
	)
}

function getSnapshotKey(status: RequestStatus, params: ReviewQueueParams): string {
	return `${status}:${JSON.stringify(normalizeParams(params))}`
}

function isFresh(updatedAt: number, maxAgeMs: number): boolean {
	return Date.now() - updatedAt <= maxAgeMs
}

function mergeEntities(
	existing: ReviewQueueEntityState,
	requests: readonly SRPRequestResponse[]
): ReviewQueueEntityState {
	if (requests.length === 0) return existing

	let changed = false
	const nextEntities = { ...existing }
	for (const request of requests) {
		if (nextEntities[request.id] === request) continue
		nextEntities[request.id] = request
		changed = true
	}

	return changed ? nextEntities : existing
}

function defaultUiState(): ReviewQueueUiState {
	return {
		activeTab: 'pending',
		filters: {},
		page: 1,
		pageSize: 25,
		sortBy: 'submitted',
		sortDirection: getDefaultSortDirectionForStatus('pending'),
	}
}

function readLegacyStateFromStorage(): Partial<ReviewQueueStoreState> {
	if (typeof window === 'undefined') return {}

	try {
		const snapshotsRaw = window.sessionStorage.getItem(LEGACY_SNAPSHOT_STORAGE_KEY)
		const activeTabRaw = window.sessionStorage.getItem(LEGACY_ACTIVE_TAB_STORAGE_KEY)

		let snapshots: ReviewQueueSnapshotState = {}
		if (snapshotsRaw) {
			const parsed = JSON.parse(snapshotsRaw) as ReviewQueueSnapshotState
			if (parsed && typeof parsed === 'object') snapshots = parsed
		}

		const legacyActiveTab =
			activeTabRaw && REVIEW_QUEUE_TAB_VALUES.has(activeTabRaw as RequestStatus)
				? (activeTabRaw as RequestStatus)
				: undefined

		return {
			ui: {
				...defaultUiState(),
				activeTab: legacyActiveTab ?? defaultUiState().activeTab,
				sortDirection: getDefaultSortDirectionForStatus(legacyActiveTab ?? 'pending'),
			},
			snapshots,
		}
	} catch {
		return {}
	}
}

function readStateFromStorage(): ReviewQueueStoreState {
	if (typeof window === 'undefined') {
		return {
			ui: defaultUiState(),
			snapshots: {},
			entities: {},
		}
	}

	try {
		const raw = window.sessionStorage.getItem(STORAGE_KEY)
		if (raw) {
			const parsed = JSON.parse(raw) as ReviewQueueStoreState
			if (parsed && typeof parsed === 'object') {
				const snapshots = parsed.snapshots ?? {}
				return {
					ui: {
						...defaultUiState(),
						...parsed.ui,
						filters: normalizeParams(parsed.ui?.filters ?? {}),
						sortDirection:
							parsed.ui?.sortDirection ?? getDefaultSortDirectionForStatus(parsed.ui?.activeTab ?? 'pending'),
					},
					snapshots,
					entities: parsed.entities ?? {},
				}
			}
		}
	} catch {
		// Fall through to legacy state or defaults.
	}

	const legacy = readLegacyStateFromStorage()
	return {
		ui: {
			...defaultUiState(),
			...legacy.ui,
			filters: normalizeParams(legacy.ui?.filters ?? {}),
		},
		snapshots: legacy.snapshots ?? {},
		entities: {},
	}
}

const reviewQueueStore = createStore<ReviewQueueStoreState>(readStateFromStorage())

function emitChange(): void {
	for (const listener of listeners) listener()
}

function persistState(): void {
	if (typeof window === 'undefined') return
	try {
		window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(reviewQueueStore.state))
	} catch {
		// Ignore storage failures; keep in-memory state for this session.
	}
}

reviewQueueStore.subscribe(() => {
	persistState()
	emitChange()
})

function updateState(
	updater: (previous: ReviewQueueStoreState) => ReviewQueueStoreState
): void {
	reviewQueueStore.setState((previous) => {
		const next = updater(previous)
		if (next === previous) return previous
		return next
	})
}

function normalizeUiFilters(filters: ReviewQueueParams): ReviewQueueParams {
	return normalizeParams(filters)
}

export function useReviewQueueStore<TSelected>(
	selector: (state: ReviewQueueStoreState) => TSelected
): TSelected {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		() => selector(reviewQueueStore.state),
		() => selector(reviewQueueStore.state)
	)
}

export function useReviewQueueUiState<TSelected>(
	selector: (state: ReviewQueueUiState) => TSelected
): TSelected {
	return useReviewQueueStore((state) => selector(state.ui))
}

export function getReviewQueueUiState(): ReviewQueueUiState {
	return reviewQueueStore.state.ui
}

export function setReviewQueueActiveTab(nextTab: RequestStatus): void {
	updateState((previous) => ({
		...previous,
		ui: {
			...previous.ui,
			activeTab: nextTab,
			page: 1,
			sortDirection: getDefaultSortDirectionForStatus(nextTab),
		},
	}))
}

export function updateReviewQueueFilters(
	patch: Partial<ReviewQueueParams> | ((previous: ReviewQueueParams) => ReviewQueueParams)
): void {
	updateState((previous) => {
		const nextFilters =
			typeof patch === 'function' ? patch(previous.ui.filters) : { ...previous.ui.filters, ...patch }
		return {
			...previous,
			ui: {
				...previous.ui,
				filters: normalizeUiFilters(nextFilters),
				page: 1,
			},
		}
	})
}

export function setReviewQueuePage(page: number): void {
	updateState((previous) => ({
		...previous,
		ui: {
			...previous.ui,
			page: Math.max(1, page),
		},
	}))
}

export function setReviewQueuePageSize(pageSize: number): void {
	updateState((previous) => ({
		...previous,
		ui: {
			...previous.ui,
			pageSize: Math.max(1, pageSize),
			page: 1,
		},
	}))
}

export function toggleReviewQueueSort(nextSortBy: ReviewQueueSortBy): void {
	updateState((previous) => {
		const nextSortDirection: ReviewQueueSortDirection =
			previous.ui.sortBy === nextSortBy
				? previous.ui.sortDirection === 'asc'
					? 'desc'
					: 'asc'
				: getDefaultSortDirectionForStatus(previous.ui.activeTab)

		return {
			...previous,
			ui: {
				...previous.ui,
				sortBy: nextSortBy,
				sortDirection: nextSortDirection,
			},
		}
	})
}

export function setReviewQueueSort(
	sortBy: ReviewQueueSortBy,
	sortDirection: ReviewQueueSortDirection
): void {
	updateState((previous) => ({
		...previous,
		ui: {
			...previous.ui,
			sortBy,
			sortDirection,
		},
	}))
}

export function setReviewQueueSnapshot(
	status: RequestStatus,
	params: ReviewQueueParams,
	data: RequestListResponse
): void {
	const key = getSnapshotKey(status, params)
	updateState((previous) => ({
		...previous,
		snapshots: {
			...previous.snapshots,
			[key]: {
				status,
				params: normalizeParams(params),
				data,
				updatedAt: Date.now(),
			},
		},
		entities: mergeEntities(previous.entities, data.requests),
	}))
}

export function useReviewQueueEntityMap(): ReviewQueueEntityState {
	return useReviewQueueStore((state) => state.entities)
}

export function useReviewQueueStatusCount(status: RequestStatus): number | undefined {
	return useReviewQueueStore((state) => {
		let latestMatch: ReviewQueueSnapshotEntry | undefined
		for (const entry of Object.values(state.snapshots)) {
			if (entry.status !== status) continue
			if (!isUnfilteredParams(entry.params)) continue
			if (!isFresh(entry.updatedAt, REVIEW_QUEUE_CACHE_TTL_MS)) continue
			if (!latestMatch || entry.updatedAt > latestMatch.updatedAt) {
				latestMatch = entry
			}
		}
		return latestMatch?.data.total
	})
}

export function clearReviewQueueSnapshots(): void {
	updateState((previous) => ({
		...previous,
		snapshots: {},
		entities: {},
	}))
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
	updateState((previous) => {
		const nextSnapshots: ReviewQueueSnapshotState = {}

		for (const [key, entry] of Object.entries(previous.snapshots)) {
			let nextRequests = entry.data.requests
			let nextTotal = entry.data.total

			const idx = entry.data.requests.findIndex((row) => row.id === request.id)
			const shouldInclude =
				entry.status === request.requestStatus && matchesSnapshotFilters(request, entry.params)

			if (idx >= 0) {
				changed = true
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
				nextRequests = [request, ...entry.data.requests]
				if (entry.params.limit && nextRequests.length > entry.params.limit) {
					nextRequests = nextRequests.slice(0, entry.params.limit)
				}
				nextTotal = nextTotal + 1
			}

			nextSnapshots[key] = {
				...entry,
				data: {
					...entry.data,
					requests: nextRequests,
					total: nextTotal,
				},
				updatedAt: nextRequests === entry.data.requests && nextTotal === entry.data.total ? entry.updatedAt : Date.now(),
			}
		}

		if (!changed) return previous
		return {
			...previous,
			snapshots: nextSnapshots,
			entities:
				previous.entities[request.id] === request
					? previous.entities
					: {
							...previous.entities,
							[request.id]: request,
						},
		}
	})
}

export function transitionRequestStatusAcrossReviewQueueSnapshots(
	requestId: string,
	nextStatus: RequestStatus
): void {
	let changed = false
	updateState((previous) => {
		const nextSnapshots: ReviewQueueSnapshotState = {}
		const candidatesToInsert: SRPRequestResponse[] = []

		for (const [key, entry] of Object.entries(previous.snapshots)) {
			const idx = entry.data.requests.findIndex((row) => row.id === requestId)
			if (idx < 0) {
				nextSnapshots[key] = entry
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
				nextSnapshots[key] = {
					...entry,
					data: {
						...entry.data,
						requests: nextRequests,
					},
					updatedAt: Date.now(),
				}
				continue
			}

			nextSnapshots[key] = {
				...entry,
				data: {
					...entry.data,
					requests: entry.data.requests.filter((row) => row.id !== requestId),
					total: Math.max(0, entry.data.total - 1),
				},
				updatedAt: Date.now(),
			}
		}

		if (!changed) return previous

		for (const [key, entry] of Object.entries(nextSnapshots)) {
			if (entry.status !== nextStatus) continue
			if (entry.params.offset != null && entry.params.offset > 0) continue
			const alreadyPresent = entry.data.requests.some((row) => row.id === requestId)
			if (alreadyPresent) continue
			const candidate = candidatesToInsert.find((row) => matchesSnapshotFilters(row, entry.params))
			if (!candidate) continue
			const nextRequests = [candidate, ...entry.data.requests]
			const limit = entry.params.limit
			nextSnapshots[key] = {
				...entry,
				data: {
					...entry.data,
					requests: limit ? nextRequests.slice(0, limit) : nextRequests,
					total: entry.data.total + 1,
				},
				updatedAt: Date.now(),
			}
		}

		return {
			...previous,
			snapshots: nextSnapshots,
			entities: mergeEntities(previous.entities, candidatesToInsert),
		}
	})
}

export function snapshotReviewQueueStateForRollback(): ReviewQueueStoreState {
	return structuredClone(reviewQueueStore.state)
}

export function restoreReviewQueueStateFromRollback(next: ReviewQueueStoreState): void {
	reviewQueueStore.setState(() => structuredClone(next))
}

export function __resetReviewQueueSnapshotStoreForTests(): void {
	updateState(() => ({
		ui: defaultUiState(),
		snapshots: {},
		entities: {},
	}))
}
