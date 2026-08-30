import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ConflictError } from '@/lib/api'

import { timerboardKeys } from './query-keys'

import type {
	CreateTimerboardEntryInput,
	TimerboardAssignmentInput,
	TimerboardEntry,
	TimerboardListQuery,
	TimerboardListResponse,
	TimerState,
	UpdateTimerboardEntryInput,
} from './types'

const TIMERBOARD_STALE_TIME = 30_000
const TIMERBOARD_GC_TIME = 30 * 60_000
const TIMERBOARD_REFETCH_INTERVAL = 30_000

export function useTimerboard(query: TimerboardListQuery, enabled = true) {
	return useQuery({
		queryKey: timerboardKeys.list(query),
		queryFn: () => api.getTimerboardEntries(query),
		placeholderData: keepPreviousData,
		staleTime: TIMERBOARD_STALE_TIME,
		gcTime: TIMERBOARD_GC_TIME,
		refetchInterval: TIMERBOARD_REFETCH_INTERVAL,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
		enabled,
	})
}

export function useTimerboardEntry(entryId: string | null) {
	const queryClient = useQueryClient()
	const cachedListEntry = () => {
		if (!entryId) return undefined
		for (const [queryKey, data] of queryClient.getQueriesData<TimerboardListResponse>({
			queryKey: timerboardKeys.lists(),
		})) {
			const entry = data?.items.find((item) => item.id === entryId)
			if (entry) {
				return {
					entry,
					updatedAt: queryClient.getQueryState(queryKey)?.dataUpdatedAt,
				}
			}
		}
		return undefined
	}

	return useQuery({
		queryKey: timerboardKeys.detail(entryId ?? ''),
		queryFn: () => api.getTimerboardEntry(entryId!),
		enabled: Boolean(entryId),
		staleTime: TIMERBOARD_STALE_TIME,
		gcTime: TIMERBOARD_GC_TIME,
		refetchInterval: TIMERBOARD_REFETCH_INTERVAL,
		refetchIntervalInBackground: false,
		initialData: () => cachedListEntry()?.entry,
		initialDataUpdatedAt: () => cachedListEntry()?.updatedAt,
	})
}

export function useTimerboardActivity(entryId: string | null) {
	return useQuery({
		queryKey: timerboardKeys.activity(entryId ?? ''),
		queryFn: () => api.getTimerboardActivity(entryId!),
		enabled: Boolean(entryId),
		staleTime: TIMERBOARD_STALE_TIME,
		gcTime: TIMERBOARD_GC_TIME,
		refetchInterval: TIMERBOARD_REFETCH_INTERVAL,
		refetchIntervalInBackground: false,
	})
}

function useTimerboardInvalidation() {
	const queryClient = useQueryClient()
	return async (entryId: string) => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: timerboardKeys.lists() }),
			queryClient.invalidateQueries({ queryKey: timerboardKeys.detail(entryId) }),
			queryClient.invalidateQueries({ queryKey: timerboardKeys.activity(entryId) }),
		])
	}
}

function useTimerboardConflictRecovery() {
	const queryClient = useQueryClient()
	return async (error: unknown, entryId: string) => {
		if (!(error instanceof ConflictError) || !error.current) return
		const current = error.current as Partial<TimerboardEntry>
		if (current.id !== entryId || typeof current.version !== 'number') return

		queryClient.setQueryData(timerboardKeys.detail(entryId), current as TimerboardEntry)
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: timerboardKeys.lists() }),
			queryClient.invalidateQueries({ queryKey: timerboardKeys.activity(entryId) }),
		])
	}
}

export function useCreateTimerboardEntry() {
	const invalidate = useTimerboardInvalidation()
	return useMutation({
		mutationFn: (input: CreateTimerboardEntryInput) => api.createTimerboardEntry(input),
		onSuccess: (entry) => invalidate(entry.id),
	})
}

export function useUpdateTimerboardEntry() {
	const invalidate = useTimerboardInvalidation()
	return useMutation({
		mutationFn: ({ entryId, input }: { entryId: string; input: UpdateTimerboardEntryInput }) =>
			api.updateTimerboardEntry(entryId, input),
		onSuccess: (entry) => invalidate(entry.id),
	})
}

export function useSetTimerboardState() {
	const invalidate = useTimerboardInvalidation()
	const recoverConflict = useTimerboardConflictRecovery()
	return useMutation({
		mutationFn: ({
			entryId,
			state,
			expectedVersion,
		}: {
			entryId: string
			state: TimerState
			expectedVersion: number
		}) => api.setTimerboardEntryState(entryId, state, expectedVersion),
		onSuccess: (entry) => invalidate(entry.id),
		onError: (error, variables) => recoverConflict(error, variables.entryId),
	})
}

export function useAssignTimerboardEntry() {
	const invalidate = useTimerboardInvalidation()
	const recoverConflict = useTimerboardConflictRecovery()
	return useMutation({
		mutationFn: ({ entryId, input }: { entryId: string; input: TimerboardAssignmentInput }) =>
			api.assignTimerboardEntry(entryId, input),
		onSuccess: (entry) => invalidate(entry.id),
		onError: (error, variables) => recoverConflict(error, variables.entryId),
	})
}
