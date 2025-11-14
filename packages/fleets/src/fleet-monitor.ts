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
	is_initialized: number
	last_checked: string | null
}

/**
 * FleetMonitor instance state
 * Stored in SQLite-backed state for each FleetMonitor Durable Object instance
 */
export interface FleetMonitorState {
	fleetId: string
	characterId: string
	isInitialized: boolean
	lastChecked: string | null
}

/**
 * Public RPC interface for FleetMonitor Durable Object
 *
 * This interface defines the RPC methods available on FleetMonitor instances.
 * Each FleetMonitor DO is created per-fleet (id: `fleet-${fleetId}`) and provides
 * real-time fleet status monitoring with periodic updates every 20 seconds.
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
	 */
	initializeMonitoring(fleetId: string, characterId: string): Promise<void>

	/**
	 * Get current fleet status
	 * @returns Current fleet details including members and status, or null if not initialized
	 */
	getFleetStatus(): Promise<FleetDetailsResponse | null>
}
