import { getStub } from '@repo/do-utils'
import { EveCharacterId } from '@repo/eve-types'
import { logger } from '@repo/hono-helpers'

import type { FleetMonitor, Fleets } from '@repo/fleets'
import type { Env } from './context'

/**
 * Scheduled handler for fleet commander monitoring
 *
 * This handler runs on a scheduled cron trigger (every 5 minutes) and:
 * 1. Queries the main FleetsDO for list of monitored fleet commanders
 * 2. For each commander, checks if they are in a fleet
 * 3. If commander is in a fleet and is the fleet boss, creates/initializes FleetMonitor DO instance
 * 4. Handles errors gracefully and logs results
 */
export async function scheduledHandler(
	event: ScheduledEvent,
	env: Env,
	_ctx: ExecutionContext
): Promise<void> {
	const start = Date.now()
	logger.info('[FleetMonitoring] Starting scheduled fleet commander check', {
		scheduledTime: new Date(event.scheduledTime).toISOString(),
		cron: event.cron,
	})

	try {
		// Get the main FleetsDO instance
		using fleetsStub = getStub<Fleets>(env.FLEETS, 'default')

		// Get list of monitored fleet commanders from database
		const monitoredCommanders = await fleetsStub.listMonitoredFleetCommanders()

		logger.info('[FleetMonitoring] Found monitored fleet commanders', {
			count: monitoredCommanders.length,
			characterIds: monitoredCommanders,
		})

		if (monitoredCommanders.length === 0) {
			logger.info('[FleetMonitoring] No fleet commanders to monitor, exiting')
			return
		}

		// Check each commander's fleet status
		const results = await Promise.allSettled(
			monitoredCommanders.map((characterId) => checkCommanderFleetStatus(env, characterId))
		)

		// Count successes and failures
		const succeeded = results.filter((r) => r.status === 'fulfilled').length
		const failed = results.filter((r) => r.status === 'rejected').length

		const duration = Date.now() - start

		logger.info('[FleetMonitoring] Scheduled check completed', {
			totalCommanders: monitoredCommanders.length,
			succeeded,
			failed,
			durationMs: duration,
		})

		// Log failed commanders for debugging
		if (failed > 0) {
			const failedCommanders = results
				.map((result, index) =>
					result.status === 'rejected'
						? { characterId: monitoredCommanders[index], error: result.reason }
						: null
				)
				.filter((c) => c !== null)

			logger.error('[FleetMonitoring] Some commander checks failed', {
				failed,
				errors: failedCommanders.map((c) => ({
					characterId: c.characterId,
					error: c.error instanceof Error ? c.error.message : String(c.error),
				})),
			})
		}
	} catch (error) {
		logger.error('[FleetMonitoring] Unexpected error during scheduled check', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		throw error
	}
}

/**
 * Check a fleet commander's fleet status and initialize monitoring if needed
 *
 * @param env - Environment bindings
 * @param characterId - EVE character ID of the fleet commander
 */
async function checkCommanderFleetStatus(env: Env, characterId: string): Promise<void> {
	try {
		logger.info('[FleetMonitoring] Checking fleet status for commander', {
			characterId,
		})

		// Get the main FleetsDO instance
		using fleetsStub = getStub<Fleets>(env.FLEETS, 'default')

		// Get character's fleet information
		const fleetInfo = await fleetsStub.getCharacterFleetInformation(characterId as EveCharacterId)

		// Check if character is in a fleet (fleet_id !== '0' means in fleet)
		const isInFleet = fleetInfo.fleet_id !== '0'

		// Check if character is the fleet boss
		const isFleetBoss = fleetInfo.fleet_boss_id === characterId

		logger.info('[FleetMonitoring] Fleet status check result', {
			characterId,
			isInFleet,
			isFleetBoss,
			fleetId: fleetInfo.fleet_id,
			fleetBossId: fleetInfo.fleet_boss_id,
		})

		// Only create FleetMonitor if commander is in a fleet AND is the fleet boss
		if (isInFleet && isFleetBoss) {
			const fleetId = fleetInfo.fleet_id

			logger.info('[FleetMonitoring] Commander is fleet boss, initializing FleetMonitor', {
				characterId,
				fleetId,
			})

			// Create/get FleetMonitor DO instance using id 'fleet-${fleetId}'
			using fleetMonitorStub = getStub<FleetMonitor>(env.FLEET_MONITOR, `fleet-${fleetId}`)

			// Initialize monitoring for this fleet
			await fleetMonitorStub.initializeMonitoring(fleetId, characterId)

			logger.info('[FleetMonitoring] FleetMonitor initialized successfully', {
				characterId,
				fleetId,
			})
		} else {
			logger.info('[FleetMonitoring] Commander not in fleet or not fleet boss, skipping', {
				characterId,
				isInFleet,
				isFleetBoss,
			})
		}
	} catch (error) {
		logger.error('[FleetMonitoring] Failed to check commander fleet status', {
			characterId,
			error: error instanceof Error ? error.message : String(error),
		})
		throw error
	}
}
