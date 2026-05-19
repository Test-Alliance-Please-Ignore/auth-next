import { apiClient } from '../../lib/api'

import type {
	CharacterStatsResponse,
	CorporationStatsResponse,
	ListSessionsFilter,
	SessionCurrentMembersResponse,
	SessionRosterResponse,
	SessionLiveSnapshot,
	SessionMemberShipHistoryResponse,
	SessionSummary,
	SessionTimelineResult,
	StartSessionRequest,
	StatsOverviewResponse,
	StatsRange,
	StatsSearchResponse,
	TrackingSession,
	TrackingSessionListResult,
	UserStatsResponse,
} from './types'

function buildQuery(params: Record<string, string | number | undefined>): string {
	const search = new URLSearchParams()
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null) continue
		search.set(key, String(value))
	}
	const q = search.toString()
	return q ? `?${q}` : ''
}

export const fleetTrackingApi = {
	startSession: (req: StartSessionRequest): Promise<{ sessionId: string }> =>
		apiClient.post('/fleets/tracking', req),

	stopSession: (sessionId: string): Promise<{ ok: true }> =>
		apiClient.delete(`/fleets/tracking/${encodeURIComponent(sessionId)}`),

	listSessions: (filter: ListSessionsFilter = {}): Promise<TrackingSessionListResult> =>
		apiClient.get(
			`/fleets/tracking${buildQuery({
				status: filter.status,
				characterId: filter.characterId,
				userId: filter.userId,
				from: filter.from,
				to: filter.to,
				limit: filter.limit,
				offset: filter.offset,
			})}`
		),

	getSession: (sessionId: string): Promise<TrackingSession> =>
		apiClient.get(`/fleets/tracking/${encodeURIComponent(sessionId)}`),

	getLiveSnapshot: (sessionId: string): Promise<{ snapshot: SessionLiveSnapshot | null }> =>
		apiClient.get(`/fleets/tracking/${encodeURIComponent(sessionId)}/live`),

	getCurrentMembers: (sessionId: string): Promise<SessionCurrentMembersResponse> =>
		apiClient.get(`/fleets/tracking/${encodeURIComponent(sessionId)}/current-members`),

	getRoster: (sessionId: string): Promise<SessionRosterResponse> =>
		apiClient.get(`/fleets/tracking/${encodeURIComponent(sessionId)}/roster`),

	getTimeline: (
		sessionId: string,
		opts: { eventType?: 'join' | 'leave' | 'ship_change'; characterId?: string; limit?: number; offset?: number } = {}
	): Promise<SessionTimelineResult> =>
		apiClient.get(
			`/fleets/tracking/${encodeURIComponent(sessionId)}/timeline${buildQuery({
				eventType: opts.eventType,
				characterId: opts.characterId,
				limit: opts.limit,
				offset: opts.offset,
			})}`
		),

	getMemberShipHistory: (
		sessionId: string,
		characterId: string
	): Promise<SessionMemberShipHistoryResponse> =>
		apiClient.get(
			`/fleets/tracking/${encodeURIComponent(sessionId)}/members/${encodeURIComponent(characterId)}/ship-history`
		),

	getSummary: (sessionId: string): Promise<{ summary: SessionSummary | null }> =>
		apiClient.get(`/fleets/tracking/${encodeURIComponent(sessionId)}/summary`),

	// ===== Stats =====

	getStatsOverview: (range?: Partial<StatsRange>): Promise<StatsOverviewResponse> =>
		apiClient.get(`/fleets/tracking/stats/overview${buildQuery({ from: range?.from, to: range?.to })}`),

	getCharacterStats: (
		characterId: string,
		range?: Partial<StatsRange>
	): Promise<CharacterStatsResponse> =>
		apiClient.get(
			`/fleets/tracking/stats/characters/${encodeURIComponent(characterId)}${buildQuery({
				from: range?.from,
				to: range?.to,
			})}`
		),

	getUserStats: (userId: string, range?: Partial<StatsRange>): Promise<UserStatsResponse> =>
		apiClient.get(
			`/fleets/tracking/stats/users/${encodeURIComponent(userId)}${buildQuery({
				from: range?.from,
				to: range?.to,
			})}`
		),

	getCorporationStats: (
		corporationId: string,
		range?: Partial<StatsRange>
	): Promise<CorporationStatsResponse> =>
		apiClient.get(
			`/fleets/tracking/stats/corporations/${encodeURIComponent(corporationId)}${buildQuery({
				from: range?.from,
				to: range?.to,
			})}`
		),

	searchStatsEntities: (query: string): Promise<StatsSearchResponse> =>
		apiClient.get(`/fleets/tracking/stats/search${buildQuery({ q: query })}`),
}
