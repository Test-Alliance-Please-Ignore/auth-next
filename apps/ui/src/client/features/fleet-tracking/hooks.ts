import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { fleetTrackingApi } from './api'

import type { ListSessionsFilter, StartSessionRequest, StatsRange } from './types'

export const fleetTrackingKeys = {
	all: ['fleet-tracking'] as const,
	lists: () => [...fleetTrackingKeys.all, 'list'] as const,
	list: (filter: ListSessionsFilter) => [...fleetTrackingKeys.lists(), filter] as const,
	sessions: () => [...fleetTrackingKeys.all, 'session'] as const,
	session: (id: string) => [...fleetTrackingKeys.sessions(), id] as const,
	live: (id: string) => [...fleetTrackingKeys.session(id), 'live'] as const,
	commanderHistory: (id: string) => [...fleetTrackingKeys.session(id), 'commander-history'] as const,
	timeline: (
		id: string,
		opts: { eventType?: 'join' | 'leave' | 'ship_change'; characterId?: string; limit?: number; offset?: number }
	) => [...fleetTrackingKeys.session(id), 'timeline', opts] as const,
	shipHistory: (id: string, characterId: string) =>
		[...fleetTrackingKeys.session(id), 'ship-history', characterId] as const,
	summary: (id: string) => [...fleetTrackingKeys.session(id), 'summary'] as const,
	broadcastLink: (id: string) => [...fleetTrackingKeys.session(id), 'broadcast-link'] as const,
}

export function useTrackingSessions(filter: ListSessionsFilter = {}) {
	return useQuery({
		queryKey: fleetTrackingKeys.list(filter),
		queryFn: () => fleetTrackingApi.listSessions(filter),
		staleTime: 5_000,
		placeholderData: keepPreviousData,
	})
}

export function useTrackingSession(
	sessionId: string | undefined,
	options: { refetchInterval?: number | false } = {}
) {
	return useQuery({
		queryKey: fleetTrackingKeys.session(sessionId ?? ''),
		queryFn: () => fleetTrackingApi.getSession(sessionId!),
		enabled: !!sessionId,
		refetchInterval: options.refetchInterval,
	})
}

export function useSessionLiveSnapshot(
	sessionId: string | undefined,
	options: { refetchInterval?: number | false } = {}
) {
	return useQuery({
		queryKey: fleetTrackingKeys.live(sessionId ?? ''),
		queryFn: () => fleetTrackingApi.getLiveSnapshot(sessionId!),
		enabled: !!sessionId,
		refetchInterval: options.refetchInterval,
	})
}

export function useSessionCurrentMembers(
	sessionId: string | undefined,
	options: { refetchInterval?: number | false } = {}
) {
	return useQuery({
		queryKey: [...fleetTrackingKeys.session(sessionId ?? ''), 'current-members'] as const,
		queryFn: () => fleetTrackingApi.getCurrentMembers(sessionId!),
		enabled: !!sessionId,
		refetchInterval: options.refetchInterval,
	})
}

export function useSessionRoster(sessionId: string | undefined) {
	return useQuery({
		queryKey: [...fleetTrackingKeys.session(sessionId ?? ''), 'roster'] as const,
		queryFn: () => fleetTrackingApi.getRoster(sessionId!),
		enabled: !!sessionId,
	})
}

export function useSessionTimeline(
	sessionId: string | undefined,
	opts: {
		eventType?: 'join' | 'leave' | 'ship_change'
		characterId?: string
		limit?: number
		offset?: number
	} = {},
	queryOptions: { refetchInterval?: number | false } = {}
) {
	return useQuery({
		queryKey: fleetTrackingKeys.timeline(sessionId ?? '', opts),
		queryFn: () => fleetTrackingApi.getTimeline(sessionId!, opts),
		enabled: !!sessionId,
		refetchInterval: queryOptions.refetchInterval,
		placeholderData: keepPreviousData,
	})
}

export function useMemberShipHistory(
	sessionId: string | undefined,
	characterId: string | undefined
) {
	return useQuery({
		queryKey: fleetTrackingKeys.shipHistory(sessionId ?? '', characterId ?? ''),
		queryFn: () => fleetTrackingApi.getMemberShipHistory(sessionId!, characterId!),
		enabled: !!sessionId && !!characterId,
		staleTime: 0,
		gcTime: 0,
		refetchOnMount: 'always',
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	})
}

export function useSessionSummary(sessionId: string | undefined) {
	return useQuery({
		queryKey: fleetTrackingKeys.summary(sessionId ?? ''),
		queryFn: () => fleetTrackingApi.getSummary(sessionId!),
		enabled: !!sessionId,
	})
}

export function useSessionCommanderHistory(
	sessionId: string | undefined,
	options: { refetchInterval?: number | false } = {}
) {
	return useQuery({
		queryKey: fleetTrackingKeys.commanderHistory(sessionId ?? ''),
		queryFn: () => fleetTrackingApi.getCommanderHistory(sessionId!),
		enabled: !!sessionId,
		refetchInterval: options.refetchInterval,
	})
}

export function useSessionBroadcastLink(sessionId: string | undefined) {
	return useQuery({
		queryKey: fleetTrackingKeys.broadcastLink(sessionId ?? ''),
		queryFn: () => fleetTrackingApi.getSessionBroadcastLink(sessionId!),
		enabled: !!sessionId,
	})
}

export function useStartTracking() {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (req: StartSessionRequest) => fleetTrackingApi.startSession(req),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: fleetTrackingKeys.lists() })
		},
	})
}

export function useStopTracking() {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (sessionId: string) => fleetTrackingApi.stopSession(sessionId),
		onSuccess: (_data, sessionId) => {
			qc.invalidateQueries({ queryKey: fleetTrackingKeys.lists() })
			qc.invalidateQueries({ queryKey: fleetTrackingKeys.session(sessionId) })
		},
	})
}

export function useKickTrackingMembers() {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: ({
			sessionId,
			memberCharacterIds,
		}: {
			sessionId: string
			memberCharacterIds: string[]
		}) => fleetTrackingApi.kickMembers(sessionId, memberCharacterIds),
		onSuccess: (_data, variables) => {
			qc.invalidateQueries({ queryKey: fleetTrackingKeys.live(variables.sessionId) })
			qc.invalidateQueries({
				queryKey: [...fleetTrackingKeys.session(variables.sessionId), 'current-members'] as const,
			})
			qc.invalidateQueries({ queryKey: [...fleetTrackingKeys.session(variables.sessionId), 'timeline'] })
		},
	})
}

// ===== Stats hooks =====

export const fleetStatsKeys = {
	all: ['fleet-tracking', 'stats'] as const,
	overview: (range?: Partial<StatsRange>) => [...fleetStatsKeys.all, 'overview', range] as const,
	character: (characterId: string, range?: Partial<StatsRange>) =>
		[...fleetStatsKeys.all, 'character', characterId, range] as const,
	user: (userId: string, range?: Partial<StatsRange>) =>
		[...fleetStatsKeys.all, 'user', userId, range] as const,
	corporation: (corporationId: string, range?: Partial<StatsRange>) =>
		[...fleetStatsKeys.all, 'corporation', corporationId, range] as const,
}

const STATS_STALE_TIME = 60_000

export function useStatsOverview(
	range?: Partial<StatsRange>,
	options?: { enabled?: boolean }
) {
	return useQuery({
		queryKey: fleetStatsKeys.overview(range),
		queryFn: () => fleetTrackingApi.getStatsOverview(range),
		staleTime: STATS_STALE_TIME,
		enabled: options?.enabled ?? true,
	})
}

export function useCharacterStats(characterId: string | undefined, range?: Partial<StatsRange>) {
	return useQuery({
		queryKey: fleetStatsKeys.character(characterId ?? '', range),
		queryFn: () => fleetTrackingApi.getCharacterStats(characterId!, range),
		enabled: !!characterId,
		staleTime: STATS_STALE_TIME,
	})
}

export function useUserStats(userId: string | undefined, range?: Partial<StatsRange>) {
	return useQuery({
		queryKey: fleetStatsKeys.user(userId ?? '', range),
		queryFn: () => fleetTrackingApi.getUserStats(userId!, range),
		enabled: !!userId,
		staleTime: STATS_STALE_TIME,
	})
}

export function useCorporationStats(
	corporationId: string | undefined,
	range?: Partial<StatsRange>,
	options?: { enabled?: boolean }
) {
	return useQuery({
		queryKey: fleetStatsKeys.corporation(corporationId ?? '', range),
		queryFn: () => fleetTrackingApi.getCorporationStats(corporationId!, range),
		enabled: options?.enabled ?? !!corporationId,
		staleTime: STATS_STALE_TIME,
	})
}

export function useStatsEntitySearch(query: string) {
	const trimmed = query.trim()
	return useQuery({
		queryKey: [...fleetStatsKeys.all, 'search', trimmed] as const,
		queryFn: () => fleetTrackingApi.searchStatsEntities(trimmed),
		enabled: trimmed.length >= 2,
		staleTime: STATS_STALE_TIME,
	})
}
