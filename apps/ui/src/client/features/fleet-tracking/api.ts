import { apiClient } from '../../lib/api'

import type {
	CharacterStatsResponse,
	CorporationStatsResponse,
	FleetParticipationExportMonthsResponse,
	FleetParticipationExportStartResponse,
	FleetParticipationExportStatusResponse,
	KickTrackingMembersResponse,
	ListSessionsFilter,
	SessionBroadcastLink,
	SessionCommanderHistoryResponse,
	SessionCurrentMembersResponse,
	SessionLiveMemberLocation,
	SessionLiveSnapshotResult,
	SessionMemberShipHistoryResponse,
	SessionRosterResponse,
	SessionSummary,
	SessionTimelineResult,
	StartSessionRequest,
	StatsOverviewResponse,
	StatsRangeInput,
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

	getSessionBroadcastLink: (
		sessionId: string
	): Promise<{ broadcast: SessionBroadcastLink | null }> =>
		apiClient
			.get<{
				broadcast:
					| ({
							id: string
							title: string
							status: string
							sentAt: string | null
							srpMode?: 'blanket' | 'military' | 'coalition' | 'disabled' | null
							srpToken?: string | null
							doctrineId?: string | null
							content?: Record<string, unknown>
					  } & Record<string, unknown>)
					| null
			}>(`/broadcasts/by-fleet-session/${encodeURIComponent(sessionId)}`)
			.then((resp) => ({
				broadcast: resp.broadcast
					? {
							id: resp.broadcast.id,
							title: resp.broadcast.title,
							status: resp.broadcast.status,
							sentAt: resp.broadcast.sentAt ?? null,
							srpMode: resp.broadcast.srpMode ?? null,
							srpToken: resp.broadcast.srpToken ?? null,
							doctrineId: resp.broadcast.doctrineId ?? null,
							doctrine:
								typeof resp.broadcast.content?.doctrine === 'string'
									? resp.broadcast.content.doctrine
									: null,
						}
					: null,
			})),

	getLiveSnapshot: (sessionId: string): Promise<SessionLiveSnapshotResult> =>
		apiClient.get(`/fleets/tracking/${encodeURIComponent(sessionId)}/live`),

	getCurrentMembers: (sessionId: string): Promise<SessionCurrentMembersResponse> =>
		apiClient.get(`/fleets/tracking/${encodeURIComponent(sessionId)}/current-members`),

	getLiveMemberLocations: (sessionId: string): Promise<{ members: SessionLiveMemberLocation[] }> =>
		apiClient.get(`/fleets/tracking/${encodeURIComponent(sessionId)}/current-members/live`),

	kickMembers: (
		sessionId: string,
		memberCharacterIds: string[]
	): Promise<KickTrackingMembersResponse> =>
		apiClient.post(`/fleets/tracking/${encodeURIComponent(sessionId)}/kick-members`, {
			memberCharacterIds,
		}),

	getRoster: (sessionId: string): Promise<SessionRosterResponse> =>
		apiClient.get(`/fleets/tracking/${encodeURIComponent(sessionId)}/roster`),

	getTimeline: (
		sessionId: string,
		opts: {
			eventType?: 'join' | 'leave' | 'ship_change'
			characterId?: string
			limit?: number
			offset?: number
		} = {}
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

	getCommanderHistory: (sessionId: string): Promise<SessionCommanderHistoryResponse> =>
		apiClient.get(`/fleets/tracking/${encodeURIComponent(sessionId)}/commander-history`),

	getSummary: (sessionId: string): Promise<{ summary: SessionSummary | null }> =>
		apiClient.get(`/fleets/tracking/${encodeURIComponent(sessionId)}/summary`),

	// ===== Stats =====

	getStatsOverview: (range?: StatsRangeInput): Promise<StatsOverviewResponse> =>
		apiClient.get(
			`/fleets/tracking/stats/overview${buildQuery({
				from: range?.from,
				to: range?.to,
				allTime: range?.allTime ? 'true' : undefined,
			})}`
		),

	getCharacterStats: (
		characterId: string,
		range?: StatsRangeInput,
		pagination?: { limit?: number; offset?: number }
	): Promise<CharacterStatsResponse> =>
		apiClient.get(
			`/fleets/tracking/stats/characters/${encodeURIComponent(characterId)}${buildQuery({
				from: range?.from,
				to: range?.to,
				allTime: range?.allTime ? 'true' : undefined,
				limit: pagination?.limit,
				offset: pagination?.offset,
			})}`
		),

	getUserStats: (
		userId: string,
		range?: StatsRangeInput,
		pagination?: { limit?: number; offset?: number }
	): Promise<UserStatsResponse> =>
		apiClient.get(
			`/fleets/tracking/stats/users/${encodeURIComponent(userId)}${buildQuery({
				from: range?.from,
				to: range?.to,
				allTime: range?.allTime ? 'true' : undefined,
				limit: pagination?.limit,
				offset: pagination?.offset,
			})}`
		),

	getCorporationStats: (
		corporationId: string,
		range?: StatsRangeInput
	): Promise<CorporationStatsResponse> =>
		apiClient.get(
			`/fleets/tracking/stats/corporations/${encodeURIComponent(corporationId)}${buildQuery({
				from: range?.from,
				to: range?.to,
				allTime: range?.allTime ? 'true' : undefined,
			})}`
		),

	getCorporationParticipationExportMonths: (
		corporationId: string
	): Promise<FleetParticipationExportMonthsResponse> =>
		apiClient.get(
			`/fleets/tracking/stats/corporations/${encodeURIComponent(corporationId)}/export-months`
		),

	startCorporationParticipationExport: (
		corporationId: string,
		dateFrom: string,
		dateTo: string
	): Promise<FleetParticipationExportStartResponse> =>
		apiClient.post(
			`/fleets/tracking/stats/corporations/${encodeURIComponent(corporationId)}/export`,
			{ dateFrom, dateTo }
		),

	getCorporationParticipationExportStatus: (
		corporationId: string,
		workflowInstanceId: string
	): Promise<FleetParticipationExportStatusResponse> =>
		apiClient.get(
			`/fleets/tracking/stats/corporations/${encodeURIComponent(corporationId)}/export/${encodeURIComponent(workflowInstanceId)}`
		),

	downloadCorporationParticipationExport: async (
		corporationId: string,
		workflowInstanceId: string,
		fileName: string
	): Promise<void> => {
		const response = await fetch(
			`/api/fleets/tracking/stats/corporations/${encodeURIComponent(corporationId)}/export/${encodeURIComponent(workflowInstanceId)}/download`,
			{ credentials: 'include' }
		)
		if (!response.ok) throw new Error('Failed to download fleet participation export')
		const blob = await response.blob()
		const url = URL.createObjectURL(blob)
		const link = document.createElement('a')
		link.href = url
		link.download = fileName
		link.click()
		URL.revokeObjectURL(url)
	},

	searchStatsEntities: (query: string): Promise<StatsSearchResponse> =>
		apiClient.get(`/fleets/tracking/stats/search${buildQuery({ q: query })}`),
}
