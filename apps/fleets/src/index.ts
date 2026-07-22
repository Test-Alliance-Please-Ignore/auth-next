import { Hono } from 'hono'

import { and, eq, isNotNull, lt } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger, withNotFound, withOnError, withWorkersLogger } from '@repo/hono-helpers'

import { createDb } from './db'
import { fleetCommanderAccessAnchors, fleetSummaries, fleetTrackingSessions } from './db/schema'
import { FleetsDO } from './durable-object'
import { FleetMonitorDO } from './fleet-monitor'

import type { FleetMonitor } from '@repo/fleets'
import type { App, Env } from './context'

const app = new Hono<App>()
	.use(
		'*',
		(c, next) =>
			withWorkersLogger(c.env.NAME, {
				environment: c.env.ENVIRONMENT,
				release: c.env.SENTRY_RELEASE,
			})(c, next)
	)
	.onError(withOnError())
	.notFound(withNotFound())
	.get('/', async (c) => {
		return c.text('Fleets Durable Object Worker')
	})
	.get('/fleet-monitor/:fleetId/ws', async (c) => {
		const fleetId = c.req.param('fleetId')

		if (!fleetId || fleetId.trim() === '') {
			return c.json(
				{
					error: 'fleetId parameter is required',
				},
				400
			)
		}

		const fleetMonitorStub = getStub<FleetMonitor>(c.env.FLEET_MONITOR, `fleet-${fleetId}`)
		if (!fleetMonitorStub.fetch) {
			return c.json(
				{
					error: 'Fleet monitor endpoint unavailable',
				},
				500
			)
		}

		return fleetMonitorStub.fetch(c.req.raw)
	})
	.get('/fleet-monitor/:fleetId/status', async (c) => {
		const fleetId = c.req.param('fleetId')

		if (!fleetId || fleetId.trim() === '') {
			return c.json(
				{
					error: 'fleetId parameter is required',
				},
				400
			)
		}

		try {
			const fleetMonitorStub = getStub<FleetMonitor>(c.env.FLEET_MONITOR, `fleet-${fleetId}`)
			if (!fleetMonitorStub.fetch) {
				return c.json(
					{
						error: 'Fleet monitor endpoint unavailable',
					},
					500
				)
			}

			return fleetMonitorStub.fetch(c.req.raw)
		} catch (error) {
			return c.json(
				{
					error: 'Failed to get fleet status',
					message: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

export async function sweepStaleFleetMonitors(
	env: Env
): Promise<{ scanned: number; terminated: number }> {
	const db = createDb(env.DATABASE_URL)
	const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000)

	const activeRows = await db
		.selectDistinct({
			fleetId: fleetTrackingSessions.fleetId,
		})
		.from(fleetTrackingSessions)
		.where(and(isNotNull(fleetTrackingSessions.fleetId), eq(fleetTrackingSessions.status, 'active')))

	const activeFleetIds = new Set(
		activeRows
			.map((row) => row.fleetId)
			.filter((fleetId): fleetId is string => fleetId !== null)
	)

	const endedRows = await db
		.selectDistinct({
			fleetId: fleetTrackingSessions.fleetId,
		})
		.from(fleetTrackingSessions)
		.where(
			and(
				isNotNull(fleetTrackingSessions.fleetId),
				eq(fleetTrackingSessions.status, 'ended'),
				isNotNull(fleetTrackingSessions.endedAt),
				lt(fleetTrackingSessions.endedAt, cutoff)
			)
		)

	const commanderAnchorRows = await db
		.selectDistinct({
			fleetId: fleetCommanderAccessAnchors.fleetId,
		})
		.from(fleetCommanderAccessAnchors)
		.where(isNotNull(fleetCommanderAccessAnchors.fleetId))

	const summaryRows = await db
		.selectDistinct({
			fleetId: fleetSummaries.fleetId,
		})
		.from(fleetSummaries)
		.where(isNotNull(fleetSummaries.fleetId))

	const candidateFleetIds = new Set<string>()
	for (const row of [...endedRows, ...commanderAnchorRows, ...summaryRows]) {
		if (row.fleetId) candidateFleetIds.add(row.fleetId)
	}

	const staleFleetIds = Array.from(candidateFleetIds).filter((fleetId) => !activeFleetIds.has(fleetId))

	let terminated = 0
	for (const fleetId of staleFleetIds) {
		try {
			const monitorStub = getStub<FleetMonitor>(env.FLEET_MONITOR, `fleet-${fleetId}`)
			const state = await monitorStub.getMonitorState()
			if (!state) continue

			await monitorStub.terminate()
			terminated += 1
		} catch (error) {
			logger.warn('[Fleets:Scheduled] Failed to sweep FleetMonitor', {
				fleetId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	return {
		scanned: staleFleetIds.length,
		terminated,
	}
}

export default {
	fetch: app.fetch.bind(app),
	async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
		if (event.cron !== '0 */6 * * *') {
			return
		}

		const result = await sweepStaleFleetMonitors(env)
		if (result.scanned > 0 || result.terminated > 0) {
			logger.info('[Fleets:Scheduled] Swept stale fleet monitors', result)
		}
	},
}

export { FleetsDO as Fleets }
export { FleetMonitorDO as FleetMonitor }
