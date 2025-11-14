import { DurableObject } from 'cloudflare:workers'

import { createDbClient, createDbClientWs } from '@repo/db-utils'
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
import { fleetStateCache, schema } from './db/schema'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'

/**
 * FleetMonitor Durable Object
 *
 * This Durable Object is created per-fleet (id: `fleet-${fleetId}`) and implements:
 * - RPC methods for fleet status queries
 * - Alarm handler for periodic fleet status updates (every 20 seconds)
 * - WebSocket hibernation API for real-time updates
 * - SQLite-backed state for instance-specific data (fleetId, characterId)
 * - PostgreSQL for cross-instance data (fleetStateCache)
 */
export class FleetMonitorDO extends DurableObject {
	private db: ReturnType<typeof createDbClientWs<typeof schema>>

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
		const targetVersion = 1 // Current schema version

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

		logger.info('[FleetMonitor] Schema migrations completed', {
			finalVersion: targetVersion,
		})
	}

	/**
	 * Initialize fleet monitoring for a specific fleet
	 * @param fleetId - ESI fleet ID
	 * @param characterId - Character ID of the fleet boss (for ESI access)
	 */
	async initializeMonitoring(fleetId: string, characterId: string): Promise<void> {
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
			[fleetId, characterId, now]
		)

		// Schedule first alarm for 20 seconds from now
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
			using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

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
			using characterStub = getStub<EveCharacterData>(this.env.EVE_CHARACTER_DATA, characterId)
			const characterInfo = await characterStub.getCharacterInfo(characterId)

			return {
				fleetInfo,
				members,
				fleetBossName: characterInfo?.name,
				memberCount,
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
	 * Alarm handler - triggered every 20 seconds to update fleet status
	 * Automatically reschedules itself for the next 20 seconds
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

		try {
			logger.info(`[FleetMonitor ${fleetId}] Fetching fleet status update`)

			// Get current fleet status
			const fleetStatus = await this.getFleetStatus()

			if (!fleetStatus) {
				logger.warn(`[FleetMonitor ${fleetId}] Failed to get fleet status, rescheduling`)
				await this.scheduleNextAlarm()
				return
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
				[now]
			)

			logger.info(`[FleetMonitor ${fleetId}] Fleet status updated successfully`, {
				fleetId,
				lastChecked: now,
			})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			// Check if fleet no longer exists (404)
			if (
				errorMessage.includes('404') ||
				errorMessage.includes('Not found') ||
				errorMessage.includes('Not Found')
			) {
				logger.info(`[FleetMonitor ${fleetId}] Fleet no longer exists, stopping monitoring`, {
					fleetId,
				})

				// Mark fleet as not found in PostgreSQL cache
				await this.db
					.insert(fleetStateCache)
					.values({
						fleetId,
						fleetBossId: characterId,
						isActive: false,
						memberCount: 0,
						notFound: true,
						notFoundAt: new Date(),
						lastChecked: new Date(),
					})
					.onConflictDoUpdate({
						target: fleetStateCache.fleetId,
						set: {
							isActive: false,
							notFound: true,
							notFoundAt: new Date(),
							lastChecked: new Date(),
							updatedAt: new Date(),
						},
					})

				// Don't reschedule alarm - fleet is gone
				return
			}

			logger.error(`[FleetMonitor ${fleetId}] Error in alarm handler`, {
				fleetId,
				error: error instanceof Error ? error.message : String(error),
			})
			// Still reschedule even on error to keep trying
		} finally {
			// Reschedule alarm for 20 seconds from now
			await this.scheduleNextAlarm()
		}
	}

	/**
	 * Schedule the next alarm to run 20 seconds from now
	 */
	private async scheduleNextAlarm(): Promise<void> {
		const twentySeconds = 20 * 1000 // 20 seconds in milliseconds
		const nextAlarmTime = Date.now() + twentySeconds

		await this.state.storage.setAlarm(nextAlarmTime)

		// Get fleetId for logging
		const state = await this.getState()
		const fleetId = state?.fleetId || 'unknown'
		logger.info(`[FleetMonitor ${fleetId}] Alarm scheduled`, {
			fleetId,
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

				case 'subscribe':
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
