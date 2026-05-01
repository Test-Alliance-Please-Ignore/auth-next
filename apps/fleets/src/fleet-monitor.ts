import { DurableObject } from 'cloudflare:workers'

import { createDbClient, createDbClientWs, eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import {
	EsiGetFleetInformation,
	esiGetFleetInformationSchema,
	EsiGetFleetMembers,
	esiGetFleetMembersSchema,
	FleetDetailsResponse,
	FleetMonitorState,
	FleetMonitorStateRow,
} from '@repo/fleets'
import { logger } from '@repo/hono-helpers'

import { Env } from './context'
import { fleetMemberHistory, fleetStateCache, fleetSummaries, schema } from './db/schema'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { InvType, Universe } from '@repo/universe'

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

/**
 * FleetMonitor Durable Object
 *
 * This Durable Object is created per-fleet (id: `fleet-${fleetId}`) and implements:
 * - RPC methods for fleet status queries
 * - Alarm handler for periodic fleet status updates (every 30 seconds)
 * - WebSocket hibernation API for real-time updates
 * - SQLite-backed state for instance-specific data (fleetId, characterId)
 * - PostgreSQL for cross-instance data (fleetStateCache)
 */
export class FleetMonitorDO extends DurableObject {
	private db: ReturnType<typeof createDbClientWs<typeof schema>>
	// In-memory caches for ID to name mappings
	private characterNameCache = new Map<string, string>()
	private shipTypeNameCache = new Map<string, string>()
	private systemNameCache = new Map<string, string>()
	private stationNameCache = new Map<string, string>()

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
		const targetVersion = 2 // Current schema version

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
					last_checked TEXT
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
			} catch (error) {
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
		force: boolean = false
	): Promise<void> {
		// Check if already initialized for this fleet (unless forcing re-initialization)
		if (!force) {
			const existingState = await this.getState()
			if (existingState && existingState.isInitialized && existingState.fleetId === fleetId) {
				logger.debug(`[FleetMonitor ${fleetId}] Already initialized, skipping re-initialization`, {
					fleetId,
					characterId,
					lastChecked: existingState.lastChecked,
				})
				return
			}
		}

		logger.info(`[FleetMonitor ${fleetId}] Initializing monitoring`, {
			fleetId,
			characterId,
		})

		// Store initialization state in SQLite
		const now = new Date().toISOString()
		await this.state.storage.sql.exec(
			`
			INSERT INTO monitor_state (id, fleet_id, character_id, is_initialized, last_checked)
			VALUES (1, ?, ?, 1, ?)
			ON CONFLICT(id) DO UPDATE SET
				fleet_id = excluded.fleet_id,
				character_id = excluded.character_id,
				is_initialized = excluded.is_initialized,
				last_checked = excluded.last_checked
		`,
			fleetId,
			characterId,
			now
		)

		// Get initial fleet status to create baseline snapshot
		try {
			const initialStatus = await this.getFleetStatus()
			if (initialStatus) {
				// Update fleet cache immediately to clear inactive/ended state
				await this.db
					.insert(fleetStateCache)
					.values({
						fleetId,
						fleetBossId: characterId,
						isActive: true,
						memberCount: initialStatus.memberCount,
						motd: initialStatus.fleetInfo.motd || null,
						isFreeMove: initialStatus.fleetInfo.is_free_move,
						isRegistered: initialStatus.fleetInfo.is_registered,
						isVoiceEnabled: initialStatus.fleetInfo.is_voice_enabled,
						notFound: false,
						notFoundAt: null,
						endedAt: null,
						lastChecked: new Date(),
					})
					.onConflictDoUpdate({
						target: fleetStateCache.fleetId,
						set: {
							isActive: true,
							memberCount: initialStatus.memberCount,
							motd: initialStatus.fleetInfo.motd || null,
							isFreeMove: initialStatus.fleetInfo.is_free_move,
							isRegistered: initialStatus.fleetInfo.is_registered,
							isVoiceEnabled: initialStatus.fleetInfo.is_voice_enabled,
							notFound: false,
							notFoundAt: null,
							endedAt: null,
							lastChecked: new Date(),
							updatedAt: new Date(),
						},
					})

				logger.info(`[FleetMonitor ${fleetId}] Updated fleet cache during initialization`, {
					fleetId,
					memberCount: initialStatus.memberCount,
				})

				if (initialStatus.members) {
					// Create initial snapshot of all members as "joins" since this is the first check
					const now = new Date()
					const eventTimestamp = now.toISOString()

					// Store initial joins for all current members (batched to avoid parameter limits)
					if (initialStatus.members.length > 0) {
						const BATCH_SIZE = 20 // Reduced from 50 to avoid parameter limit issues
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
						}))

						// Insert in batches using helper
						await this.insertFleetMemberHistoryBatch(
							memberHistoryValues,
							fleetId,
							BATCH_SIZE,
							'initial'
						)

						// Create initial snapshot in SQLite
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

						logger.info(
							`[FleetMonitor ${fleetId}] Created initial snapshot with ${initialStatus.members.length} members`,
							{
								fleetId,
								memberCount: initialStatus.members.length,
							}
						)
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

		// Schedule first alarm for 30 seconds from now
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

			// Fetch fleet info
			const fleetResponse = await tokenStore.fetchEsi<EsiGetFleetInformation>(
				`/fleets/${fleetId}/`,
				characterId
			)
			const fleetInfo = esiGetFleetInformationSchema.parse(fleetResponse.data)

			// Fetch fleet members
			let members: EsiGetFleetMembers | undefined
			let memberCount = 0
			try {
				const membersResponse = await tokenStore.fetchEsi<EsiGetFleetMembers>(
					`/fleets/${fleetId}/members/`,
					characterId
				)
				members = esiGetFleetMembersSchema.parse(membersResponse.data)
				memberCount = members.length
			} catch (error) {
				logger.error(`[FleetMonitor ${fleetId}] Failed to fetch members`, {
					fleetId,
					error: error instanceof Error ? error.message : String(error),
				})
				members = undefined
			}

			// Get fleet boss name
			const characterStub = getStub<EveCharacterData>(this.env.EVE_CHARACTER_DATA, characterId)
			const characterInfo = await characterStub.getCharacterInfo(characterId)

			// Resolve ship type IDs, character IDs, system IDs, and station IDs to names if members are available
			let resolvedShipTypes: Record<string, string> | undefined
			let resolvedCharacterNames: Record<string, string> | undefined
			let resolvedSystemNames: Record<string, string> | undefined
			let resolvedStationNames: Record<string, string> | undefined
			if (members && members.length > 0) {
				// Collect unique IDs
				const uniqueShipTypeIds = new Set(members.map((m) => String(m.ship_type_id)))
				const uniqueCharacterIds = new Set(members.map((m) => String(m.character_id)))
				// Also include fleet boss if not already in the list
				if (characterId && !uniqueCharacterIds.has(characterId)) {
					uniqueCharacterIds.add(characterId)
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
				fleetBossName: characterInfo?.name,
				memberCount,
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
	 * Get monitor state (RPC method for watchdog)
	 * @returns Monitor state including lastChecked timestamp, or null if not initialized
	 */
	async getMonitorState(): Promise<FleetMonitorState | null> {
		return await this.getState()
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
			// Delete monitor_state
			this.state.storage.sql.exec(`DELETE FROM monitor_state WHERE id = 1`)

			// Delete schema_version (optional, but ensures clean state)
			try {
				this.state.storage.sql.exec(`DELETE FROM schema_version WHERE id = 1`)
			} catch (error) {
				// Ignore if table doesn't exist or error
				logger.debug(`[FleetMonitor ${fleetId}] Could not delete schema_version`, {
					error: error instanceof Error ? error.message : String(error),
				})
			}

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
				SELECT fleet_id, character_id, is_initialized, last_checked
				FROM monitor_state
				WHERE id = 1
			`
			)
			.toArray()

		if (result.length === 0) {
			return null
		}

		const row = result[0]
		return {
			fleetId: row.fleet_id,
			characterId: row.character_id,
			isInitialized: row.is_initialized === 1,
			lastChecked: row.last_checked,
		}
	}

	/**
	 * Archive a fleet to fleet_summaries before deletion from fleet_state_cache
	 * Uses createdAt from fleet_state_cache as startedAt (for existing fleets)
	 *
	 * @param fleetId - Fleet ID to archive
	 * @param characterId - Fleet boss character ID
	 * @param endedAt - When the fleet ended
	 */
	private async archiveFleetToSummary(
		fleetId: string,
		characterId: string,
		endedAt: Date
	): Promise<void> {
		try {
			// Get current fleet state from cache
			const [cached] = await this.db
				.select()
				.from(fleetStateCache)
				.where(eq(fleetStateCache.fleetId, fleetId))
				.limit(1)

			if (!cached) {
				logger.warn(`[FleetMonitor ${fleetId}] No cache entry found to archive`, {
					fleetId,
					characterId,
				})
				return
			}

			// Use createdAt as startedAt (for existing fleets when migration runs)
			// For new fleets, this will be accurate
			const startedAt = cached.createdAt || new Date()

			// Calculate duration in minutes
			const durationMs = endedAt.getTime() - startedAt.getTime()
			const durationMinutes = Math.round(durationMs / (1000 * 60))

			// For now, use current member count as both peak and final
			// TODO: Track peak member count during fleet lifetime
			const peakMemberCount = cached.memberCount
			const finalMemberCount = cached.memberCount

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
				fleetBossId: characterId,
				startedAt,
				endedAt,
				peakMemberCount,
				finalMemberCount,
				motd: cached.motd || null,
				isFreeMove: cached.isFreeMove,
				isRegistered: cached.isRegistered,
				isVoiceEnabled: cached.isVoiceEnabled,
				durationMinutes,
			})

			logger.info(`[FleetMonitor ${fleetId}] Archived fleet to summaries`, {
				fleetId,
				characterId,
				startedAt: startedAt.toISOString(),
				endedAt: endedAt.toISOString(),
				durationMinutes,
				peakMemberCount,
			})
		} catch (error) {
			// Log error but don't throw - we don't want to prevent fleet cleanup
			logger.error(`[FleetMonitor ${fleetId}] Failed to archive fleet to summary`, {
				fleetId,
				characterId,
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
	 * Track member history by comparing current members with previous snapshot
	 * Detects joins and leaves, stores them in fleetMemberHistory table
	 */
	private async trackMemberHistory(
		fleetId: string,
		currentMembers: EsiGetFleetMembers
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

		// Resolve all names in parallel for better performance
		const [characterNamesResult, systemNamesResult, shipTypeNamesResult] = await Promise.allSettled(
			[
				allCharacterIds.size > 0 ? this.resolveCharacterNames(allCharacterIds) : {},
				allSystemIds.size > 0 ? this.resolveSystemNames(allSystemIds) : {},
				allShipTypeIds.size > 0 ? this.resolveShipTypeNames(allShipTypeIds) : {},
			]
		)

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
			}))

			// Insert in batches using helper
			await this.insertFleetMemberHistoryBatch(leaveValues, fleetId, BATCH_SIZE, 'leave')

			logger.info(`[FleetMonitor ${fleetId}] Detected ${leaves.length} member leaves`, {
				fleetId,
				leaveCount: leaves.length,
			})
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

		const { fleetId, characterId } = state

		// Validate that we have required IDs
		if (!fleetId || !characterId || fleetId.trim() === '' || characterId.trim() === '') {
			logger.warn('[FleetMonitor] Alarm triggered but missing fleetId or characterId, stopping', {
				fleetId: fleetId || 'missing',
				characterId: characterId || 'missing',
			})
			return
		}

		// Schedule next alarm early to ensure it runs even if current execution times out
		// This prevents IoContext timeout issues in large fleets
		const nextAlarmPromise = this.scheduleNextAlarm()

		try {
			logger.info(`[FleetMonitor ${fleetId}] Fetching fleet status update`)

			// Get current fleet status
			const fleetStatus = await this.getFleetStatus()

			if (!fleetStatus) {
				logger.warn(`[FleetMonitor ${fleetId}] Failed to get fleet status, rescheduling`)
				await nextAlarmPromise
				return
			}

			// Track member history (joins/leaves)
			if (fleetStatus.members) {
				await this.trackMemberHistory(fleetId, fleetStatus.members)
			}

			// Update fleet cache in PostgreSQL (cross-instance data)
			await this.db
				.insert(fleetStateCache)
				.values({
					fleetId,
					fleetBossId: characterId,
					isActive: true,
					memberCount: fleetStatus.memberCount,
					motd: fleetStatus.fleetInfo.motd || null,
					isFreeMove: fleetStatus.fleetInfo.is_free_move,
					isRegistered: fleetStatus.fleetInfo.is_registered,
					isVoiceEnabled: fleetStatus.fleetInfo.is_voice_enabled,
					notFound: false,
					notFoundAt: null,
					endedAt: null,
					lastChecked: new Date(),
				})
				.onConflictDoUpdate({
					target: fleetStateCache.fleetId,
					set: {
						isActive: true,
						memberCount: fleetStatus.memberCount,
						motd: fleetStatus.fleetInfo.motd || null,
						isFreeMove: fleetStatus.fleetInfo.is_free_move,
						isRegistered: fleetStatus.fleetInfo.is_registered,
						isVoiceEnabled: fleetStatus.fleetInfo.is_voice_enabled,
						notFound: false,
						notFoundAt: null,
						endedAt: null,
						lastChecked: new Date(),
						updatedAt: new Date(),
					},
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
			await this.state.storage.sql.exec(
				`
			UPDATE monitor_state
			SET last_checked = ?
			WHERE id = 1
		`,
				now
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
			} catch (error) {
				// Ignore - table might already exist
			}
			this.state.storage.sql.exec(`DELETE FROM error_tracking WHERE error_type = '404'`)

			logger.info(`[FleetMonitor ${fleetId}] Fleet status updated successfully`, {
				fleetId,
				lastChecked: now,
			})

			// Ensure next alarm is scheduled (already scheduled early, but await to catch errors)
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

					// Mark fleet as not found in PostgreSQL cache
					const endedAt = new Date()

					// Archive fleet to summaries before updating cache
					await this.archiveFleetToSummary(fleetId, characterId, endedAt)

					await this.db
						.insert(fleetStateCache)
						.values({
							fleetId,
							fleetBossId: characterId,
							isActive: false,
							memberCount: 0,
							notFound: true,
							notFoundAt: endedAt,
							endedAt: endedAt,
							lastChecked: endedAt,
						})
						.onConflictDoUpdate({
							target: fleetStateCache.fleetId,
							set: {
								isActive: false,
								notFound: true,
								notFoundAt: endedAt,
								endedAt: endedAt,
								lastChecked: endedAt,
								updatedAt: endedAt,
							},
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
	 * Schedule the next alarm to run 30 seconds from now
	 * Only schedules if the monitor is properly initialized with valid IDs
	 */
	private async scheduleNextAlarm(): Promise<void> {
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

		const thirtySeconds = 30 * 1000 // 30 seconds in milliseconds
		const nextAlarmTime = Date.now() + thirtySeconds

		await this.state.storage.setAlarm(nextAlarmTime)

		logger.info(`[FleetMonitor ${state.fleetId}] Alarm scheduled`, {
			fleetId: state.fleetId,
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
		const url = new URL(request.url)

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
