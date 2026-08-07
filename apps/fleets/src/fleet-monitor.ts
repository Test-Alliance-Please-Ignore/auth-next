import { DurableObject } from 'cloudflare:workers'

import { and, createDbClientWs, desc, eq, isNull, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import {
	esiGetCharacterFleetInformationSchema,
	esiGetFleetInformationSchema,
	esiGetFleetMembersSchema,
} from '@repo/fleets'
import { logger } from '@repo/hono-helpers'

import {
	fleetCommanderAccessAnchors,
	fleetCommanderEvents,
	fleetMemberHistory,
	fleetMemberShipEvents,
	fleetSummaries,
	fleetTrackingSessionEvents,
	fleetTrackingSessions,
	schema,
} from './db/schema'
import { computeNextPollDelayMs } from './polling'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type {
	EsiGetCharacterFleetInformation,
	EsiGetFleetInformation,
	EsiGetFleetMembers,
	FleetDetailsResponse,
	FleetMonitorState,
	FleetMonitorStateRow,
} from '@repo/fleets'
import type { InvType, Universe } from '@repo/universe'
import type { Env } from './context'

const LIVE_FLEET_ESI_OPTIONS = { cacheMode: 'no-store' } as const

/**
 * Normalize station_id to ensure it's either a number or null
 * Handles edge cases where the value might be undefined, empty string, or 0
 */
function normalizeStationId(value: number | null | undefined | string): number | null {
	// Handle null/undefined
	if (value === null || value === undefined) {
		return null
	}
	// Handle empty string (shouldn't happen after Zod parsing, but be safe)
	if (value === '' || (typeof value === 'string' && value.trim() === '')) {
		return null
	}
	// 0 is not a valid station ID in EVE, treat as null
	if (value === 0) {
		return null
	}
	// Convert string numbers to numbers
	if (typeof value === 'string') {
		const num = Number(value)
		return isNaN(num) || num === 0 ? null : num
	}
	// Return number if valid
	return typeof value === 'number' ? value : null
}

async function resolveFleetBossAccessCharacterId(
	tokenStore: EveTokenStore,
	currentCharacterId: string,
	fleetBossCharacterId: string
): Promise<{ accessCharacterId: string; switchedToFleetBoss: boolean }> {
	if (!fleetBossCharacterId || fleetBossCharacterId === currentCharacterId) {
		return { accessCharacterId: currentCharacterId, switchedToFleetBoss: false }
	}

	const accessToken = await tokenStore.getAccessToken(fleetBossCharacterId)
	if (accessToken === null) {
		return { accessCharacterId: currentCharacterId, switchedToFleetBoss: false }
	}

	return { accessCharacterId: fleetBossCharacterId, switchedToFleetBoss: true }
}

async function syncFleetBossAccess(
	db: ReturnType<typeof createDbClientWs<typeof schema>>,
	args: {
		fleetId: string
		trackingSessionId: string
		previousFleetBossCharacterId: string | null
		currentFleetBossCharacterId: string
		observedAt: Date
	}
): Promise<void> {
	const {
		fleetId,
		trackingSessionId,
		previousFleetBossCharacterId,
		currentFleetBossCharacterId,
		observedAt,
	} = args

	const [lastRecordedEvent] = await db
		.select({
			commanderCharacterId: fleetCommanderEvents.commanderCharacterId,
		})
		.from(fleetCommanderEvents)
		.where(eq(fleetCommanderEvents.trackingSessionId, trackingSessionId))
		.orderBy(desc(fleetCommanderEvents.observedAt))
		.limit(1)

	const lastRecordedCommanderId = lastRecordedEvent?.commanderCharacterId ?? null
	const previousCommanderCharacterId =
		lastRecordedCommanderId ?? previousFleetBossCharacterId ?? null
	const eventType = previousCommanderCharacterId ? 'change' : 'initial'
	if (lastRecordedCommanderId !== currentFleetBossCharacterId) {
		await db.insert(fleetCommanderEvents).values({
			fleetId,
			trackingSessionId,
			previousCommanderCharacterId,
			commanderCharacterId: currentFleetBossCharacterId,
			eventType,
			observedAt,
			createdAt: observedAt,
		})
	}

	await db
		.insert(fleetCommanderAccessAnchors)
		.values({
			fleetId,
			trackingSessionId,
			commanderCharacterId: currentFleetBossCharacterId,
			firstSeenAt: observedAt,
			lastSeenAt: observedAt,
			createdAt: observedAt,
			updatedAt: observedAt,
		})
		.onConflictDoNothing()

	await db
		.update(fleetCommanderAccessAnchors)
		.set({
			trackingSessionId,
			lastSeenAt: observedAt,
			updatedAt: observedAt,
		})
		.where(
			and(
				eq(fleetCommanderAccessAnchors.fleetId, fleetId),
				eq(fleetCommanderAccessAnchors.commanderCharacterId, currentFleetBossCharacterId)
			)
		)
}

/**
 * FleetMonitor Durable Object
 *
 * This Durable Object is created per-fleet (id: `fleet-${fleetId}`) and implements:
 * - RPC methods for fleet status queries
 * - Alarm handler for periodic fleet status updates (10s baseline cadence, header-aware)
 * - WebSocket hibernation API for real-time updates
 * - SQLite-backed state for instance-specific data (fleetId, characterId)
 * - Persistent SQLite-backed live state and historical fleet/session tables
 */
export class FleetMonitorDO extends DurableObject {
	private static readonly BASE_POLL_INTERVAL_MS = 10 * 1000
	private static readonly MONITOR_STATE_TTL_MS = 24 * 60 * 60 * 1000
	private db: ReturnType<typeof createDbClientWs<typeof schema>>
	private finalizeSessionPromise: Promise<void> | null = null
	// In-memory caches for ID to name mappings
	private characterNameCache = new Map<string, string>()
	private shipTypeNameCache = new Map<string, string>()
	private systemNameCache = new Map<string, string>()
	private stationNameCache = new Map<string, string>()
	private characterCorpCache = new Map<string, string>()

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDbClientWs(this.env.DATABASE_URL, schema)

		// Initialize SQLite schema and run migrations
		this.initializeSchema()
	}

	/**
	 * Initialize SQLite schema and run migrations
	 */
	private initializeSchema(): void {
		// Create schema version table to track migrations
		this.state.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS schema_version (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				version INTEGER NOT NULL DEFAULT 0
			)
		`)

		// Get current schema version
		const versionResult = this.state.storage.sql
			.exec<{ version: number }>(`SELECT version FROM schema_version WHERE id = 1`)
			.toArray()

		const currentVersion = versionResult.length > 0 ? versionResult[0].version : 0
		const targetVersion = 6 // Current schema version

		// Run migrations if needed
		if (currentVersion < targetVersion) {
			this.runMigrations(currentVersion, targetVersion)
		}
	}

	/**
	 * Run schema migrations from current version to target version
	 */
	private runMigrations(currentVersion: number, targetVersion: number): void {
		logger.info('[FleetMonitor] Running schema migrations', {
			currentVersion,
			targetVersion,
		})

		// Migration 0 -> 1: Create monitor_state table with last_checked column
		if (currentVersion < 1) {
			this.state.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS monitor_state (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					fleet_id TEXT NOT NULL,
					character_id TEXT NOT NULL,
					is_initialized INTEGER DEFAULT 0,
					last_checked TEXT,
					expires_at TEXT
				)
			`)

			// Create previous_members table to store snapshot for comparison
			this.state.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS previous_members (
					character_id TEXT PRIMARY KEY,
					ship_type_id INTEGER NOT NULL,
					solar_system_id INTEGER NOT NULL,
					station_id INTEGER,
					role TEXT NOT NULL,
					role_name TEXT NOT NULL,
					squad_id INTEGER NOT NULL,
					wing_id INTEGER NOT NULL,
					join_time TEXT NOT NULL,
					last_seen TEXT NOT NULL
				)
			`)

			// Create error_tracking table (also needed for version 0 instances)
			this.state.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS error_tracking (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					error_type TEXT NOT NULL,
					error_message TEXT NOT NULL,
					timestamp TEXT NOT NULL
				)
			`)

			// If table already exists but missing last_checked column, add it
			try {
				this.state.storage.sql.exec(`
					ALTER TABLE monitor_state ADD COLUMN last_checked TEXT
				`)
			} catch {
				// Column might already exist, which is fine
				const errorMessage = error instanceof Error ? error.message : String(error)
				if (!errorMessage.includes('duplicate column')) {
					logger.warn('[FleetMonitor] Could not add last_checked column (may already exist)', {
						error: errorMessage,
					})
				}
			}

			// Update schema version
			this.state.storage.sql.exec(`
				INSERT INTO schema_version (id, version)
				VALUES (1, 1)
				ON CONFLICT(id) DO UPDATE SET version = 1
			`)

			logger.info('[FleetMonitor] Migration 0 -> 1 completed')
		}

		// Migration 1 -> 2: Add previous_members table for member history tracking
		if (currentVersion < 2) {
			// Create previous_members table if it doesn't exist
			this.state.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS previous_members (
					character_id TEXT PRIMARY KEY,
					ship_type_id INTEGER NOT NULL,
					solar_system_id INTEGER NOT NULL,
					station_id INTEGER,
					role TEXT NOT NULL,
					role_name TEXT NOT NULL,
					squad_id INTEGER NOT NULL,
					wing_id INTEGER NOT NULL,
					join_time TEXT NOT NULL,
					last_seen TEXT NOT NULL
				)
			`)

			// Create error_tracking table to track 404 errors over time
			this.state.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS error_tracking (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					error_type TEXT NOT NULL,
					error_message TEXT NOT NULL,
					timestamp TEXT NOT NULL
				)
			`)

			// Update schema version
			this.state.storage.sql.exec(`
				INSERT INTO schema_version (id, version)
				VALUES (1, 2)
				ON CONFLICT(id) DO UPDATE SET version = 2
			`)

			logger.info(
				'[FleetMonitor] Migration 1 -> 2 completed (added previous_members and error_tracking tables)'
			)
		}

		// Migration 2 -> 3: Add tracking_session_id and peak_member_count to monitor_state
		if (currentVersion < 3) {
			try {
				this.state.storage.sql.exec(`ALTER TABLE monitor_state ADD COLUMN tracking_session_id TEXT`)
			} catch {
				const message = error instanceof Error ? error.message : String(error)
				if (!message.includes('duplicate column')) {
					logger.warn('[FleetMonitor] Could not add tracking_session_id column', {
						error: message,
					})
				}
			}
			try {
				this.state.storage.sql.exec(
					`ALTER TABLE monitor_state ADD COLUMN peak_member_count INTEGER NOT NULL DEFAULT 0`
				)
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				if (!message.includes('duplicate column')) {
					logger.warn('[FleetMonitor] Could not add peak_member_count column', {
						error: message,
					})
				}
			}

			this.state.storage.sql.exec(`
				INSERT INTO schema_version (id, version)
				VALUES (1, 3)
				ON CONFLICT(id) DO UPDATE SET version = 3
			`)

			logger.info(
				'[FleetMonitor] Migration 2 -> 3 completed (added tracking_session_id and peak_member_count)'
			)
		}

		// Migration 3 -> 4: Persist the last synced boss separately so boss-change
		// detection does not depend on state rows that other helpers can rewrite.
		if (currentVersion < 4) {
			try {
				this.state.storage.sql.exec(
					`ALTER TABLE monitor_state ADD COLUMN last_synced_fleet_boss_id TEXT`
				)
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				if (!message.includes('duplicate column')) {
					logger.warn('[FleetMonitor] Could not add last_synced_fleet_boss_id column', {
						error: message,
					})
				}
			}

			this.state.storage.sql.exec(`
				INSERT INTO schema_version (id, version)
				VALUES (1, 4)
				ON CONFLICT(id) DO UPDATE SET version = 4
			`)

			logger.info('[FleetMonitor] Migration 3 -> 4 completed (added last_synced_fleet_boss_id)')
		}

		// Migration 4 -> 5: add TTL metadata so monitor_state can self-expire.
		if (currentVersion < 5) {
			try {
				this.state.storage.sql.exec(`ALTER TABLE monitor_state ADD COLUMN expires_at TEXT`)
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				if (!message.includes('duplicate column')) {
					logger.warn('[FleetMonitor] Could not add expires_at column', {
						error: message,
					})
				}
			}

			// Backfill legacy rows so they participate in the TTL cleanup flow.
			// If we have a last_checked timestamp, expire 24h after that check.
			// Otherwise expire immediately so obsolete pre-TTL rows do not linger.
			const legacyRows = this.state.storage.sql
				.exec<{
					last_checked: string | null
					expires_at: string | null
				}>(`SELECT last_checked, expires_at FROM monitor_state WHERE id = 1`)
				.toArray()
			if (legacyRows.length > 0 && legacyRows[0].expires_at === null) {
				const legacyRow = legacyRows[0]
				const backfilledExpiresAt =
					legacyRow.last_checked !== null
						? new Date(
								new Date(legacyRow.last_checked).getTime() + FleetMonitorDO.MONITOR_STATE_TTL_MS
							).toISOString()
						: new Date(Date.now() - 1000).toISOString()
				this.state.storage.sql.exec(
					`UPDATE monitor_state SET expires_at = ? WHERE id = 1`,
					backfilledExpiresAt
				)
			}

			this.state.storage.sql.exec(`
				INSERT INTO schema_version (id, version)
				VALUES (1, 5)
				ON CONFLICT(id) DO UPDATE SET version = 5
			`)

			logger.info('[FleetMonitor] Migration 4 -> 5 completed (added expires_at)')
		}

		// Migration 5 -> 6: store the live fleet snapshot directly in monitor_state
		// so the FleetMonitor DO owns the live-state cache instead of Postgres.
		if (currentVersion < 6) {
			const addColumn = (sqlStatement: string, columnName: string) => {
				try {
					this.state.storage.sql.exec(sqlStatement)
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					if (!message.includes('duplicate column')) {
						logger.warn(`[FleetMonitor] Could not add ${columnName} column`, {
							error: message,
						})
					}
				}
			}

			addColumn(
				`ALTER TABLE monitor_state ADD COLUMN member_count INTEGER NOT NULL DEFAULT 0`,
				'member_count'
			)
			addColumn(`ALTER TABLE monitor_state ADD COLUMN motd TEXT`, 'motd')
			addColumn(
				`ALTER TABLE monitor_state ADD COLUMN is_free_move INTEGER NOT NULL DEFAULT 0`,
				'is_free_move'
			)
			addColumn(
				`ALTER TABLE monitor_state ADD COLUMN is_registered INTEGER NOT NULL DEFAULT 0`,
				'is_registered'
			)
			addColumn(
				`ALTER TABLE monitor_state ADD COLUMN is_voice_enabled INTEGER NOT NULL DEFAULT 0`,
				'is_voice_enabled'
			)
			addColumn(
				`ALTER TABLE monitor_state ADD COLUMN not_found INTEGER NOT NULL DEFAULT 0`,
				'not_found'
			)
			addColumn(`ALTER TABLE monitor_state ADD COLUMN not_found_at TEXT`, 'not_found_at')

			this.state.storage.sql.exec(`
				INSERT INTO schema_version (id, version)
				VALUES (1, 6)
				ON CONFLICT(id) DO UPDATE SET version = 6
			`)

			logger.info('[FleetMonitor] Migration 5 -> 6 completed (added live snapshot fields)')
		}

		logger.info('[FleetMonitor] Schema migrations completed', {
			finalVersion: targetVersion,
		})
	}

	/**
	 * Initialize fleet monitoring for a specific fleet
	 * @param fleetId - ESI fleet ID
	 * @param characterId - Character ID of the fleet boss (for ESI access)
	 */
	async initializeMonitoring(
		fleetId: string,
		characterId: string,
		trackingSessionId: string,
		options: {
			force?: boolean
			previousFleetBossCharacterId?: string | null
			resumedExistingSession?: boolean
		} = {}
	): Promise<void> {
		const force = options.force ?? false
		// Check if already initialized for this fleet (unless forcing re-initialization)
		if (!force) {
			const existingState = await this.getState()
			if (
				existingState &&
				existingState.isInitialized &&
				existingState.fleetId === fleetId &&
				existingState.trackingSessionId === trackingSessionId
			) {
				logger.debug(`[FleetMonitor ${fleetId}] Already initialized, skipping re-initialization`, {
					fleetId,
					characterId,
					trackingSessionId,
					lastChecked: existingState.lastChecked,
				})
				return
			}
		}

		logger.info(`[FleetMonitor ${fleetId}] Initializing monitoring`, {
			fleetId,
			characterId,
			trackingSessionId,
		})

		// Clear any leftover state from a previous session for this same fleet.
		// terminate() should have done this, but older DOs may not have, and
		// stale rows here cause PRIMARY KEY violations later during snapshot seeding.
		try {
			this.state.storage.sql.exec(`DELETE FROM previous_members`)
		} catch {
			// Table may not exist yet on a brand-new DO; harmless.
		}
		try {
			this.state.storage.sql.exec(`DELETE FROM error_tracking`)
		} catch {
			// Same — fine to ignore.
		}

		// Store initialization state in SQLite (peak starts at 0 — bumped on first tick)
		const now = new Date()
		await this.persistMonitorState({
			fleetId,
			characterId,
			trackingSessionId,
			lastSyncedFleetBossId: null,
			lastChecked: now,
			peakMemberCount: 0,
		})

		// Get initial fleet status to create baseline snapshot
		try {
			const initialStatus = await this.getFleetStatus()
			if (initialStatus) {
				const currentFleetBossId = initialStatus.fleetBossId ?? characterId
				const observedAt = new Date()
				let openShipEventCount = 0
				let shipEventCount = 0
				try {
					const [totalCount] = await this.db
						.select({ count: sql<number>`count(*)::int` })
						.from(fleetMemberShipEvents)
						.where(eq(fleetMemberShipEvents.trackingSessionId, trackingSessionId))
					const [openCount] = await this.db
						.select({ count: sql<number>`count(*)::int` })
						.from(fleetMemberShipEvents)
						.where(
							and(
								eq(fleetMemberShipEvents.trackingSessionId, trackingSessionId),
								isNull(fleetMemberShipEvents.endedAt)
							)
						)
					openShipEventCount = openCount?.count ?? 0
					shipEventCount = totalCount?.count ?? 0
				} catch (error) {
					logger.warn(`[FleetMonitor ${fleetId}] Could not count open ship-event rows`, {
						fleetId,
						trackingSessionId,
						error: error instanceof Error ? error.message : String(error),
					})
				}

				await syncFleetBossAccess(this.db, {
					fleetId,
					trackingSessionId,
					previousFleetBossCharacterId:
						options.previousFleetBossCharacterId ??
						(options.resumedExistingSession ? characterId : null),
					currentFleetBossCharacterId: currentFleetBossId,
					observedAt,
				})
				await this.persistMonitorState({
					fleetId,
					characterId: currentFleetBossId,
					trackingSessionId,
					lastSyncedFleetBossId: currentFleetBossId,
					lastChecked: observedAt,
					peakMemberCount: initialStatus.memberCount,
					memberCount: initialStatus.memberCount,
					motd: initialStatus.fleetInfo.motd || null,
					isFreeMove: initialStatus.fleetInfo.is_free_move,
					isRegistered: initialStatus.fleetInfo.is_registered,
					isVoiceEnabled: initialStatus.fleetInfo.is_voice_enabled,
					notFound: false,
					notFoundAt: null,
				})

				logger.info(`[FleetMonitor ${fleetId}] Updated monitor state during initialization`, {
					fleetId,
					memberCount: initialStatus.memberCount,
				})

				const shouldSeedInitialHistorySnapshot = shipEventCount === 0
				const shouldSeedOpenShipRows = openShipEventCount === 0
				if (initialStatus.members) {
					// Create the initial historical snapshot only for brand-new sessions.
					// Resumed/taken-over sessions should restore live ship rows without
					// duplicating the join history for members who were already present.
					const now = new Date()
					const eventTimestamp = now.toISOString()

					if (initialStatus.members.length > 0 && shouldSeedInitialHistorySnapshot) {
						const BATCH_SIZE = 20 // Reduced from 50 to avoid parameter limit issues
						// Resolve corp IDs once for the whole roster.
						const initialCharIds = new Set(initialStatus.members.map((m) => String(m.character_id)))
						let initialCorps: Record<string, string | null> = {}
						try {
							initialCorps = await this.resolveCharacterCorps(initialCharIds)
						} catch (error) {
							logger.warn(`[FleetMonitor ${fleetId}] Failed to resolve initial corps`, {
								fleetId,
								error: error instanceof Error ? error.message : String(error),
							})
						}

						const memberHistoryValues = initialStatus.members.map((member) => ({
							fleetId,
							characterId: String(member.character_id),
							eventType: 'join' as const,
							shipTypeId: member.ship_type_id,
							solarSystemId: member.solar_system_id,
							stationId: normalizeStationId(member.station_id),
							role: member.role,
							roleName: member.role_name,
							squadId: String(member.squad_id), // Convert to string for text column
							wingId: String(member.wing_id), // Convert to string for text column
							joinedAt: new Date(member.join_time),
							leftAt: null,
							eventTimestamp: now,
							// Names not resolved for initial snapshot (will be null)
							characterName: null,
							systemName: null,
							shipTypeName: null,
							wingName: null,
							squadName: null,
							corporationId: initialCorps[String(member.character_id)] ?? null,
						}))

						// Insert in batches using helper
						await this.insertFleetMemberHistoryBatch(
							memberHistoryValues,
							fleetId,
							BATCH_SIZE,
							'initial'
						)

						// Backfill names in the background — initial snapshot inserts with nulls
						// to keep the start path fast; this resolves and updates them after.
						this.state.waitUntil(
							this.backfillInitialSnapshotNames(fleetId, initialStatus.members, now)
						)
					}

					if (initialStatus.members.length > 0 && shouldSeedOpenShipRows) {
						// Restore open ship-event rows so live member state continues to
						// render correctly, but only seed history rows once per session.
						try {
							const shipEventRows = initialStatus.members.map((member) => ({
								trackingSessionId,
								fleetId,
								characterId: String(member.character_id),
								shipTypeId: member.ship_type_id,
								solarSystemId: member.solar_system_id,
								stationId: normalizeStationId(member.station_id),
								startedAt: now,
								endedAt: null,
								eventTimestamp: now,
							}))
							const BATCH_SIZE = 50
							for (let i = 0; i < shipEventRows.length; i += BATCH_SIZE) {
								const batch = shipEventRows.slice(i, i + BATCH_SIZE)
								await this.db.insert(fleetMemberShipEvents).values(batch)
							}
						} catch (error) {
							const errAny = error as {
								message?: string
								code?: string
								stack?: string
								detail?: string
								constraint?: string
							}
							logger.error(`[FleetMonitor ${fleetId}] Failed to seed initial ship events`, {
								fleetId,
								trackingSessionId,
								memberCount: initialStatus.members.length,
								errorMessage: errAny?.message,
								errorCode: errAny?.code,
								errorDetail: errAny?.detail,
								errorConstraint: errAny?.constraint,
								errorStack: errAny?.stack,
							})
						}

						logger.info(
							`[FleetMonitor ${fleetId}] Restored current members with ${initialStatus.members.length} open ship-event rows`,
							{
								fleetId,
								memberCount: initialStatus.members.length,
								restoredHistory: shouldSeedInitialHistorySnapshot,
							}
						)
					} else if (initialStatus.members.length > 0) {
						logger.info(
							`[FleetMonitor ${fleetId}] Skipped duplicate ship-event seeding because open ship-event rows already exist`,
							{
								fleetId,
								trackingSessionId,
								memberCount: initialStatus.members.length,
								openShipEventCount,
							}
						)
					}

					if (initialStatus.members.length > 0) {
						// Always refresh the previous-member snapshot so the next poll
						// compares against the current live roster, even if this is a
						// takeover/rebind where ship-event rows already exist.
						for (const member of initialStatus.members) {
							const charId = String(member.character_id)
							this.state.storage.sql.exec(
								`
								INSERT INTO previous_members (
									character_id, ship_type_id, solar_system_id, station_id,
									role, role_name, squad_id, wing_id, join_time, last_seen
								)
								VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
							`,
								charId,
								member.ship_type_id,
								member.solar_system_id,
								member.station_id ?? null,
								member.role,
								member.role_name,
								member.squad_id,
								member.wing_id,
								member.join_time,
								eventTimestamp
							)
						}
					}
				}
			}
		} catch (error) {
			// Log but don't fail initialization if we can't get initial status
			logger.warn(`[FleetMonitor ${fleetId}] Could not create initial snapshot`, {
				fleetId,
				error: error instanceof Error ? error.message : String(error),
			})
		}

		// Schedule first alarm at baseline cadence.
		await this.scheduleNextAlarm()

		logger.info(`[FleetMonitor ${fleetId}] Monitoring initialized and alarm scheduled`)
	}

	/**
	 * Get current fleet status
	 * @returns Current fleet details including members and status
	 */
	async getFleetStatus(): Promise<FleetDetailsResponse | null> {
		// Load state from SQLite
		const state = await this.getState()
		if (!state || !state.isInitialized) {
			logger.warn('[FleetMonitor] Not initialized, cannot get fleet status')
			return null
		}

		const { fleetId, characterId } = state

		try {
			const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
			const currentCharacterFleetResponse =
				await tokenStore.fetchEsi<EsiGetCharacterFleetInformation>(
					`/characters/${characterId}/fleet/`,
					characterId,
					LIVE_FLEET_ESI_OPTIONS
				)
			const currentCharacterFleetInfo = esiGetCharacterFleetInformationSchema.parse(
				currentCharacterFleetResponse.data
			)
			const liveFleetBossId = String(currentCharacterFleetInfo.fleet_boss_id)
			const liveFleetId = String(currentCharacterFleetInfo.fleet_id)

			if (liveFleetId !== fleetId) {
				logger.warn(`[FleetMonitor ${fleetId}] Character fleet lookup returned a different fleet`, {
					fleetId,
					monitorFleetId: fleetId,
					reportedFleetId: liveFleetId,
					reportedBossId: liveFleetBossId,
					characterId,
				})
			}

			let accessCharacterId = characterId
			if (liveFleetBossId !== characterId) {
				const resolvedAccess = await resolveFleetBossAccessCharacterId(
					tokenStore,
					characterId,
					liveFleetBossId
				)
				if (resolvedAccess.switchedToFleetBoss) {
					accessCharacterId = resolvedAccess.accessCharacterId
					await this.state.storage.sql.exec(
						`UPDATE monitor_state SET character_id = ?, expires_at = ? WHERE id = 1`,
						accessCharacterId,
						this.getMonitorStateExpiresAtIso()
					)
					logger.info(`[FleetMonitor ${fleetId}] Rebound ESI source to live fleet boss`, {
						fleetId,
						previousCharacterId: characterId,
						liveFleetBossId,
					})
				} else {
					logger.debug(`[FleetMonitor ${fleetId}] Live fleet boss has no usable token yet`, {
						fleetId,
						liveFleetBossId,
						currentCharacterId: characterId,
					})
				}
			}

			// Fetch fleet info
			const fleetResponse = await tokenStore.fetchEsi<EsiGetFleetInformation>(
				`/fleets/${fleetId}/`,
				accessCharacterId,
				LIVE_FLEET_ESI_OPTIONS
			)
			const fleetInfo = esiGetFleetInformationSchema.parse(fleetResponse.data)
			let nextPollAt = fleetResponse.expiresAt

			// Fetch fleet members
			let members: EsiGetFleetMembers | undefined
			let memberCount = 0
			try {
				const membersResponse = await tokenStore.fetchEsi<EsiGetFleetMembers>(
					`/fleets/${fleetId}/members/`,
					accessCharacterId,
					LIVE_FLEET_ESI_OPTIONS
				)
				members = esiGetFleetMembersSchema.parse(membersResponse.data)
				memberCount = members.length
				if (membersResponse.expiresAt.getTime() > nextPollAt.getTime()) {
					nextPollAt = membersResponse.expiresAt
				}
			} catch (error) {
				logger.error(`[FleetMonitor ${fleetId}] Failed to fetch members`, {
					fleetId,
					error: error instanceof Error ? error.message : String(error),
				})
				members = undefined
			}

			// Resolve the live fleet boss name independently of the ESI source so
			// the display and access paths stay aligned even across leadership
			// handoffs.
			const characterStub = getStub<EveCharacterData>(this.env.EVE_CHARACTER_DATA, liveFleetBossId)
			const characterInfo = await characterStub.getCharacterInfo(liveFleetBossId)

			// Resolve ship type IDs, character IDs, system IDs, and station IDs to names if members are available
			let resolvedShipTypes: Record<string, string> | undefined
			let resolvedCharacterNames: Record<string, string> | undefined
			let resolvedSystemNames: Record<string, string> | undefined
			let resolvedStationNames: Record<string, string> | undefined
			if (members && members.length > 0) {
				// Collect unique IDs
				const uniqueShipTypeIds = new Set(members.map((m) => String(m.ship_type_id)))
				const uniqueCharacterIds = new Set(members.map((m) => String(m.character_id)))
				// Also include the live fleet boss and access character if they are not
				// already in the list.
				if (liveFleetBossId && !uniqueCharacterIds.has(liveFleetBossId)) {
					uniqueCharacterIds.add(liveFleetBossId)
				}
				if (accessCharacterId && !uniqueCharacterIds.has(accessCharacterId)) {
					uniqueCharacterIds.add(accessCharacterId)
				}
				const uniqueSystemIds = new Set(members.map((m) => String(m.solar_system_id)))
				const stationIds = members.map((m) => m.station_id)

				// Resolve all names in parallel using helper functions
				const [shipTypesResult, characterNamesResult, systemNamesResult, stationNamesResult] =
					await Promise.allSettled([
						uniqueShipTypeIds.size > 0 ? this.resolveShipTypeNames(uniqueShipTypeIds) : {},
						uniqueCharacterIds.size > 0 ? this.resolveCharacterNames(uniqueCharacterIds) : {},
						uniqueSystemIds.size > 0 ? this.resolveSystemNames(uniqueSystemIds) : {},
						this.resolveStationNames(stationIds),
					])

				// Extract results with error handling
				if (shipTypesResult.status === 'fulfilled') {
					resolvedShipTypes = shipTypesResult.value
				} else {
					logger.warn(`[FleetMonitor ${fleetId}] Failed to resolve ship type names`, {
						fleetId,
						error:
							shipTypesResult.reason instanceof Error
								? shipTypesResult.reason.message
								: String(shipTypesResult.reason),
					})
				}

				if (characterNamesResult.status === 'fulfilled') {
					resolvedCharacterNames = characterNamesResult.value
				} else {
					logger.warn(`[FleetMonitor ${fleetId}] Failed to resolve character names`, {
						fleetId,
						error:
							characterNamesResult.reason instanceof Error
								? characterNamesResult.reason.message
								: String(characterNamesResult.reason),
					})
				}

				if (systemNamesResult.status === 'fulfilled') {
					resolvedSystemNames = systemNamesResult.value
				} else {
					logger.warn(`[FleetMonitor ${fleetId}] Failed to resolve system names`, {
						fleetId,
						error:
							systemNamesResult.reason instanceof Error
								? systemNamesResult.reason.message
								: String(systemNamesResult.reason),
					})
				}

				if (stationNamesResult.status === 'fulfilled') {
					resolvedStationNames = stationNamesResult.value
				} else {
					logger.warn(`[FleetMonitor ${fleetId}] Failed to resolve station names`, {
						fleetId,
						error:
							stationNamesResult.reason instanceof Error
								? stationNamesResult.reason.message
								: String(stationNamesResult.reason),
					})
				}
			}

			return {
				fleetInfo,
				members,
				fleetBossId: liveFleetBossId,
				fleetBossName: characterInfo?.name,
				memberCount,
				nextPollAt: nextPollAt.toISOString(),
				// Include resolved ship type names, character names, system names, and station names as metadata
				...(resolvedShipTypes && { shipTypeNames: resolvedShipTypes }),
				...(resolvedCharacterNames && { characterNames: resolvedCharacterNames }),
				...(resolvedSystemNames && { systemNames: resolvedSystemNames }),
				...(resolvedStationNames && { stationNames: resolvedStationNames }),
			}
		} catch (error) {
			logger.error(`[FleetMonitor ${fleetId}] Failed to get fleet status`, {
				fleetId,
				error: error instanceof Error ? error.message : String(error),
			})
			throw error
		}
	}

	/**
	 * Get monitor state for diagnostics and liveness inspection.
	 * @returns Monitor state including lastChecked timestamp, or null if not initialized
	 */
	async getMonitorState(): Promise<FleetMonitorState | null> {
		return await this.getState()
	}

	private async persistMonitorState(args: {
		fleetId: string
		characterId: string
		trackingSessionId: string | null
		lastSyncedFleetBossId: string | null
		lastChecked: Date
		peakMemberCount?: number
		memberCount?: number
		motd?: string | null
		isFreeMove?: boolean
		isRegistered?: boolean
		isVoiceEnabled?: boolean
		notFound?: boolean
		notFoundAt?: Date | null
	}): Promise<void> {
		const {
			fleetId,
			characterId,
			trackingSessionId,
			lastSyncedFleetBossId,
			lastChecked,
			peakMemberCount = 0,
			memberCount = 0,
			motd = null,
			isFreeMove = false,
			isRegistered = false,
			isVoiceEnabled = false,
			notFound = false,
			notFoundAt = null,
		} = args
		await this.state.storage.sql.exec(
			`
			INSERT INTO monitor_state (
				id,
				fleet_id,
				character_id,
				tracking_session_id,
				last_synced_fleet_boss_id,
				is_initialized,
				last_checked,
				peak_member_count,
				expires_at,
				member_count,
				motd,
				is_free_move,
				is_registered,
				is_voice_enabled,
				not_found,
				not_found_at
			)
			VALUES (1, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				fleet_id = excluded.fleet_id,
				character_id = excluded.character_id,
				tracking_session_id = excluded.tracking_session_id,
				last_synced_fleet_boss_id = excluded.last_synced_fleet_boss_id,
				is_initialized = excluded.is_initialized,
				last_checked = excluded.last_checked,
				peak_member_count = excluded.peak_member_count,
				expires_at = excluded.expires_at,
				member_count = excluded.member_count,
				motd = excluded.motd,
				is_free_move = excluded.is_free_move,
				is_registered = excluded.is_registered,
				is_voice_enabled = excluded.is_voice_enabled,
				not_found = excluded.not_found,
				not_found_at = excluded.not_found_at
		`,
			fleetId,
			characterId,
			trackingSessionId,
			lastSyncedFleetBossId,
			lastChecked.toISOString(),
			peakMemberCount,
			this.getMonitorStateExpiresAt(lastChecked).toISOString(),
			memberCount,
			motd,
			isFreeMove ? 1 : 0,
			isRegistered ? 1 : 0,
			isVoiceEnabled ? 1 : 0,
			notFound ? 1 : 0,
			notFoundAt ? notFoundAt.toISOString() : null
		)
	}

	private getMonitorStateExpiresAt(base = new Date()): Date {
		return new Date(base.getTime() + FleetMonitorDO.MONITOR_STATE_TTL_MS)
	}

	private getMonitorStateExpiresAtIso(base = new Date()): string {
		return this.getMonitorStateExpiresAt(base).toISOString()
	}

	private async clearMonitorStorage(fleetId: string): Promise<void> {
		// Delete any pending alarms
		try {
			await this.state.storage.deleteAlarm()
			logger.debug(`[FleetMonitor ${fleetId}] Alarm deleted`)
		} catch (error) {
			// Ignore if no alarm exists
			logger.debug(`[FleetMonitor ${fleetId}] No alarm to delete`, {
				error: error instanceof Error ? error.message : String(error),
			})
		}

		// Delete all SQLite table data
		this.state.storage.sql.exec(`DELETE FROM monitor_state WHERE id = 1`)

		try {
			this.state.storage.sql.exec(`DELETE FROM previous_members`)
		} catch (error) {
			logger.debug(`[FleetMonitor ${fleetId}] Could not delete previous_members`, {
				error: error instanceof Error ? error.message : String(error),
			})
		}

		try {
			this.state.storage.sql.exec(`DELETE FROM error_tracking`)
		} catch (error) {
			logger.debug(`[FleetMonitor ${fleetId}] Could not delete error_tracking`, {
				error: error instanceof Error ? error.message : String(error),
			})
		}

		try {
			this.state.storage.sql.exec(`DELETE FROM schema_version WHERE id = 1`)
		} catch (error) {
			logger.debug(`[FleetMonitor ${fleetId}] Could not delete schema_version`, {
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	/**
	 * Explicitly end the tracking session.
	 *
	 * Called from FleetsDO.stopTrackingSession (user_stopped / admin_stopped)
	 * and any other future "stop without ESI saying 404" path. Closes ship-event
	 * rows, marks the session ended, archives a summary, updates the cache to
	 * reflect inactive, and terminates the DO.
	 */
	async endSession(args: {
		sessionId: string
		endedReason:
			| 'user_stopped'
			| 'admin_stopped'
			| 'fleet_disbanded'
			| 'esi_error'
			| 'token_expired'
		endedByUserId: string | null
	}): Promise<void> {
		const state = await this.getState()
		if (!state || !state.isInitialized) {
			logger.warn('[FleetMonitor endSession] No active state; nothing to do', {
				sessionId: args.sessionId,
			})
			return
		}

		const { fleetId, characterId, trackingSessionId, peakMemberCount } = state

		if (!trackingSessionId || trackingSessionId !== args.sessionId) {
			logger.warn(
				'[FleetMonitor endSession] Session id mismatch — refusing to act on the wrong session',
				{
					fleetId,
					storedSessionId: trackingSessionId,
					requestedSessionId: args.sessionId,
				}
			)
			return
		}

		const endedAt = new Date()
		const currentFleetBossId = state.lastSyncedFleetBossId ?? characterId

		await this.finalizeSession({
			fleetId,
			fleetBossId: currentFleetBossId,
			trackingSessionId,
			endedAt,
			endedReason: args.endedReason,
			endedByUserId: args.endedByUserId,
			peakMemberCount,
		})

		// Tear down the DO.
		try {
			await this.terminate()
		} catch (error) {
			logger.warn(`[FleetMonitor ${fleetId}] terminate() raised during endSession`, {
				fleetId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	/**
	 * Delete all storage and terminate the Durable Object
	 * This signals to Cloudflare that the DO can be garbage collected
	 * Deletes:
	 * - All alarms (stops scheduled updates)
	 * - All SQLite table data (monitor_state, schema_version)
	 * After this, the DO will be garbage collected when it has no state
	 */
	async terminate(): Promise<void> {
		const state = await this.getState()
		const fleetId = state?.fleetId || 'unknown'

		logger.info(`[FleetMonitor ${fleetId}] Terminating - deleting all storage`, {
			fleetId,
		})

		try {
			await this.clearMonitorStorage(fleetId)

			logger.info(`[FleetMonitor ${fleetId}] Storage deleted - DO can be garbage collected`, {
				fleetId,
			})
		} catch (error) {
			logger.error(`[FleetMonitor ${fleetId}] Error during termination`, {
				fleetId,
				error: error instanceof Error ? error.message : String(error),
			})
			throw error
		}
	}

	/**
	 * Get state from SQLite storage
	 * @returns State object or null if not initialized
	 */
	private async getState(): Promise<FleetMonitorState | null> {
		const result = this.state.storage.sql
			.exec<FleetMonitorStateRow>(
				`
				SELECT fleet_id, character_id, tracking_session_id, last_synced_fleet_boss_id, is_initialized, last_checked, peak_member_count, expires_at, member_count, motd, is_free_move, is_registered, is_voice_enabled, not_found, not_found_at
				FROM monitor_state
				WHERE id = 1
			`
			)
			.toArray()

		if (result.length === 0) {
			return null
		}

		const row = result[0]
		const expiresAtMs = row.expires_at ? new Date(row.expires_at).getTime() : null
		if (expiresAtMs !== null && Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
			logger.info('[FleetMonitor] Monitor state expired; clearing stale storage', {
				fleetId: row.fleet_id,
				expiresAt: row.expires_at,
			})
			await this.clearMonitorStorage(row.fleet_id)
			return null
		}

		return {
			fleetId: row.fleet_id,
			characterId: row.character_id,
			trackingSessionId: row.tracking_session_id,
			lastSyncedFleetBossId: row.last_synced_fleet_boss_id,
			isInitialized: row.is_initialized === 1,
			lastChecked: row.last_checked,
			peakMemberCount: row.peak_member_count ?? 0,
			expiresAt: row.expires_at,
			memberCount: row.member_count ?? 0,
			motd: row.motd,
			isFreeMove: row.is_free_move === 1,
			isRegistered: row.is_registered === 1,
			isVoiceEnabled: row.is_voice_enabled === 1,
			notFound: row.not_found === 1,
			notFoundAt: row.not_found_at,
		}
	}

	/**
	 * Finalize a tracking session: close all open ship-event rows, mark the session
	 * row ended, and archive the fleet to fleet_summaries with the real peak member count.
	 * Idempotent on the session-row update (only updates active rows).
	 */
	private async finalizeSession(args: {
		fleetId: string
		fleetBossId: string
		trackingSessionId: string
		endedAt: Date
		endedReason:
			| 'user_stopped'
			| 'admin_stopped'
			| 'fleet_disbanded'
			| 'esi_error'
			| 'token_expired'
		endedByUserId: string | null
		peakMemberCount: number
	}): Promise<void> {
		if (this.finalizeSessionPromise) {
			await this.finalizeSessionPromise
			return
		}

		const finalizePromise = (async () => {
			const {
				fleetId,
				fleetBossId,
				trackingSessionId,
				endedAt,
				endedReason,
				endedByUserId,
				peakMemberCount,
			} = args

			try {
				await this.db.insert(fleetTrackingSessionEvents).values({
					fleetId,
					trackingSessionId,
					previousCharacterId: null,
					characterId: fleetBossId,
					eventType: 'ended',
					observedAt: endedAt,
					createdAt: endedAt,
				})
			} catch (error) {
				logger.warn(`[FleetMonitor ${fleetId}] Failed to record session end event`, {
					fleetId,
					trackingSessionId,
					error: error instanceof Error ? error.message : String(error),
				})
			}

			// 1. Close all open ship-event rows for this session.
			try {
				await this.db
					.update(fleetMemberShipEvents)
					.set({ endedAt })
					.where(
						and(
							eq(fleetMemberShipEvents.trackingSessionId, trackingSessionId),
							isNull(fleetMemberShipEvents.endedAt)
						)
					)
			} catch (error) {
				logger.error(`[FleetMonitor ${fleetId}] Failed to close ship-event rows on session end`, {
					fleetId,
					trackingSessionId,
					error: error instanceof Error ? error.message : String(error),
				})
			}

			// 2. Update the session row.
			try {
				await this.db
					.update(fleetTrackingSessions)
					.set({
						status: 'ended',
						endedAt,
						endedReason,
						endedByUserId,
						updatedAt: endedAt,
					})
					.where(
						and(
							eq(fleetTrackingSessions.id, trackingSessionId),
							eq(fleetTrackingSessions.status, 'active')
						)
					)
			} catch (error) {
				logger.error(`[FleetMonitor ${fleetId}] Failed to update session row on end`, {
					fleetId,
					trackingSessionId,
					error: error instanceof Error ? error.message : String(error),
				})
			}

			// 3. Archive the fleet summary.
			await this.archiveFleetToSummary(fleetId, fleetBossId, endedAt, {
				trackingSessionId,
				peakMemberCount,
			})
		})()

		this.finalizeSessionPromise = finalizePromise
		try {
			await finalizePromise
		} finally {
			if (this.finalizeSessionPromise === finalizePromise) {
				this.finalizeSessionPromise = null
			}
		}
	}

	private async archiveFleetToSummary(
		fleetId: string,
		fleetBossId: string,
		endedAt: Date,
		options?: {
			trackingSessionId?: string
			peakMemberCount?: number
		}
	): Promise<void> {
		try {
			const state = await this.getState()
			if (!state) {
				logger.warn(`[FleetMonitor ${fleetId}] No monitor state found to archive`, {
					fleetId,
					fleetBossId,
				})
				return
			}

			const startedAt = state.lastChecked ? new Date(state.lastChecked) : new Date()

			// Calculate duration in minutes
			const durationMs = endedAt.getTime() - startedAt.getTime()
			const durationMinutes = Math.round(durationMs / (1000 * 60))

			// Prefer the real peak from the monitor's SQLite, falling back to the
			// last-known cached member count for the legacy/pre-session path.
			const peakMemberCount = options?.peakMemberCount ?? state.peakMemberCount ?? state.memberCount
			const finalMemberCount = state.memberCount

			// Check if summary already exists (idempotent)
			const [existing] = await this.db
				.select()
				.from(fleetSummaries)
				.where(eq(fleetSummaries.fleetId, fleetId))
				.limit(1)

			if (existing) {
				logger.debug(`[FleetMonitor ${fleetId}] Summary already exists, skipping archive`, {
					fleetId,
				})
				return
			}

			// Create summary entry
			await this.db.insert(fleetSummaries).values({
				fleetId,
				fleetBossId,
				trackingSessionId: options?.trackingSessionId ?? null,
				startedAt,
				endedAt,
				peakMemberCount,
				finalMemberCount,
				motd: state.motd || null,
				isFreeMove: state.isFreeMove,
				isRegistered: state.isRegistered,
				isVoiceEnabled: state.isVoiceEnabled,
				durationMinutes,
			})

			logger.info(`[FleetMonitor ${fleetId}] Archived fleet to summaries`, {
				fleetId,
				fleetBossId,
				startedAt: startedAt.toISOString(),
				endedAt: endedAt.toISOString(),
				durationMinutes,
				peakMemberCount,
			})
		} catch (error) {
			// Log error but don't throw - we don't want to prevent fleet cleanup
			logger.error(`[FleetMonitor ${fleetId}] Failed to archive fleet to summary`, {
				fleetId,
				fleetBossId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	/**
	 * Resolve character IDs to names using cache and API
	 * @param characterIds - Set of character IDs to resolve
	 * @returns Record mapping character ID to name
	 */
	private async resolveCharacterNames(characterIds: Set<string>): Promise<Record<string, string>> {
		const resolved: Record<string, string> = {}
		const uncachedIds: string[] = []

		// Check cache first
		for (const id of characterIds) {
			const cached = this.characterNameCache.get(id)
			if (cached !== undefined) {
				resolved[id] = cached
			} else {
				uncachedIds.push(id)
			}
		}

		// Resolve uncached IDs
		if (uncachedIds.length > 0) {
			const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
			const characterNames = await tokenStore.resolveIds(uncachedIds)
			for (const [id, name] of Object.entries(characterNames)) {
				resolved[id] = name
				this.characterNameCache.set(id, name)
			}
		}

		return resolved
	}

	/**
	 * Resolve character IDs to their current corporation IDs.
	 * Used to snapshot historical corp membership on join events.
	 */
	private async resolveCharacterCorps(
		characterIds: Set<string>
	): Promise<Record<string, string | null>> {
		const resolved: Record<string, string | null> = {}
		const uncachedIds: string[] = []

		for (const id of characterIds) {
			const cached = this.characterCorpCache.get(id)
			if (cached !== undefined) {
				resolved[id] = cached
			} else {
				uncachedIds.push(id)
			}
		}

		if (uncachedIds.length > 0) {
			// Issue all character-info lookups in parallel; tolerate per-character failures.
			const results = await Promise.allSettled(
				uncachedIds.map(async (id) => {
					const stub = getStub<EveCharacterData>(this.env.EVE_CHARACTER_DATA, id)
					const info = await stub.getCharacterInfo(id)
					return { id, corporationId: info?.corporationId ?? null }
				})
			)
			for (const r of results) {
				if (r.status === 'fulfilled') {
					const corp = r.value.corporationId ? String(r.value.corporationId) : null
					resolved[r.value.id] = corp
					if (corp) this.characterCorpCache.set(r.value.id, corp)
				}
			}
		}

		return resolved
	}

	/**
	 * Resolve system IDs to names using cache and API
	 * @param systemIds - Set of system IDs to resolve
	 * @returns Record mapping system ID to name
	 */
	private async resolveSystemNames(systemIds: Set<string>): Promise<Record<string, string>> {
		const resolved: Record<string, string> = {}
		const uncachedIds: string[] = []

		// Check cache first
		for (const id of systemIds) {
			const cached = this.systemNameCache.get(id)
			if (cached !== undefined) {
				resolved[id] = cached
			} else {
				uncachedIds.push(id)
			}
		}

		// Resolve uncached IDs
		if (uncachedIds.length > 0) {
			const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
			const systemNames = await tokenStore.resolveIds(uncachedIds)
			for (const [id, name] of Object.entries(systemNames)) {
				resolved[id] = name
				this.systemNameCache.set(id, name)
			}
		}

		return resolved
	}

	/**
	 * Resolve ship type IDs to names using cache and API
	 * @param shipTypeIds - Set of ship type IDs to resolve
	 * @returns Record mapping ship type ID to name
	 */
	private async resolveShipTypeNames(shipTypeIds: Set<string>): Promise<Record<string, string>> {
		const resolved: Record<string, string> = {}
		const uncachedIds: string[] = []

		// Check cache first
		for (const id of shipTypeIds) {
			const cached = this.shipTypeNameCache.get(id)
			if (cached !== undefined) {
				resolved[id] = cached
			} else {
				uncachedIds.push(id)
			}
		}

		// Resolve uncached IDs
		if (uncachedIds.length > 0) {
			const universeStub = getStub<Universe>(this.env.UNIVERSE, 'default')
			const shipTypes = await universeStub.resolveTypeNamesByIds(uncachedIds)
			for (const [id, type] of Object.entries(shipTypes)) {
				const name = (type as InvType | null)?.typeName || id
				resolved[id] = name
				this.shipTypeNameCache.set(id, name)
			}
		}

		return resolved
	}

	/**
	 * Resolve station IDs to names using cache and API
	 * Filters out null/undefined/0 station IDs before resolution
	 * @param stationIds - Array of station IDs (may include nulls)
	 * @returns Record mapping station ID to name
	 */
	private async resolveStationNames(
		stationIds: Array<number | null | undefined>
	): Promise<Record<string, string>> {
		const resolved: Record<string, string> = {}

		// Filter out null/undefined/0 station IDs
		const validStationIds = stationIds
			.map((id) => normalizeStationId(id))
			.filter((id): id is number => id !== null)

		if (validStationIds.length === 0) {
			return resolved
		}

		const uniqueStationIds = [...new Set(validStationIds.map((id) => String(id)))]
		const uncachedIds: string[] = []

		// Check cache first
		for (const id of uniqueStationIds) {
			const cached = this.stationNameCache.get(id)
			if (cached !== undefined) {
				resolved[id] = cached
			} else {
				uncachedIds.push(id)
			}
		}

		// Resolve uncached IDs
		if (uncachedIds.length > 0) {
			const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
			const stationNames = await tokenStore.resolveIds(uncachedIds)
			for (const [id, name] of Object.entries(stationNames)) {
				resolved[id] = name
				this.stationNameCache.set(id, name)
			}
		}

		return resolved
	}

	/**
	 * Extract error details from a database insert error for logging
	 * Handles PostgreSQL/Drizzle error properties and filters out large SQL queries
	 *
	 * @param insertError - The error that occurred during insert
	 * @param context - Context information (fleetId, batchIndex, batchSize)
	 * @param sampleRecord - Optional sample record from the batch for debugging
	 * @returns Error details object suitable for logging
	 */
	private extractInsertErrorDetails(
		insertError: unknown,
		context: {
			fleetId: string
			batchIndex: number
			batchSize: number
		},
		sampleRecord?: {
			characterId: string
			shipTypeId: number
			stationId: number | null
		}
	): Record<string, unknown> {
		// Extract error message without the full SQL query (too large for logs)
		let errorMessage = insertError instanceof Error ? insertError.message : String(insertError)
		if (errorMessage.includes('Failed query:')) {
			errorMessage = errorMessage.split('\nparams:')[0] // Keep only the part before params
		}

		// Capture essential error details (without the huge SQL query)
		const errorDetails: Record<string, unknown> = {
			fleetId: context.fleetId,
			batchIndex: context.batchIndex,
			batchSize: context.batchSize,
			error: errorMessage,
		}

		// Extract nested error information (common in Neon/Drizzle errors)
		if (insertError && typeof insertError === 'object') {
			const err = insertError as Record<string, unknown>

			// Check for common PostgreSQL error properties
			if (err.code) errorDetails.code = err.code
			if (err.detail) errorDetails.detail = err.detail
			if (err.hint) errorDetails.hint = err.hint
			if (err.severity) errorDetails.severity = err.severity
			if (err.position) errorDetails.position = err.position

			// Check for nested cause
			if (err.cause) {
				if (err.cause && typeof err.cause === 'object') {
					const cause = err.cause as Record<string, unknown>
					if (cause.message) errorDetails.causeMessage = cause.message
					if (cause.code) errorDetails.causeCode = cause.code
					if (cause.detail) errorDetails.causeDetail = cause.detail
				} else {
					errorDetails.cause = String(err.cause)
				}
			}

			// Include other important error properties (but not huge strings)
			Object.keys(err).forEach((key) => {
				if (
					!['message', 'stack', 'code', 'detail', 'hint', 'severity', 'position', 'cause'].includes(
						key
					)
				) {
					const value = err[key]
					// Only include simple values, not huge objects/strings
					if (
						typeof value === 'string' &&
						value.length < 500 &&
						!value.includes('insert into') &&
						!value.includes('values (default')
					) {
						errorDetails[key] = value
					} else if (typeof value !== 'object' && typeof value !== 'function') {
						errorDetails[key] = value
					}
				}
			})
		}

		// Add sample record for debugging data issues
		if (sampleRecord) {
			errorDetails.sampleRecord = {
				characterId: sampleRecord.characterId,
				shipTypeId: sampleRecord.shipTypeId,
				stationId: sampleRecord.stationId,
				stationIdType: typeof sampleRecord.stationId,
			}
		}

		return errorDetails
	}

	/**
	 * Insert fleet member history records in batches with validation and error handling
	 *
	 * @param values - Array of fleet member history records to insert
	 * @param fleetId - Fleet ID for context
	 * @param batchSize - Size of each batch (default: 20)
	 * @param eventType - Type of event for logging ('join' | 'leave' | 'initial')
	 */
	private async insertFleetMemberHistoryBatch(
		values: Array<{
			fleetId: string
			characterId: string
			eventType: 'join' | 'leave'
			shipTypeId: number
			solarSystemId: number
			stationId: number | null
			role: string
			roleName: string
			squadId: string
			wingId: string
			joinedAt: Date | null
			leftAt: Date | null
			eventTimestamp: Date
			characterName: string | null
			systemName: string | null
			shipTypeName: string | null
			wingName: string | null
			squadName: string | null
			corporationId: string | null
		}>,
		fleetId: string,
		batchSize: number = 20,
		eventType: 'join' | 'leave' | 'initial'
	): Promise<void> {
		if (values.length === 0) {
			return
		}

		// Insert in batches
		for (let i = 0; i < values.length; i += batchSize) {
			const batch = values.slice(i, i + batchSize)

			// Validate and normalize batch data before insert
			const validatedBatch = batch.map((item) => ({
				...item,
				stationId: normalizeStationId(item.stationId),
			}))

			try {
				await this.db.insert(fleetMemberHistory).values(validatedBatch)
			} catch (insertError) {
				const errorDetails = this.extractInsertErrorDetails(
					insertError,
					{
						fleetId,
						batchIndex: i / batchSize + 1,
						batchSize: batch.length,
					},
					validatedBatch.length > 0
						? {
								characterId: validatedBatch[0].characterId,
								shipTypeId: validatedBatch[0].shipTypeId,
								stationId: validatedBatch[0].stationId,
							}
						: undefined
				)

				logger.error(
					`[FleetMonitor ${fleetId}] Failed to insert ${eventType} batch ${i / batchSize + 1}`,
					errorDetails
				)
				throw insertError
			}
		}
	}

	/**
	 * Backfill character/ship/system/station names for the initial-snapshot rows
	 * that were inserted with nulls. Runs in the background via state.waitUntil
	 * so it doesn't block initialization.
	 *
	 * Only updates rows whose name columns are still null, so multiple invocations
	 * are safe and never overwrite already-resolved names.
	 */
	private async backfillInitialSnapshotNames(
		fleetId: string,
		members: EsiGetFleetMembers,
		eventTimestamp: Date
	): Promise<void> {
		try {
			const characterIds = new Set(members.map((m) => String(m.character_id)))
			const shipTypeIds = new Set(members.map((m) => String(m.ship_type_id)))
			const systemIds = new Set(members.map((m) => String(m.solar_system_id)))
			const stationIds = members.map((m) => m.station_id)

			const [characterNames, shipTypeNames, systemNames, stationNames] = await Promise.all([
				this.resolveCharacterNames(characterIds),
				this.resolveShipTypeNames(shipTypeIds),
				this.resolveSystemNames(systemIds),
				this.resolveStationNames(stationIds),
			])

			// Issue one UPDATE per character; small N (one fleet roster) and gated on
			// the specific eventTimestamp + IS NULL so we never clobber real data.
			for (const member of members) {
				const charId = String(member.character_id)
				const characterName = characterNames[charId] ?? null
				const shipTypeName = shipTypeNames[String(member.ship_type_id)] ?? null
				const systemName = systemNames[String(member.solar_system_id)] ?? null
				const stationId = normalizeStationId(member.station_id)
				const stationName = stationId !== null ? (stationNames[String(stationId)] ?? null) : null

				if (
					characterName === null &&
					shipTypeName === null &&
					systemName === null &&
					stationName === null
				) {
					continue
				}

				try {
					await this.db
						.update(fleetMemberHistory)
						.set({
							characterName,
							shipTypeName,
							systemName,
						})
						.where(
							and(
								eq(fleetMemberHistory.fleetId, fleetId),
								eq(fleetMemberHistory.characterId, charId),
								eq(fleetMemberHistory.eventTimestamp, eventTimestamp),
								isNull(fleetMemberHistory.characterName)
							)
						)
				} catch (updateError) {
					logger.warn(
						`[FleetMonitor ${fleetId}] Failed to backfill names for character ${charId}`,
						{
							fleetId,
							characterId: charId,
							error: updateError instanceof Error ? updateError.message : String(updateError),
						}
					)
				}
			}

			logger.info(`[FleetMonitor ${fleetId}] Backfilled initial-snapshot names`, {
				fleetId,
				memberCount: members.length,
			})
		} catch (error) {
			logger.warn(`[FleetMonitor ${fleetId}] Initial-snapshot name backfill failed`, {
				fleetId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	/**
	 * Track member history by comparing current members with previous snapshot
	 * Detects joins, leaves, and ship changes, storing them in
	 * fleetMemberHistory and fleetMemberShipEvents.
	 */
	private async trackMemberHistory(
		fleetId: string,
		currentMembers: EsiGetFleetMembers,
		trackingSessionId: string
	): Promise<void> {
		const now = new Date()
		const eventTimestamp = now.toISOString()

		// Get previous members snapshot from SQLite
		const previousMembersResult = this.state.storage.sql
			.exec<{
				character_id: string
				ship_type_id: number
				solar_system_id: number
				station_id: number | null
				role: string
				role_name: string
				squad_id: number
				wing_id: number
				join_time: string
				last_seen: string
			}>(`SELECT * FROM previous_members`)
			.toArray()

		const previousMembers = new Map(previousMembersResult.map((m) => [m.character_id, m]))

		// Create current members map
		const currentMembersMap = new Map(currentMembers.map((m) => [String(m.character_id), m]))

		// Detect joins (in current but not in previous)
		const joins: Array<{
			characterId: string
			member: (typeof currentMembers)[0]
		}> = []
		for (const member of currentMembers) {
			const charId = String(member.character_id)
			if (!previousMembers.has(charId)) {
				joins.push({ characterId: charId, member })
			}
		}

		// Detect leaves (in previous but not in current)
		const leaves: Array<{
			characterId: string
			previous: (typeof previousMembersResult)[0]
		}> = []
		for (const [charId, previous] of previousMembers.entries()) {
			if (!currentMembersMap.has(charId)) {
				leaves.push({ characterId: charId, previous })
			}
		}

		// Resolve names for all events (joins and leaves)
		// Collect unique IDs from both joins and leaves
		const allCharacterIds = new Set<string>()
		const allSystemIds = new Set<string>()
		const allShipTypeIds = new Set<string>()

		for (const { member } of joins) {
			allCharacterIds.add(String(member.character_id))
			allSystemIds.add(String(member.solar_system_id))
			allShipTypeIds.add(String(member.ship_type_id))
		}

		for (const { previous } of leaves) {
			allCharacterIds.add(previous.character_id)
			allSystemIds.add(String(previous.solar_system_id))
			allShipTypeIds.add(String(previous.ship_type_id))
		}

		// Resolve names using helper functions
		const resolvedCharacterNames: Record<string, string> = {}
		const resolvedSystemNames: Record<string, string> = {}
		const resolvedShipTypeNames: Record<string, string> = {}

		// Resolve all names in parallel for better performance.
		// Corp lookup runs alongside name lookups; results assigned below.
		const [characterNamesResult, systemNamesResult, shipTypeNamesResult, characterCorpsResult] =
			await Promise.allSettled([
				allCharacterIds.size > 0 ? this.resolveCharacterNames(allCharacterIds) : {},
				allSystemIds.size > 0 ? this.resolveSystemNames(allSystemIds) : {},
				allShipTypeIds.size > 0 ? this.resolveShipTypeNames(allShipTypeIds) : {},
				allCharacterIds.size > 0
					? this.resolveCharacterCorps(allCharacterIds)
					: ({} as Record<string, string | null>),
			])
		const resolvedCharacterCorps: Record<string, string | null> = {}
		if (characterCorpsResult.status === 'fulfilled') {
			Object.assign(resolvedCharacterCorps, characterCorpsResult.value)
		} else {
			logger.warn(`[FleetMonitor ${fleetId}] Failed to resolve character corps`, {
				fleetId,
				error:
					characterCorpsResult.reason instanceof Error
						? characterCorpsResult.reason.message
						: String(characterCorpsResult.reason),
			})
		}

		// Extract results with error handling
		if (characterNamesResult.status === 'fulfilled') {
			Object.assign(resolvedCharacterNames, characterNamesResult.value)
		} else {
			logger.warn(`[FleetMonitor ${fleetId}] Failed to resolve character names for history`, {
				fleetId,
				error:
					characterNamesResult.reason instanceof Error
						? characterNamesResult.reason.message
						: String(characterNamesResult.reason),
			})
		}

		if (systemNamesResult.status === 'fulfilled') {
			Object.assign(resolvedSystemNames, systemNamesResult.value)
		} else {
			logger.warn(`[FleetMonitor ${fleetId}] Failed to resolve system names for history`, {
				fleetId,
				error:
					systemNamesResult.reason instanceof Error
						? systemNamesResult.reason.message
						: String(systemNamesResult.reason),
			})
		}

		if (shipTypeNamesResult.status === 'fulfilled') {
			Object.assign(resolvedShipTypeNames, shipTypeNamesResult.value)
		} else {
			logger.warn(`[FleetMonitor ${fleetId}] Failed to resolve ship type names for history`, {
				fleetId,
				error:
					shipTypeNamesResult.reason instanceof Error
						? shipTypeNamesResult.reason.message
						: String(shipTypeNamesResult.reason),
			})
		}

		// Store join events (batched to avoid parameter limits)
		if (joins.length > 0) {
			const BATCH_SIZE = 20 // Reduced from 50 to avoid parameter limit issues
			const joinValues = joins.map(({ characterId, member }) => ({
				fleetId,
				characterId,
				eventType: 'join' as const,
				shipTypeId: member.ship_type_id,
				solarSystemId: member.solar_system_id,
				stationId: normalizeStationId(member.station_id),
				role: member.role,
				roleName: member.role_name,
				squadId: String(member.squad_id), // Convert to string for text column
				wingId: String(member.wing_id), // Convert to string for text column
				joinedAt: new Date(member.join_time),
				leftAt: null,
				eventTimestamp: now,
				// Include resolved names (null if resolution failed)
				characterName: resolvedCharacterNames[characterId] || null,
				systemName: resolvedSystemNames[String(member.solar_system_id)] || null,
				shipTypeName: resolvedShipTypeNames[String(member.ship_type_id)] || null,
				wingName: null, // To be implemented later
				squadName: null, // To be implemented later
				corporationId: resolvedCharacterCorps[characterId] ?? null,
			}))

			// Insert in batches using helper
			await this.insertFleetMemberHistoryBatch(joinValues, fleetId, BATCH_SIZE, 'join')

			logger.info(`[FleetMonitor ${fleetId}] Detected ${joins.length} member joins`, {
				fleetId,
				joinCount: joins.length,
			})
		}

		// Store leave events (batched to avoid parameter limits)
		if (leaves.length > 0) {
			const BATCH_SIZE = 20 // Reduced from 50 to avoid parameter limit issues
			const leaveValues = leaves.map(({ characterId, previous }) => ({
				fleetId,
				characterId,
				eventType: 'leave' as const,
				shipTypeId: previous.ship_type_id,
				solarSystemId: previous.solar_system_id,
				stationId: normalizeStationId(previous.station_id),
				role: previous.role,
				roleName: previous.role_name,
				squadId: String(previous.squad_id), // Convert to string for text column
				wingId: String(previous.wing_id), // Convert to string for text column
				joinedAt: previous.join_time ? new Date(previous.join_time) : null,
				leftAt: now,
				eventTimestamp: now,
				// Include resolved names (null if resolution failed)
				characterName: resolvedCharacterNames[characterId] || null,
				systemName: resolvedSystemNames[String(previous.solar_system_id)] || null,
				shipTypeName: resolvedShipTypeNames[String(previous.ship_type_id)] || null,
				wingName: null, // To be implemented later
				squadName: null, // To be implemented later
				corporationId: resolvedCharacterCorps[characterId] ?? null,
			}))

			// Insert in batches using helper
			await this.insertFleetMemberHistoryBatch(leaveValues, fleetId, BATCH_SIZE, 'leave')

			logger.info(`[FleetMonitor ${fleetId}] Detected ${leaves.length} member leaves`, {
				fleetId,
				leaveCount: leaves.length,
			})
		}

		// Detect ship changes for members present in both snapshots.
		// On change: close the open ship-event row, open a new one with the
		// current location.
		const shipChanges: Array<{
			characterId: string
			previousShipTypeId: number
			currentShipTypeId: number
			currentSolarSystemId: number
			currentStationId: number | null
		}> = []
		for (const member of currentMembers) {
			const charId = String(member.character_id)
			const previous = previousMembers.get(charId)
			if (!previous) continue // join — already handled above (initial ship row inserted below)
			if (previous.ship_type_id !== member.ship_type_id) {
				shipChanges.push({
					characterId: charId,
					previousShipTypeId: previous.ship_type_id,
					currentShipTypeId: member.ship_type_id,
					currentSolarSystemId: member.solar_system_id,
					currentStationId: normalizeStationId(member.station_id),
				})
			}
		}

		if (shipChanges.length > 0 || joins.length > 0 || leaves.length > 0) {
			try {
				// Close the open ship-event row for ship changes and leaves
				const charsToClose = [
					...shipChanges.map((c) => c.characterId),
					...leaves.map((l) => l.characterId),
				]
				if (charsToClose.length > 0) {
					// Drizzle doesn't support multi-row close with different ids in a single
					// statement cleanly, so we issue one update per character. These are
					// fast (indexed) and the count is bounded by member churn per tick.
					for (const charId of charsToClose) {
						await this.db
							.update(fleetMemberShipEvents)
							.set({ endedAt: now })
							.where(
								and(
									eq(fleetMemberShipEvents.trackingSessionId, trackingSessionId),
									eq(fleetMemberShipEvents.characterId, charId),
									isNull(fleetMemberShipEvents.endedAt)
								)
							)
					}
				}

				// Open new ship-event rows for joins and ship changes
				const newRows: Array<typeof fleetMemberShipEvents.$inferInsert> = []
				for (const { characterId, member } of joins) {
					newRows.push({
						trackingSessionId,
						fleetId,
						characterId,
						shipTypeId: member.ship_type_id,
						solarSystemId: member.solar_system_id,
						stationId: normalizeStationId(member.station_id),
						startedAt: now,
						endedAt: null,
						eventTimestamp: now,
					})
				}
				for (const change of shipChanges) {
					newRows.push({
						trackingSessionId,
						fleetId,
						characterId: change.characterId,
						shipTypeId: change.currentShipTypeId,
						solarSystemId: change.currentSolarSystemId,
						stationId: change.currentStationId,
						startedAt: now,
						endedAt: null,
						eventTimestamp: now,
					})
				}
				if (newRows.length > 0) {
					const BATCH_SIZE = 50
					for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
						await this.db.insert(fleetMemberShipEvents).values(newRows.slice(i, i + BATCH_SIZE))
					}
				}

				logger.info(`[FleetMonitor ${fleetId}] Ship events written`, {
					fleetId,
					joinedShips: joins.length,
					shipChanges: shipChanges.length,
					closedOnLeave: leaves.length,
				})
			} catch (error) {
				const errAny = error as {
					message?: string
					code?: string
					stack?: string
					detail?: string
					constraint?: string
				}
				logger.error(`[FleetMonitor ${fleetId}] Failed to write ship events`, {
					fleetId,
					trackingSessionId,
					joinsCount: joins.length,
					shipChangesCount: shipChanges.length,
					leavesCount: leaves.length,
					errorMessage: errAny?.message,
					errorCode: errAny?.code,
					errorDetail: errAny?.detail,
					errorConstraint: errAny?.constraint,
					errorStack: errAny?.stack,
				})
			}
		}

		// Update previous members snapshot with current members
		// Clear old snapshot first
		this.state.storage.sql.exec(`DELETE FROM previous_members`)

		// Insert current members as new snapshot using parameterized queries
		if (currentMembers.length > 0) {
			for (const member of currentMembers) {
				const charId = String(member.character_id)
				this.state.storage.sql.exec(
					`
					INSERT INTO previous_members (
						character_id, ship_type_id, solar_system_id, station_id,
						role, role_name, squad_id, wing_id, join_time, last_seen
					)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				`,
					charId,
					member.ship_type_id,
					member.solar_system_id,
					member.station_id ?? null,
					member.role,
					member.role_name,
					member.squad_id,
					member.wing_id,
					member.join_time,
					eventTimestamp
				)
			}
		}
	}

	/**
	 * Alarm handler - triggered every 30 seconds to update fleet status
	 * Automatically reschedules itself for the next 30 seconds
	 */
	async alarm(): Promise<void> {
		logger.info('[FleetMonitor] Alarm triggered', {
			timestamp: new Date().toISOString(),
		})

		// Load state from SQLite
		const state = await this.getState()
		if (!state || !state.isInitialized) {
			logger.warn('[FleetMonitor] Alarm triggered but not initialized, stopping')
			return
		}

		const { fleetId, peakMemberCount } = state
		let characterId = state.characterId
		let trackingSessionId = state.trackingSessionId

		// Validate that we have required IDs
		if (!fleetId || !characterId || fleetId.trim() === '' || characterId.trim() === '') {
			logger.warn('[FleetMonitor] Alarm triggered but missing fleetId or characterId, stopping', {
				fleetId: fleetId || 'missing',
				characterId: characterId || 'missing',
			})
			return
		}

		// Legacy DO recovery: instances that started before the v3 SQLite migration
		// have no trackingSessionId stored. Recover it by looking up the active
		// session for this fleetId in the database. Then persist it locally so we
		// don't pay this cost again. If we still can't find one, bail.
		if (!trackingSessionId) {
			try {
				const [row] = await this.db
					.select({ id: fleetTrackingSessions.id })
					.from(fleetTrackingSessions)
					.where(
						and(
							eq(fleetTrackingSessions.fleetId, fleetId),
							eq(fleetTrackingSessions.status, 'active')
						)
					)
					.limit(1)
				if (row) {
					trackingSessionId = row.id
					this.state.storage.sql.exec(
						`UPDATE monitor_state SET tracking_session_id = ?, expires_at = ? WHERE id = 1`,
						trackingSessionId,
						this.getMonitorStateExpiresAtIso()
					)
					logger.info('[FleetMonitor] Recovered missing trackingSessionId from DB', {
						fleetId,
						trackingSessionId,
					})
				}
			} catch (error) {
				logger.warn('[FleetMonitor] Failed to recover trackingSessionId', {
					fleetId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		if (!trackingSessionId) {
			logger.warn(
				'[FleetMonitor] Alarm triggered but no tracking session is associated, stopping',
				{ fleetId, characterId }
			)
			await this.clearMonitorStorage(fleetId)
			return
		}

		const [sessionRow] = await this.db
			.select({
				id: fleetTrackingSessions.id,
				status: fleetTrackingSessions.status,
				endedAt: fleetTrackingSessions.endedAt,
				endedReason: fleetTrackingSessions.endedReason,
				endedByUserId: fleetTrackingSessions.endedByUserId,
				fleetId: fleetTrackingSessions.fleetId,
			})
			.from(fleetTrackingSessions)
			.where(eq(fleetTrackingSessions.id, trackingSessionId))
			.limit(1)

		if (!sessionRow || sessionRow.fleetId !== fleetId) {
			logger.warn('[FleetMonitor] Tracking session missing or mismatched; clearing monitor state', {
				fleetId,
				trackingSessionId,
			})
			await this.clearMonitorStorage(fleetId)
			return
		}

		const effectiveSessionStatus =
			sessionRow.status === 'active' && !sessionRow.endedAt ? 'active' : 'ended'
		if (effectiveSessionStatus !== 'active') {
			logger.info('[FleetMonitor] Session is no longer active; finalizing and stopping monitor', {
				fleetId,
				trackingSessionId,
				sessionStatus: effectiveSessionStatus,
			})
			await this.finalizeSession({
				fleetId,
				fleetBossId: characterId,
				trackingSessionId,
				endedAt: sessionRow.endedAt ?? new Date(),
				endedReason:
					(sessionRow.endedReason as
						| 'user_stopped'
						| 'admin_stopped'
						| 'fleet_disbanded'
						| 'esi_error'
						| 'token_expired') ?? 'fleet_disbanded',
				endedByUserId: sessionRow.endedByUserId ?? null,
				peakMemberCount,
			})
			await this.clearMonitorStorage(fleetId)
			return
		}

		// Schedule next alarm early to ensure it runs even if current execution times out
		// This prevents IoContext timeout issues in large fleets
		const nextAlarmPromise = this.scheduleNextAlarm()
		let lastKnownFleetBossId = characterId

		try {
			logger.info(`[FleetMonitor ${fleetId}] Fetching fleet status update`)

			// Get current fleet status
			const fleetStatus = await this.getFleetStatus()

			if (!fleetStatus) {
				logger.warn(`[FleetMonitor ${fleetId}] Failed to get fleet status, rescheduling`)
				await nextAlarmPromise
				return
			}

			const updatedState = await this.getState()
			if (updatedState?.characterId) {
				characterId = updatedState.characterId
			}
			lastKnownFleetBossId = updatedState?.lastSyncedFleetBossId ?? characterId

			// Legacy DO recovery: if this session has no ship-event rows yet but
			// the fleet has live members, seed them now. This catches DOs created
			// before the ship-event seeding was added in initializeMonitoring.
			if (fleetStatus.members && fleetStatus.members.length > 0) {
				try {
					const [shipEventCount] = await this.db
						.select({ count: sql<number>`count(*)::int` })
						.from(fleetMemberShipEvents)
						.where(eq(fleetMemberShipEvents.trackingSessionId, trackingSessionId))
					if ((shipEventCount?.count ?? 0) === 0) {
						const now = new Date()
						const seedRows = fleetStatus.members.map((member) => ({
							trackingSessionId,
							fleetId,
							characterId: String(member.character_id),
							shipTypeId: member.ship_type_id,
							solarSystemId: member.solar_system_id,
							stationId: normalizeStationId(member.station_id),
							startedAt: now,
							endedAt: null,
							eventTimestamp: now,
						}))
						const BATCH = 50
						for (let i = 0; i < seedRows.length; i += BATCH) {
							await this.db.insert(fleetMemberShipEvents).values(seedRows.slice(i, i + BATCH))
						}
						logger.info(
							`[FleetMonitor ${fleetId}] Seeded ${seedRows.length} initial ship-event rows on legacy recovery`,
							{ fleetId, trackingSessionId }
						)
					}
				} catch (error) {
					const errAny = error as {
						message?: string
						code?: string
						stack?: string
						detail?: string
						constraint?: string
					}
					logger.error(
						`[FleetMonitor ${fleetId}] Failed to seed ship-events during legacy recovery`,
						{
							fleetId,
							trackingSessionId,
							errorMessage: errAny?.message,
							errorCode: errAny?.code,
							errorDetail: errAny?.detail,
							errorConstraint: errAny?.constraint,
							errorStack: errAny?.stack,
						}
					)
				}
			}

			// Track member history (joins/leaves/ship-changes)
			if (fleetStatus.members) {
				await this.trackMemberHistory(fleetId, fleetStatus.members, trackingSessionId)
			}

			// Update peak member count if exceeded
			if (fleetStatus.memberCount > peakMemberCount) {
				this.state.storage.sql.exec(
					`UPDATE monitor_state SET peak_member_count = ?, expires_at = ? WHERE id = 1`,
					fleetStatus.memberCount,
					this.getMonitorStateExpiresAtIso()
				)
			}

			const observedAt = new Date()
			const previousFleetBossCharacterId = lastKnownFleetBossId
			// Persist the live monitor snapshot in Durable Object storage.
			const liveFleetBossId = fleetStatus.fleetBossId ?? characterId
			await syncFleetBossAccess(this.db, {
				fleetId,
				trackingSessionId,
				previousFleetBossCharacterId,
				currentFleetBossCharacterId: liveFleetBossId,
				observedAt,
			})
			if (liveFleetBossId !== characterId) {
				characterId = liveFleetBossId
			}
			await this.persistMonitorState({
				fleetId,
				characterId: liveFleetBossId,
				trackingSessionId,
				lastSyncedFleetBossId: liveFleetBossId,
				lastChecked: observedAt,
				peakMemberCount,
				memberCount: fleetStatus.memberCount,
				motd: fleetStatus.fleetInfo.motd || null,
				isFreeMove: fleetStatus.fleetInfo.is_free_move,
				isRegistered: fleetStatus.fleetInfo.is_registered,
				isVoiceEnabled: fleetStatus.fleetInfo.is_voice_enabled,
				notFound: false,
				notFoundAt: null,
			})

			// Broadcast update to connected WebSocket clients
			const connections = this.ctx.getWebSockets()
			if (connections.length > 0) {
				const updateMessage = JSON.stringify({
					type: 'fleet_update',
					fleetId,
					timestamp: new Date().toISOString(),
					data: fleetStatus,
				})

				for (const ws of connections) {
					try {
						ws.send(updateMessage)
					} catch (error) {
						logger.error(`[FleetMonitor ${fleetId}] Failed to send WebSocket update`, {
							fleetId,
							error: error instanceof Error ? error.message : String(error),
						})
					}
				}

				logger.info(`[FleetMonitor ${fleetId}] Broadcasted update to clients`, {
					fleetId,
					clientCount: connections.length,
				})
			}

			// Update lastChecked timestamp after successful check
			const now = new Date().toISOString()
			const expiresAt = this.getMonitorStateExpiresAt(new Date()).toISOString()
			await this.state.storage.sql.exec(
				`
			UPDATE monitor_state
			SET last_checked = ?, expires_at = ?
			WHERE id = 1
		`,
				now,
				expiresAt
			)

			// Clear 404 error tracking on successful check (fleet is confirmed active)
			// Ensure table exists before using it (safety check for existing DO instances)
			try {
				this.state.storage.sql.exec(`
					CREATE TABLE IF NOT EXISTS error_tracking (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						error_type TEXT NOT NULL,
						error_message TEXT NOT NULL,
						timestamp TEXT NOT NULL
					)
				`)
			} catch {
				// Ignore - table might already exist
			}
			this.state.storage.sql.exec(`DELETE FROM error_tracking WHERE error_type = '404'`)

			logger.info(`[FleetMonitor ${fleetId}] Fleet status updated successfully`, {
				fleetId,
				lastChecked: now,
			})

			// Respect ESI cache expiry guidance while maintaining a 10s baseline cadence.
			const nextDelayMs = computeNextPollDelayMs({
				basePollIntervalMs: FleetMonitorDO.BASE_POLL_INTERVAL_MS,
				nextPollAt: fleetStatus.nextPollAt ?? null,
			})
			await this.scheduleNextAlarm(nextDelayMs)

			// Ensure next alarm is scheduled (already scheduled early, but await to catch errors).
			await nextAlarmPromise
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			const fullError = error instanceof Error ? error.stack || error.message : String(error)

			// Check if fleet no longer exists (404 from ESI only)
			// ESI errors from fetchEsi follow the pattern: "ESI request failed: 404 Not Found - ..."
			// Only detect actual ESI 404 errors, not generic errors that might contain "404"
			const isEsi404 = errorMessage.includes('ESI request failed: 404')

			if (isEsi404) {
				logger.warn(`[FleetMonitor ${fleetId}] Received 404 error - tracking for confirmation`, {
					fleetId,
					error: fullError,
				})

				// Ensure error_tracking table exists (safety check for existing DO instances)
				try {
					this.state.storage.sql.exec(`
						CREATE TABLE IF NOT EXISTS error_tracking (
							id INTEGER PRIMARY KEY AUTOINCREMENT,
							error_type TEXT NOT NULL,
							error_message TEXT NOT NULL,
							timestamp TEXT NOT NULL
						)
					`)
				} catch (error) {
					logger.warn(`[FleetMonitor ${fleetId}] Could not ensure error_tracking table exists`, {
						fleetId,
						error: error instanceof Error ? error.message : String(error),
					})
				}

				// Track this 404 error
				const now = new Date().toISOString()
				this.state.storage.sql.exec(
					`
					INSERT INTO error_tracking (error_type, error_message, timestamp)
					VALUES (?, ?, ?)
				`,
					'404',
					fullError,
					now
				)

				// Check if we've had enough 404s in the time window to confirm fleet is gone
				// Require 3 consecutive 404s within 2 minutes (4 checks at 30s intervals)
				const timeWindowMs = 2 * 60 * 1000 // 2 minutes
				const required404Count = 3
				const cutoffTime = new Date(Date.now() - timeWindowMs).toISOString()

				const recent404s = this.state.storage.sql
					.exec<{ count: number }>(
						`
						SELECT COUNT(*) as count
						FROM error_tracking
						WHERE error_type = '404' AND timestamp > ?
					`,
						cutoffTime
					)
					.toArray()

				const recent404Count = recent404s.length > 0 ? recent404s[0].count : 0

				logger.info(`[FleetMonitor ${fleetId}] 404 error tracking`, {
					fleetId,
					recent404Count,
					required404Count,
					timeWindowMinutes: 2,
					error: fullError,
				})

				if (recent404Count >= required404Count) {
					logger.info(
						`[FleetMonitor ${fleetId}] Confirmed fleet no longer exists (${recent404Count} 404s in 2 minutes), stopping monitoring`,
						{
							fleetId,
							recent404Count,
							error: fullError,
						}
					)

					// Mark fleet as not found in monitor state and stop tracking.
					const endedAt = new Date()
					const liveFleetBossId = lastKnownFleetBossId

					// Finalize the session: close ship-events, mark session ended, archive
					if (trackingSessionId) {
						await this.finalizeSession({
							fleetId,
							fleetBossId: liveFleetBossId,
							trackingSessionId,
							endedAt,
							endedReason: 'fleet_disbanded',
							endedByUserId: null,
							peakMemberCount,
						})
					} else {
						// Defensive: pre-session DOs with no associated session row
						await this.archiveFleetToSummary(fleetId, liveFleetBossId, endedAt)
					}

					await this.persistMonitorState({
						fleetId,
						characterId: liveFleetBossId,
						trackingSessionId,
						lastSyncedFleetBossId: liveFleetBossId,
						lastChecked: endedAt,
						peakMemberCount,
						memberCount: 0,
						notFound: true,
						notFoundAt: endedAt,
					})

					// Clean up old error tracking data (keep last 24 hours)
					const cleanupTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
					this.state.storage.sql.exec(
						`
						DELETE FROM error_tracking WHERE timestamp < ?
					`,
						cleanupTime
					)

					// Don't reschedule alarm - fleet is gone, monitoring stops
					// Cancel the early-scheduled alarm since fleet is gone
					try {
						await this.state.storage.deleteAlarm()
					} catch {
						// Ignore if alarm doesn't exist
					}
					return
				} else {
					logger.debug(
						`[FleetMonitor ${fleetId}] Not enough 404s yet (${recent404Count}/${required404Count}), continuing monitoring`,
						{
							fleetId,
							recent404Count,
							required404Count,
						}
					)
					// Continue monitoring - next alarm already scheduled
					await nextAlarmPromise
					return
				}
			}

			logger.error(`[FleetMonitor ${fleetId}] Error in alarm handler`, {
				fleetId,
				error: error instanceof Error ? error.message : String(error),
			})
			// Reschedule even on error to keep trying (non-404 errors)
			// Next alarm already scheduled early, just await to catch errors
			await nextAlarmPromise
		}
	}

	/**
	 * Schedule the next alarm to run after a delay.
	 * Only schedules if the monitor is properly initialized with valid IDs
	 */
	private async scheduleNextAlarm(
		delayMs: number = FleetMonitorDO.BASE_POLL_INTERVAL_MS
	): Promise<void> {
		// Verify state is valid before scheduling
		const state = await this.getState()
		if (!state || !state.isInitialized) {
			logger.warn('[FleetMonitor] Cannot schedule alarm - monitor not initialized')
			return
		}

		if (
			!state.fleetId ||
			!state.characterId ||
			state.fleetId.trim() === '' ||
			state.characterId.trim() === ''
		) {
			logger.warn('[FleetMonitor] Cannot schedule alarm - missing fleetId or characterId', {
				fleetId: state.fleetId || 'missing',
				characterId: state.characterId || 'missing',
			})
			return
		}

		const clampedDelayMs = Math.max(1_000, delayMs)
		const nextAlarmTime = Date.now() + clampedDelayMs

		await this.state.storage.setAlarm(nextAlarmTime)

		logger.info(`[FleetMonitor ${state.fleetId}] Alarm scheduled`, {
			fleetId: state.fleetId,
			delayMs: clampedDelayMs,
			nextAlarmTime: new Date(nextAlarmTime).toISOString(),
		})
	}

	/**
	 * WebSocket message handler (Hibernation API)
	 * Called when a WebSocket message is received
	 */
	async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
		try {
			const data =
				typeof message === 'string'
					? JSON.parse(message)
					: JSON.parse(new TextDecoder().decode(message))

			const state = await this.getState()
			const fleetId = state?.fleetId || 'unknown'
			logger.info(`[FleetMonitor ${fleetId}] WebSocket message received`, {
				fleetId,
				messageType: data.type,
			})

			switch (data.type) {
				case 'ping':
					ws.send(JSON.stringify({ type: 'pong', payload: Date.now() }))
					break

				case 'subscribe': {
					// Send current fleet status immediately
					const currentState = await this.getState()
					if (currentState?.isInitialized) {
						const fleetStatus = await this.getFleetStatus()
						if (fleetStatus) {
							ws.send(
								JSON.stringify({
									type: 'fleet_status',
									fleetId: currentState.fleetId,
									data: fleetStatus,
								})
							)
						}
					}
					ws.send(JSON.stringify({ type: 'subscribed' }))
					break
				}

				case 'unsubscribe':
					ws.send(JSON.stringify({ type: 'unsubscribed' }))
					break

				default:
					ws.send(JSON.stringify({ type: 'error', payload: 'Unknown message type' }))
			}
		} catch (error) {
			const state = await this.getState()
			const fleetId = state?.fleetId || 'unknown'
			logger.error(`[FleetMonitor ${fleetId}] Error processing WebSocket message`, {
				fleetId,
				error: error instanceof Error ? error.message : String(error),
			})
			ws.send(JSON.stringify({ type: 'error', payload: 'Invalid message format' }))
		}
	}

	/**
	 * WebSocket close handler (Hibernation API)
	 * Called when a WebSocket connection is closed
	 */
	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
		wasClean: boolean
	): Promise<void> {
		const state = await this.getState()
		const fleetId = state?.fleetId || 'unknown'
		logger.info(`[FleetMonitor ${fleetId}] WebSocket closed`, {
			fleetId,
			code,
			reason,
			wasClean,
		})
	}

	/**
	 * WebSocket error handler (Hibernation API)
	 * Called when a WebSocket error occurs
	 */
	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		const state = await this.getState()
		const fleetId = state?.fleetId || 'unknown'
		logger.error(`[FleetMonitor ${fleetId}] WebSocket error`, {
			fleetId,
			error: error instanceof Error ? error.message : String(error),
		})
	}

	/**
	 * Fetch handler for HTTP requests to the Durable Object
	 */
	async fetch(request: Request): Promise<Response> {
		// WebSocket upgrade handling
		if (request.headers.get('Upgrade') === 'websocket') {
			const pair = new WebSocketPair()
			const [client, server] = Object.values(pair)

			// Accept the WebSocket connection using hibernation API
			this.ctx.acceptWebSocket(server)

			return new Response(null, {
				status: 101,
				webSocket: client,
			})
		}

		// HTTP GET request - return current fleet status
		if (request.method === 'GET') {
			try {
				const fleetStatus = await this.getFleetStatus()
				if (!fleetStatus) {
					return new Response(JSON.stringify({ error: 'Fleet monitor not initialized' }), {
						status: 404,
						headers: { 'Content-Type': 'application/json' },
					})
				}
				return new Response(JSON.stringify(fleetStatus), {
					headers: { 'Content-Type': 'application/json' },
				})
			} catch (error) {
				return new Response(
					JSON.stringify({
						error: 'Failed to get fleet status',
						message: error instanceof Error ? error.message : String(error),
					}),
					{
						status: 500,
						headers: { 'Content-Type': 'application/json' },
					}
				)
			}
		}

		return new Response('FleetMonitor Durable Object', { status: 200 })
	}
}
