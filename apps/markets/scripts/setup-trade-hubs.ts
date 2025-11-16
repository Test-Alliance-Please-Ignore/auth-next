/**
 * Setup script to initialize hourly market snapshots for major EVE Online trade hubs
 *
 * Run this script to start monitoring all major trade regions:
 * ```bash
 * bun run apps/markets/scripts/setup-trade-hubs.ts
 * ```
 */

import { getStub } from '@repo/do-utils'

import type { Markets } from '@repo/markets'

/**
 * Major EVE Online trade hub regions
 * These are the most active market regions in the game
 */
const TRADE_HUBS = [
	{
		regionId: '10000002',
		name: 'The Forge',
		primaryHub: 'Jita 4-4',
		description: 'Largest trade hub in EVE Online',
	},
	{
		regionId: '10000043',
		name: 'Domain',
		primaryHub: 'Amarr',
		description: 'Amarr Empire trade hub',
	},
	{
		regionId: '10000032',
		name: 'Sinq Laison',
		primaryHub: 'Dodixie',
		description: 'Gallente Federation trade hub',
	},
	{
		regionId: '10000042',
		name: 'Metropolis',
		primaryHub: 'Rens',
		description: 'Minmatar Republic trade hub',
	},
	{
		regionId: '10000030',
		name: 'Heimatar',
		primaryHub: 'Hek',
		description: 'Secondary Minmatar trade hub',
	},
] as const

/**
 * Setup hourly snapshots for all trade hubs
 */
async function setupTradeHubs(env: { MARKETS: DurableObjectNamespace }) {
	console.log('🚀 Setting up hourly market snapshots for major trade hubs...\n')

	const results = []

	for (const hub of TRADE_HUBS) {
		try {
			console.log(`📊 ${hub.name} (${hub.primaryHub})`)
			console.log(`   Region ID: ${hub.regionId}`)
			console.log(`   ${hub.description}`)

			// Get DO stub for this region
			console.log(`   [setup] Getting DO stub for region-${hub.regionId}`)
			const stub = getStub<Markets>(env.MARKETS, `region-${hub.regionId}`)
			console.log(`   [setup] DO stub acquired`)

			// Start hourly snapshots (returns immediately, snapshot happens in background)
			console.log(`   [setup] Calling startHourlySnapshots(${hub.regionId})`)
			await stub.startHourlySnapshots(hub.regionId)
			console.log(`   [setup] startHourlySnapshots completed (snapshot running in background)`)

			// Get status to confirm alarm is scheduled
			console.log(`   [setup] Checking alarm status`)
			const status = await stub.getAlarmStatus()
			console.log(`   [setup] Alarm status:`, status)

			if (status.isActive) {
				const nextSnapshot = new Date(status.nextAlarmTime!)
				console.log(
					`   ✅ Active - First snapshot in progress, next at: ${nextSnapshot.toISOString()}`
				)
				results.push({ ...hub, status: 'success', nextSnapshot })
			} else {
				console.log(`   ⚠️  Started but alarm not active`)
				results.push({ ...hub, status: 'warning' })
			}
		} catch (error) {
			console.error(`   ❌ Failed:`, error)
			console.error(`   Stack:`, error instanceof Error ? error.stack : 'No stack')
			results.push({
				...hub,
				status: 'error',
				error: error instanceof Error ? error.message : String(error),
			})
		}

		console.log('')
	}

	// Summary
	console.log('━'.repeat(60))
	console.log('📈 Summary:')
	const successful = results.filter((r) => r.status === 'success').length
	const failed = results.filter((r) => r.status === 'error').length
	console.log(`   ✅ Successfully configured: ${successful}/${TRADE_HUBS.length}`)
	if (failed > 0) {
		console.log(`   ❌ Failed: ${failed}/${TRADE_HUBS.length}`)
	}
	console.log('━'.repeat(60))

	return results
}

/**
 * Check status of all trade hub alarms
 */
async function checkTradeHubStatus(env: { MARKETS: DurableObjectNamespace }) {
	console.log('🔍 Checking status of all trade hub alarms...\n')

	for (const hub of TRADE_HUBS) {
		const stub = getStub<Markets>(env.MARKETS, `region-${hub.regionId}`)
		const status = await stub.getAlarmStatus()

		console.log(`📊 ${hub.name} (${hub.primaryHub})`)
		console.log(`   Region ID: ${hub.regionId}`)
		console.log(`   Active: ${status.isActive ? '✅ Yes' : '❌ No'}`)

		if (status.isActive && status.nextAlarmTime) {
			const nextSnapshot = new Date(status.nextAlarmTime)
			const timeUntil = nextSnapshot.getTime() - Date.now()
			const minutesUntil = Math.floor(timeUntil / 1000 / 60)
			console.log(`   Next snapshot: ${nextSnapshot.toISOString()} (in ${minutesUntil} minutes)`)
		}

		console.log('')
	}
}

/**
 * Stop all trade hub alarms
 */
async function stopAllTradeHubs(env: { MARKETS: DurableObjectNamespace }) {
	console.log('🛑 Stopping all trade hub alarms...\n')

	for (const hub of TRADE_HUBS) {
		try {
			const stub = getStub<Markets>(env.MARKETS, `region-${hub.regionId}`)
			await stub.stopHourlySnapshots(hub.regionId)
			console.log(`✅ ${hub.name} - Stopped`)
		} catch (error) {
			console.error(
				`❌ ${hub.name} - Failed: ${error instanceof Error ? error.message : String(error)}`
			)
		}
	}

	console.log('\n✅ All trade hub alarms stopped')
}

// Export for use as module
export { setupTradeHubs, checkTradeHubStatus, stopAllTradeHubs, TRADE_HUBS }

// CLI usage - only run if executed directly (Bun-specific)
// @ts-expect-error - import.meta.main is Bun-specific
if (import.meta.main) {
	console.log('This script requires environment bindings to run.')
	console.log('Please use one of these methods:\n')
	console.log('1. Via HTTP endpoint:')
	console.log('   curl -X POST https://your-worker.workers.dev/markets/setup\n')
	console.log('2. Via wrangler console:')
	console.log('   wrangler dev apps/markets')
	console.log('   Then call the setup endpoint\n')
	console.log('3. From another worker:')
	console.log('   import { setupTradeHubs } from "./scripts/setup-trade-hubs"')
	console.log('   await setupTradeHubs(env)')
}
