export type TrackingSessionStatus = 'active' | 'ended'

export type TrackingSessionEndedReason =
	| 'user_stopped'
	| 'admin_stopped'
	| 'fleet_disbanded'
	| 'character_left_fleet'
	| 'not_fleet_boss'
	| 'esi_error'
	| 'token_expired'

export interface TrackingSession {
	id: string
	name: string
	characterId: string
	/** Resolved FC name, when available. */
	characterName?: string | null
	startedByUserId: string
	fleetId: string | null
	status: TrackingSessionStatus
	startedAt: string
	endedAt: string | null
	endedReason: TrackingSessionEndedReason | null
	endedByUserId: string | null
	createdAt: string
	updatedAt: string
}

export interface SessionBroadcastLink {
	id: string
	title: string
	status: string
	sentAt: string | null
	doctrineId: string | null
	doctrine: string | null
	srpMode?: 'blanket' | 'military' | 'coalition' | 'disabled' | null
	srpToken?: string | null
}

export interface TrackingSessionListResult {
	items: TrackingSession[]
	total: number
	limit: number
	offset: number
}

export interface SessionLiveSnapshot {
	fleetId: string
	memberCount: number
	peakMemberCount: number
	motd: string | null
	isFreeMove: boolean
	isRegistered: boolean
	isVoiceEnabled: boolean
	lastChecked: string
	updatedAt: string
}

export interface SessionTimelineRow {
	id: string
	characterId: string
	eventType: 'join' | 'leave' | 'ship_change'
	shipTypeId: number
	shipTypeName: string | null
	previousShipTypeId?: number | null
	previousShipTypeName?: string | null
	solarSystemId: number
	systemName: string | null
	stationId: number | null
	role: string
	roleName: string
	characterName: string | null
	eventTimestamp: string
}

export interface SessionTimelineResult {
	items: SessionTimelineRow[]
	total: number
	limit: number
	offset: number
}

export interface SessionMemberShipHistoryRow {
	shipTypeId: number
	shipTypeName?: string | null
	solarSystemId: number
	systemName?: string | null
	stationId: number | null
	stationName?: string | null
	startedAt: string
	endedAt: string | null
}

export interface SessionMemberShipHistoryResponse {
	characterId: string
	characterName: string | null
	items: SessionMemberShipHistoryRow[]
}

export interface SessionCurrentMember {
	characterId: string
	characterName: string | null
	shipTypeId: number
	shipTypeName: string | null
	solarSystemId: number
	systemName: string | null
	stationId: number | null
	groupId: string | null
	groupName: string | null
	sinceTime: string
}

export interface SessionGroupCount {
	groupId: string
	groupName: string | null
	count: number
}

export interface SessionCurrentMembersResponse {
	members: SessionCurrentMember[]
	groupCounts: SessionGroupCount[]
}

export interface KickTrackingMembersResponse {
	results: Array<{
		characterId: string
		success: boolean
		error?: string
	}>
	summary: {
		total: number
		success: number
		failed: number
	}
}

export interface SessionRosterRow {
	characterId: string
	characterName: string | null
	firstSeenAt: string
	leftAt: string | null
	totalSeconds: number
	shipsFlown: number
	lastShipTypeId: number
	lastShipTypeName: string | null
	stayedToEnd: boolean
}

export interface SessionRosterResponse {
	items: SessionRosterRow[]
}

export interface SessionSummary {
	startedAt: string
	endedAt: string
	durationMinutes: number | null
	peakMemberCount: number
	finalMemberCount: number
	motd: string | null
}

export interface StartSessionRequest {
	characterId: string
	name: string
}

export interface ListSessionsFilter {
	status?: TrackingSessionStatus
	characterId?: string
	userId?: string
	from?: string
	to?: string
	limit?: number
	offset?: number
}

// ===== Stats =====

export interface StatsRange {
	from: string
	to: string
}

export interface TopCharacterWithMeta {
	characterId: string
	count: number
	characterName: string | null
	corporationId: string | null
	corporationName: string | null
}

export interface TopPilotWithMeta {
	characterId: string
	minutesInFleet: number
	characterName: string | null
	corporationId: string | null
	corporationName: string | null
}

export interface TopCorporationRow {
	corporationId: string
	corporationName: string | null
	pilots: number
}

export interface TopShipRow {
	shipTypeId: number
	shipTypeName?: string | null
	totalMinutes: number
}

export interface SessionsPerDayPoint {
	day: string
	count: number
}

export interface StatsOverviewResponse {
	range: StatsRange
	totals: {
		sessions: number
		totalMinutes: number
		uniquePilots: number
		totalJoins: number
		avgDurationMinutes: number | null
		avgPeakMembers: number | null
		largestFleetPeak: number | null
	}
	topFCs: TopCharacterWithMeta[]
	topPilots: TopPilotWithMeta[]
	topCorps: TopCorporationRow[]
	topShips: TopShipRow[]
	sessionsPerDay: SessionsPerDayPoint[]
}

export interface CharacterShipBreakdownRow {
	shipTypeId: number
	shipTypeName?: string | null
	totalMinutes: number
}

export interface CharacterRecentSessionRow {
	sessionId: string
	sessionName: string
	fleetId: string | null
	wasFC: boolean
	startedAt: string
	endedAt: string | null
	totalMinutes: number
	shipsFlown: number
}

export interface CharacterStatsResponse {
	range: StatsRange
	characterId: string
	characterName: string | null
	corporationId: string | null
	corporationName: string | null
	totals: {
		fleetsJoined: number
		minutesInFleet: number
		timesFC: number
		avgFleetDurationMinutes: number | null
	}
	shipsFlown: CharacterShipBreakdownRow[]
	recentSessions: CharacterRecentSessionRow[]
}

export interface UserPerCharacterStats {
	characterId: string
	characterName: string
	is_primary: boolean
	corporationId: string | null
	corporationName: string | null
	stats: {
		totals: CharacterStatsResponse['totals']
		shipsFlown: CharacterShipBreakdownRow[]
		recentSessions: CharacterRecentSessionRow[]
	}
}

export interface UserStatsResponse {
	range: StatsRange
	userId: string
	totals: CharacterStatsResponse['totals']
	perCharacter: UserPerCharacterStats[]
	shipsFlown: CharacterShipBreakdownRow[]
	recentSessions: Array<CharacterRecentSessionRow & { characterId: string }>
}

export interface StatsSearchResponse {
	characters: Array<{
		characterId: string
		characterName: string
		isPrimary: boolean
		ownerMainCharacterName: string | null
	}>
	corporations: Array<{ corporationId: string; corporationName: string | null }>
}

export interface CorporationStatsResponse {
	range: StatsRange
	corporationId: string
	corporationName?: string | null
	totals: {
		pilotsActive: number
		pilotHours: number
		sessionsWithPresence: number
		avgPilotsPerSession: number
	}
	topMembers: Array<{
		characterId: string
		characterName: string
		fleetsJoined: number
		minutesInFleet: number
	}>
	topFCs: Array<{ characterId: string; characterName: string; sessions: number }>
	shipsFlown: CharacterShipBreakdownRow[]
}
