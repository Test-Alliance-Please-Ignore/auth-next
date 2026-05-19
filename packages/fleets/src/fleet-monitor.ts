import type { DurableObject } from 'cloudflare:workers'
import { EsiGetFleetInformation, EsiGetFleetMembers } from './esi'

/**
 * Fleet details response
 * Returned by FleetMonitor.getFleetStatus() and Fleets.getFleetDetails()
 */
export interface FleetDetailsResponse {
	fleetInfo: EsiGetFleetInformation
	members?: EsiGetFleetMembers
	fleetBossName?: string
	memberCount: number
}

/**
 * Raw SQLite row structure for monitor_state table
 * Represents the data as stored in SQLite (snake_case, number for boolean)
 */
export interface FleetMonitorStateRow extends Record<string, string | number | null> {
	fleet_id: string
	character_id: string
	tracking_session_id: string | null
	is_initialized: number
	last_checked: string | null
	peak_member_count: number
}

/**
 * FleetMonitor instance state
 * Stored in SQLite-backed state for each FleetMonitor Durable Object instance
 */
export interface FleetMonitorState {
	fleetId: string
	characterId: string
	trackingSessionId: string | null
	isInitialized: boolean
	lastChecked: string | null
	peakMemberCount: number
}

/**
 * Public RPC interface for FleetMonitor Durable Object
 *
 * This interface defines the RPC methods available on FleetMonitor instances.
 * Each FleetMonitor DO is created per-fleet (id: `fleet-${fleetId}`) and provides
 * real-time fleet status monitoring with periodic updates every 30 seconds.
 *
 * @example
 * ```ts
 * import type { FleetMonitor } from '@repo/fleets'
 * import { getStub } from '@repo/do-utils'
 *
 * const stub = getStub<FleetMonitor>(env.FLEET_MONITOR, 'fleet-12345')
 * await stub.initializeMonitoring('12345', '67890')
 * const status = await stub.getFleetStatus()
 * ```
 */
export interface FleetMonitor extends DurableObject {
	/**
	 * Initialize fleet monitoring for a specific fleet
	 * @param fleetId - ESI fleet ID
	 * @param characterId - Character ID of the fleet boss (for ESI access)
	 * @param trackingSessionId - ID of the fleet_tracking_sessions row driving this monitor
	 * @param force - If true, force re-initialization even if already initialized
	 */
	initializeMonitoring(
		fleetId: string,
		characterId: string,
		trackingSessionId: string,
		force?: boolean
	): Promise<void>

	/**
	 * Get current fleet status
	 * @returns Current fleet details including members and status, or null if not initialized
	 */
	getFleetStatus(): Promise<FleetDetailsResponse | null>

	/**
	 * Get monitor state (for watchdog checks)
	 * @returns Monitor state including lastChecked timestamp, or null if not initialized
	 */
	getMonitorState(): Promise<FleetMonitorState | null>

	/**
	 * Explicitly end the tracking session.
	 * Closes all open ship-event rows, updates the session row with end timestamp/reason,
	 * archives a fleet_summaries entry, and terminates the DO.
	 */
	endSession(args: {
		sessionId: string
		endedReason: 'user_stopped' | 'admin_stopped' | 'fleet_disbanded' | 'esi_error' | 'token_expired'
		endedByUserId: string | null
	}): Promise<void>

	/**
	 * Delete all storage and terminate the Durable Object
	 * This signals to Cloudflare that the DO can be garbage collected
	 * @returns Promise that resolves when cleanup is complete
	 */
	terminate(): Promise<void>
}
