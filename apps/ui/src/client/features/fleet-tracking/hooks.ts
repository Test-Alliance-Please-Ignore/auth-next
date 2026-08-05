import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { fleetTrackingApi } from './api'

import type { ListSessionsFilter, StartSessionRequest, StatsRangeInput } from './types'

export const fleetTrackingKeys = {
	all: ['fleet-tracking'] as const,
	lists: () => [...fleetTrackingKeys.all, 'list'] as const,
	list: (filter: ListSessionsFilter) => [...fleetTrackingKeys.lists(), filter] as const,
	sessions: () => [...fleetTrackingKeys.all, 'session'] as const,
	session: (id: string) => [...fleetTrackingKeys.sessions(), id] as const,
	live: (id: string) => [...fleetTrackingKeys.session(id), 'live'] as const,
	commanderHistory: (id: string) =>
		[...fleetTrackingKeys.session(id), 'commander-history'] as const,
	timeline: (
		id: string,
		opts: {
			eventType?: 'join' | 'leave' | 'ship_change'
			characterId?: string
			limit?: number
			offset?: number
		}
	) => [...fleetTrackingKeys.session(id), 'timeline', opts] as const,
	shipHistory: (id: string, characterId: string) =>
		[...fleetTrackingKeys.session(id), 'ship-history', characterId] as const,
	summary: (id: string) => [...fleetTrackingKeys.session(id), 'summary'] as const,
	broadcastLink: (id: string) => [...fleetTrackingKeys.session(id), 'broadcast-link'] as const,
}

export function useTrackingSessions(filter: ListSessionsFilter = {}) {
	const isHistorical = isHistoricalRange(filter.to)
	return useQuery({
		queryKey: fleetTrackingKeys.list(filter),
		queryFn: () => fleetTrackingApi.listSessions(filter),
		staleTime: isHistorical ? HISTORICAL_STATS_STALE_TIME : 5_000,
		gcTime: isHistorical ? HISTORICAL_STATS_GC_TIME : RECENT_STATS_GC_TIME,
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

export function useSessionLiveMemberLocations(
	sessionId: string | undefined,
	options: { refetchInterval?: number | false } = {}
) {
	return useQuery({
		queryKey: [...fleetTrackingKeys.session(sessionId ?? ''), 'current-members', 'live'] as const,
		queryFn: () => fleetTrackingApi.getLiveMemberLocations(sessionId!),
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
			void qc.invalidateQueries({ queryKey: fleetTrackingKeys.lists() })
		},
	})
}

export function useStopTracking() {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (sessionId: string) => fleetTrackingApi.stopSession(sessionId),
		onSuccess: (_data, sessionId) => {
			void qc.invalidateQueries({ queryKey: fleetTrackingKeys.lists() })
			void qc.invalidateQueries({ queryKey: fleetTrackingKeys.session(sessionId) })
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
			void qc.invalidateQueries({ queryKey: fleetTrackingKeys.live(variables.sessionId) })
			void qc.invalidateQueries({
				queryKey: [...fleetTrackingKeys.session(variables.sessionId), 'current-members'] as const,
			})
			void qc.invalidateQueries({
				queryKey: [...fleetTrackingKeys.session(variables.sessionId), 'timeline'],
			})
		},
	})
}

// ===== Stats hooks =====

export const fleetStatsKeys = {
	all: ['fleet-tracking', 'stats'] as const,
	overview: (range?: StatsRangeInput) => [...fleetStatsKeys.all, 'overview', range] as const,
	character: (characterId: string, range?: StatsRangeInput) =>
		[...fleetStatsKeys.all, 'character', characterId, range] as const,
	user: (userId: string, range?: StatsRangeInput) =>
		[...fleetStatsKeys.all, 'user', userId, range] as const,
	corporation: (corporationId: string, range?: StatsRangeInput) =>
		[...fleetStatsKeys.all, 'corporation', corporationId, range] as const,
	corporationExportMonths: (corporationId: string) =>
		[...fleetStatsKeys.all, 'corporation-export-months', corporationId] as const,
	corporationExportStatus: (corporationId: string, workflowInstanceId: string) =>
		[
			...fleetStatsKeys.all,
			'corporation-export-status',
			corporationId,
			workflowInstanceId,
		] as const,
}

const STATS_STALE_TIME = 60_000
const HISTORICAL_STATS_STALE_TIME = 30 * 60_000
const RECENT_STATS_GC_TIME = 30 * 60_000
const HISTORICAL_STATS_GC_TIME = 24 * 60 * 60_000

function isHistoricalRange(to: string | undefined): boolean {
	if (!to) return false
	const timestamp = Date.parse(to)
	return Number.isFinite(timestamp) && timestamp < Date.now() - 5 * 60_000
}

function getStatsCacheOptions(range?: StatsRangeInput) {
	const isHistorical = isHistoricalRange(range?.to)
	return {
		staleTime: isHistorical ? HISTORICAL_STATS_STALE_TIME : STATS_STALE_TIME,
		gcTime: isHistorical ? HISTORICAL_STATS_GC_TIME : RECENT_STATS_GC_TIME,
	}
}

export function useStatsOverview(range?: StatsRangeInput, options?: { enabled?: boolean }) {
	return useQuery({
		queryKey: fleetStatsKeys.overview(range),
		queryFn: () => fleetTrackingApi.getStatsOverview(range),
		...getStatsCacheOptions(range),
		enabled: options?.enabled ?? true,
	})
}

export function useCharacterStats(
	characterId: string | undefined,
	range?: StatsRangeInput,
	pagination?: { limit?: number; offset?: number }
) {
	return useQuery({
		queryKey: fleetStatsKeys.character(characterId ?? '', { ...range, ...pagination }),
		queryFn: () => fleetTrackingApi.getCharacterStats(characterId!, range, pagination),
		enabled: !!characterId,
		...getStatsCacheOptions(range),
		placeholderData: keepPreviousData,
	})
}

export function useUserStats(
	userId: string | undefined,
	range?: StatsRangeInput,
	pagination?: { limit?: number; offset?: number }
) {
	return useQuery({
		queryKey: fleetStatsKeys.user(userId ?? '', { ...range, ...pagination }),
		queryFn: () => fleetTrackingApi.getUserStats(userId!, range, pagination),
		enabled: !!userId,
		...getStatsCacheOptions(range),
		placeholderData: keepPreviousData,
	})
}

export function useCorporationStats(
	corporationId: string | undefined,
	range?: StatsRangeInput,
	options?: { enabled?: boolean }
) {
	return useQuery({
		queryKey: fleetStatsKeys.corporation(corporationId ?? '', range),
		queryFn: () => fleetTrackingApi.getCorporationStats(corporationId!, range),
		enabled: options?.enabled ?? !!corporationId,
		...getStatsCacheOptions(range),
	})
}

export function useCorporationParticipationExportMonths(
	corporationId: string | undefined,
	options?: { enabled?: boolean }
) {
	return useQuery({
		queryKey: fleetStatsKeys.corporationExportMonths(corporationId ?? ''),
		queryFn: () => fleetTrackingApi.getCorporationParticipationExportMonths(corporationId!),
		enabled: options?.enabled ?? !!corporationId,
		staleTime: 10 * 60_000,
	})
}

export function useStatsEntitySearch(query: string) {
	const trimmed = query.trim()
	return useQuery({
		queryKey: [...fleetStatsKeys.all, 'search', trimmed] as const,
		queryFn: () => fleetTrackingApi.searchStatsEntities(trimmed),
		enabled: trimmed.length >= 2,
		staleTime: STATS_STALE_TIME,
		gcTime: RECENT_STATS_GC_TIME,
	})
}
