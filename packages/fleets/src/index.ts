/**
 * @repo/fleets
 *
 * Shared types and interfaces for the Fleets Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */
import type { DurableObject } from 'cloudflare:workers'
import type { EveCharacterId } from '@repo/eve-types'
import type { EsiGetCharacterFleetInformation, EsiGetFleetInformation } from './esi'
import type { FleetDetailsResponse } from './fleet-monitor'

/**
 * Quick join invitation data structure
 */
export interface QuickJoinInvitation {
	id: string
	token: string
	fleetBossId: string
	fleetId: string
	expiresAt: Date
	maxUses?: number
	usesCount: number
	isActive: boolean
}

/**
 * Quick join creation result
 */
export interface QuickJoinCreationResult {
	token: string
	url: string
	expiresAt: Date
}

/**
 * Quick join validation result
 */
export interface QuickJoinValidationResult {
	valid: boolean
	invitation?: QuickJoinInvitation
	fleetInfo?: EsiGetFleetInformation
	fleetBossName?: string
	error?: string
}

/**
 * Character info for fleet join selection
 */
export interface CharacterForFleetJoin {
	characterId: string
	characterName: string
	hasValidToken: boolean
	corporationId?: string
	corporationName?: string
}

/**
 * Fleet join result
 */
export interface FleetJoinResult {
	success: boolean
	error?: string
	invitationSent?: boolean
}

export interface KickTrackingSessionMemberResult {
	characterId: string
	success: boolean
	error?: string
}

/**
 * Public RPC interface for Fleets Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Fleets } from '@repo/fleets'
 * import { getStub } from '@repo/do-utils'
 *
 * const stub = getStub<Fleets>(env.FLEETS, 'my-id')
 * const result = await stub.exampleMethod('hello')
 * ```
 */
/**
 * Fleet information with IDs converted to strings for consistency with the rest of the application
 */
export type FleetInformation = Omit<
	EsiGetCharacterFleetInformation,
	'fleet_id' | 'fleet_boss_id'
> & {
	fleet_id: string
	fleet_boss_id: string
	lastUpdated: string
}

export interface Fleets extends DurableObject {
	/**
	 * Get character's fleet information from ESI
	 * Returns with IDs as strings for consistency
	 */
	getCharacterFleetInformation(characterId: EveCharacterId): Promise<FleetInformation>

	/**
	 * Create a new quick join invitation for a fleet
	 * @param fleetBossId - Character ID of the fleet boss
	 * @param fleetId - ESI fleet ID
	 * @param expiresInHours - How many hours until expiry (default 24)
	 * @param maxUses - Optional maximum number of uses
	 */
	createQuickJoinInvitation(
		fleetBossId: string,
		fleetId: string,
		expiresInHours?: number,
		maxUses?: number
	): Promise<QuickJoinCreationResult>

	/**
	 * Validate a quick join token
	 * @param token - The quick join token to validate
	 */
	validateQuickJoinToken(token: string): Promise<QuickJoinValidationResult>

	/**
	 * Get detailed fleet information
	 * @param fleetId - ESI fleet ID
	 * @param characterId - Character ID to use for ESI access
	 */
	getFleetDetails(fleetId: string, characterId: string): Promise<FleetDetailsResponse>

	/**
	 * Join a fleet via quick join token
	 * @param token - Quick join token
	 * @param characterId - Character ID of the user initiating the join
	 * @param joiningCharacterId - Character ID to join the fleet
	 */
	joinFleetViaQuickJoin(
		token: string,
		characterId: string,
		joiningCharacterId: string
	): Promise<FleetJoinResult>

	/**
	 * Check if a fleet is still active
	 * @param fleetId - ESI fleet ID
	 * @param characterId - Character ID to use for ESI access
	 */
	isFleetActive(fleetId: string, characterId: string): Promise<boolean>

	/**
	 * Revoke a quick join invitation
	 * @param token - Token to revoke
	 * @param characterId - Character ID of the fleet boss
	 */
	revokeQuickJoinInvitation(token: string, characterId: string): Promise<boolean>

	/**
	 * Get fleet cache status from database
	 * @param fleetId - ESI fleet ID
	 * @returns Cache snapshot with notFound markers, or null if not in cache
	 */
	getFleetCacheStatus(
		fleetId: string
	): Promise<{ notFound: boolean; notFoundAt: Date | null; lastChecked: Date } | null>

	/**
	 * Get fleet registration status (is_registered) with cache-first approach
	 * Checks cache first with 5-minute validity, then fetches from ESI if needed
	 * @param fleetId - ESI fleet ID
	 * @param characterId - Character ID to use for ESI access
	 * @returns true if fleet is registered in fleet finder, false otherwise
	 */
	getFleetIsRegistered(fleetId: string, characterId: string): Promise<boolean>

	// ===== Manual fleet tracking =====

	/**
	 * Start a new fleet tracking session.
	 * Validates that the character is currently the fleet boss before creating
	 * the session row and spinning up a FleetMonitor instance.
	 */
	startTrackingSession(args: {
		characterId: string
		startedByUserId: string
		name: string
		action?: 'new' | 'take_over'
	}): Promise<StartTrackingSessionResult>

	/**
	 * Stop an active tracking session and archive its summary.
	 */
	stopTrackingSession(args: {
		sessionId: string
		endedReason: 'user_stopped' | 'admin_stopped'
		endedByUserId: string
	}): Promise<void>

	/**
	 * List tracking sessions, filterable.
	 */
	listTrackingSessions(filter: TrackingSessionListFilter): Promise<TrackingSessionListResult>

	/**
	 * Get a single tracking session by id (summary metadata only).
	 */
	getTrackingSession(sessionId: string): Promise<TrackingSession | null>

	/**
	 * Get the active tracking session for a fleet, if one exists.
	 */
	getActiveTrackingSessionByFleetId(fleetId: string): Promise<TrackingSession | null>

	/**
	 * Get the most recent tracking session for a fleet, regardless of status.
	 */
	getLatestTrackingSessionByFleetId(fleetId: string): Promise<TrackingSession | null>

	/**
	 * Get the live cache snapshot for a session's fleet.
	 * Returns a status envelope so callers can distinguish a ready snapshot
	 * from an inactive session or a monitor read failure.
	 */
	getSessionLiveSnapshot(sessionId: string): Promise<SessionLiveSnapshotResult>

	/**
	 * Get the join/leave event log for a session, paginated.
	 */
	getSessionTimeline(args: {
		sessionId: string
		eventType?: 'join' | 'leave'
		characterId?: string
		limit?: number
		offset?: number
	}): Promise<SessionTimelineResult>

	/**
	 * Get the ship-change timeline for one character within a session.
	 */
	getSessionMemberShipHistory(args: {
		sessionId: string
		characterId: string
	}): Promise<SessionMemberShipHistoryRow[]>

	/**
	 * Get commander handoff events for a session.
	 */
	getSessionCommanderHistory(sessionId: string): Promise<SessionCommanderEvent[]>

	/**
	 * Get the session summary (one row from fleet_summaries), if it has been
	 * written yet (only present after the session has ended).
	 */
	getSessionSummary(sessionId: string): Promise<SessionSummary | null>
	/** Return the minimal fleet/session projection needed by the SRP Discord command. */
	getSrpFleetSessionDetails(sessionId: string): Promise<SrpFleetSessionDetails | null>
	/** Check whether a character was in the tracked session at a specific time. */
	wasSessionMemberAt(sessionId: string, characterId: string, occurredAt: string): Promise<boolean>

	/**
	 * Get the current member roster for an active session, derived from open
	 * (endedAt IS NULL) ship-event rows. One row per character currently in the fleet.
	 */
	getSessionCurrentMembers(sessionId: string): Promise<SessionCurrentMemberRow[]>

	/**
	 * Get the live location overlay for a session's current members.
	 */
	getSessionLiveMemberLocations(sessionId: string): Promise<SessionLiveMemberLocation[]>

	/**
	 * Get the full roster for any session (active or ended). One row per
	 * character that ever appeared, with aggregate timing + final-ship info.
	 */
	getSessionRoster(sessionId: string): Promise<SessionRosterRow[]>

	/**
	 * Remove one fleet member from the active tracked fleet via ESI.
	 */
	kickTrackingSessionMember(args: {
		sessionId: string
		memberCharacterId: string
	}): Promise<KickTrackingSessionMemberResult>

	/**
	 * Remove multiple fleet members from the active tracked fleet via ESI.
	 * Best-effort, per-member results are returned.
	 */
	kickTrackingSessionMembers(args: {
		sessionId: string
		memberCharacterIds: string[]
	}): Promise<KickTrackingSessionMemberResult[]>

	// ===== Stats / analytics primitives =====
	//
	// These return character-id-keyed aggregates. The route handler resolves
	// characterId → userId / corporationId from its own user_characters table.

	/** Org-wide overview metrics within a time window. */
	getStatsOverview(range: StatsRange): Promise<StatsOverviewResult>

	/** Aggregate metrics for one character within a time window. */
	getStatsForCharacter(characterId: string, range: StatsRange): Promise<CharacterStatsResult>

	/** Paginated fleet sessions for one character within a time window. */
	getCharacterFleetSessionsPage(args: {
		characterId: string
		range: StatsRange
		limit?: number
		offset?: number
	}): Promise<CharacterFleetSessionsPage>

	/** Paginated fleet sessions for multiple characters within a time window. */
	getUserFleetSessionsPage(args: {
		characterIds: string[]
		range: StatsRange
		limit?: number
		offset?: number
	}): Promise<UserFleetSessionsPage>

	/**
	 * Aggregate metrics for a set of character IDs (used for user-level and
	 * corp-level rollups).
	 * Returns one entry per character that has any activity in the window.
	 */
	getStatsForCharacters(
		characterIds: string[],
		range: StatsRange
	): Promise<Record<string, CharacterStatsResult>>

	/**
	 * Get distinct corporations with pilot counts derived from
	 * fleet_member_history (historical corp at time of event).
	 */
	getCorpRollupForOverview(range: StatsRange): Promise<CorpRollupRow[]>

	/**
	 * Get the distinct character IDs that participated in any fleet as members
	 * of the given corporation within the window. Powers the corp stats page.
	 */
	getCharactersByCorpInWindow(corporationId: string, range: StatsRange): Promise<string[]>

	/** Return calendar months with historical participation for a corporation. */
	getCorporationFleetParticipationMonths(
		corporationId: string
	): Promise<FleetParticipationExportMonth[]>

	/** Return one bounded, keyset-paginated participation export page. */
	getCorporationFleetParticipationPage(
		args: FleetParticipationExportPageRequest
	): Promise<FleetParticipationExportPage>

	/**
	 * Search characters that have appeared in any tracked fleet by (substring) name.
	 * Used to power the stats-page autocomplete.
	 */
	searchTrackedCharacters(
		query: string,
		limit?: number
	): Promise<Array<{ characterId: string; characterName: string }>>

	/**
	 * List all distinct corporation IDs ever seen in a tracked fleet. Names are
	 * resolved by the caller via the ESI resolver.
	 */
	listTrackedCorporationIds(): Promise<string[]>

	/**
	 * Search distinct tracked corporation IDs by optional name query.
	 * Name resolution/filtering is still performed by the caller; this method
	 * bounds the candidate ID set server-side for scalability.
	 */
	searchTrackedCorporationIds(query: string, limit?: number): Promise<string[]>

	/**
	 * Return the subset of provided corporation IDs that appear in tracked fleet
	 * history. Used by core to intersect corp-name search results with tracked data.
	 */
	filterTrackedCorporationIds(corporationIds: string[]): Promise<string[]>
}

export interface CorpRollupRow {
	corporationId: string
	pilotCount: number
}

/**
 * EVE ship type IDs that represent capsules or shuttles rather than fleet
 * ships. These are the published types in the SDE's Capsule (29) and Shuttle
 * (31) groups; they remain part of participation time but are excluded from
 * ships-flown statistics.
 */
export const FLEET_NON_SHIP_TYPE_IDS = [
	670, 672, 11129, 11132, 11134, 21097, 21628, 27299, 27301, 27303, 27305, 29266, 29328, 29330,
	29332, 29334, 30842, 33328, 33513, 34496, 64034,
] as const

// ===== Stats types =====

export interface StatsRange {
	from: string // ISO timestamp inclusive
	to: string // ISO timestamp exclusive
}

export interface TopShipRow {
	shipTypeId: number
	/** Total clamped time across the window, in minutes. */
	totalMinutes: number
}

export interface TopCharacterRow {
	characterId: string
	count: number
	/** Total active minutes attributed to this fleet boss. */
	minutesAsFC?: number
}

export interface TopCharacterHoursRow {
	characterId: string
	minutesInFleet: number
}

export interface SessionsPerDayPoint {
	day: string // YYYY-MM-DD
	count: number
}

export interface StatsOverviewResult {
	totals: {
		sessions: number
		totalMinutes: number
		uniquePilots: number
		totalJoins: number
		avgDurationMinutes: number | null
		avgPeakMembers: number | null
		largestFleetPeak: number | null
	}
	topFCs: TopCharacterRow[]
	topPilots: TopCharacterHoursRow[]
	topShips: TopShipRow[]
	sessionsPerDay: SessionsPerDayPoint[]
}

export interface CharacterShipBreakdownRow {
	shipTypeId: number
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

export interface CharacterFleetSessionsPage {
	items: CharacterRecentSessionRow[]
	total: number
}

export interface UserFleetSessionRow extends CharacterRecentSessionRow {
	characterId: string
}

export interface UserFleetSessionsPage {
	items: UserFleetSessionRow[]
	total: number
}

export interface CharacterStatsResult {
	totals: {
		fleetsJoined: number
		minutesInFleet: number
		timesFC: number
		/** Total active minutes this character was the fleet boss. */
		minutesAsFC: number
		avgFleetDurationMinutes: number | null
	}
	shipsFlown: CharacterShipBreakdownRow[]
	recentSessions: CharacterRecentSessionRow[]
}

export interface FleetParticipationExportMonth {
	month: string
	from: string
	to: string
}

export interface FleetParticipationExportPageRequest {
	corporationId: string
	from: string
	to: string
	/** Opaque cursor returned by the previous page. */
	cursor?: string | null
	limit?: number
}

export interface FleetParticipationExportRow {
	dateStamp: string
	fleetCharacterId: string
	fleetCharacterName: string | null
	fleetSessionId: string
	fleetName: string
	role: string
	shipCount: number
	durationSeconds: number
}

export interface FleetParticipationExportPage {
	items: FleetParticipationExportRow[]
	nextCursor: string | null
}

// ===== Read-side response types =====

export interface SessionLiveSnapshot {
	fleetId: string
	memberCount: number
	/** Peak member count observed across the session so far. */
	peakMemberCount: number
	motd: string | null
	isFreeMove: boolean
	isRegistered: boolean
	isVoiceEnabled: boolean
	lastChecked: string
	updatedAt: string
}

export type SessionLiveSnapshotState = 'ready' | 'inactive' | 'unavailable'

export interface SessionLiveSnapshotResult {
	state: SessionLiveSnapshotState
	message: string | null
	snapshot: SessionLiveSnapshot | null
}

export interface SessionTimelineRow {
	id: string
	characterId: string
	/**
	 * 'join' | 'leave' from fleet_member_history.
	 * 'ship_change' synthesized from fleet_member_ship_events with previousShipTypeId set.
	 * 'fleet_boss_initial' / 'fleet_boss_change' come from fleet_commander_events.
	 * 'tracking_started' / 'tracking_resumed' / 'tracking_ended' come from
	 * fleet_tracking_session_events and are merged into the same timeline stream.
	 */
	eventType:
		| 'join'
		| 'leave'
		| 'ship_change'
		| 'fleet_boss_initial'
		| 'fleet_boss_change'
		| 'tracking_started'
		| 'tracking_resumed'
		| 'tracking_ended'
	shipTypeId: number
	shipTypeName: string | null
	/** Only set for ship_change events — the ship the pilot was in before. */
	previousShipTypeId?: number | null
	previousShipTypeName?: string | null
	solarSystemId: number
	systemName: string | null
	stationId: number | null
	role: string
	roleName: string
	characterName: string | null
	previousFleetBossCharacterId?: string | null
	previousFleetBossCharacterName?: string | null
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
	solarSystemId: number
	stationId: number | null
	startedAt: string
	endedAt: string | null
}

export interface SessionCurrentMemberRow {
	characterId: string
	shipTypeId: number
	solarSystemId: number
	stationId: number | null
	/** When the pilot boarded their current ship. */
	sinceTime: string
}

export interface SessionLiveMemberLocation {
	characterId: string
	solarSystemId: number
	systemName: string | null
	stationId: number | null
	stationName: string | null
	updatedAt: string
}

export interface SessionRosterRow {
	characterId: string
	/** When this character first joined the fleet during the session. */
	firstSeenAt: string
	/** When this character left the fleet, or null if they were still in at session end. */
	leftAt: string | null
	/** Total time spent in the fleet during the session, in seconds. */
	totalSeconds: number
	/** Number of distinct ships the pilot flew. */
	shipsFlown: number
	/** The shipTypeId the pilot was in last (their final ship). */
	lastShipTypeId: number
	/** True if the pilot was still in the fleet when the session ended. */
	stayedToEnd: boolean
}

export interface SessionSummary {
	startedAt: string
	endedAt: string
	durationMinutes: number | null
	peakMemberCount: number
	finalMemberCount: number
	motd: string | null
}

export interface SrpFleetSessionDetails {
	sessionId: string
	sessionName: string
	fleetId: string | null
	status: TrackingSessionStatus
	startedAt: string
	endedAt: string | null
	commanderCharacterIds: string[]
	commanderCharacterNames: Record<string, string>
	motd: string | null
}

export interface SessionCommanderEvent {
	id: string
	fleetId: string
	trackingSessionId: string | null
	previousCommanderCharacterId: string | null
	commanderCharacterId: string
	eventType: 'initial' | 'change'
	observedAt: string
}

// ===== Tracking-session types =====

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
	/** Live fleet boss character ID, when available from the fleet cache. */
	currentFleetBossCharacterId?: string | null
	/** Resolved name for the live fleet boss, when available. */
	currentFleetBossCharacterName?: string | null
	/** Fleet boss character IDs associated with this fleet for access purposes. */
	fleetBossCharacterIds?: string[]
	/**
	 * Legacy aliases retained for older callers; prefer the fleetBoss* fields
	 * above in new code.
	 */
	currentCommanderCharacterId?: string | null
	currentCommanderCharacterName?: string | null
	commanderCharacterIds?: string[]
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

export interface StartTrackingSessionResult {
	sessionId: string
}

export interface TrackingSessionListFilter {
	characterId?: string
	startedByUserId?: string
	/** Preferred boss-based access filter. */
	fleetBossCharacterIds?: string[]
	/** Legacy alias retained for compatibility. */
	commanderCharacterIds?: string[]
	status?: TrackingSessionStatus
	/** ISO timestamp inclusive; filters by sessions.startedAt >= from. */
	from?: string
	/** ISO timestamp exclusive; filters by sessions.startedAt < to. */
	to?: string
	limit?: number
	offset?: number
}

export interface TrackingSessionListResult {
	items: TrackingSession[]
	total: number
	limit: number
	offset: number
}

/**
 * Errors thrown by startTrackingSession so callers can map them to HTTP codes.
 * The DO throws these; the route handler maps them to status codes.
 */
export type StartTrackingSessionErrorCode =
	| 'not_in_fleet'
	| 'not_fleet_boss'
	| 'character_session_active'
	| 'fleet_session_active'
	| 'esi_unavailable'

export class StartTrackingSessionError extends Error {
	constructor(
		public code: StartTrackingSessionErrorCode,
		message?: string
	) {
		super(message ?? code)
		this.name = 'StartTrackingSessionError'
	}
}

export * from './esi'
export * from './fleet-monitor'
