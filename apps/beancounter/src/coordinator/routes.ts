import { getStub } from '@repo/do-utils'

import type { StructureCoordinator } from '@repo/beancounter'
import type { Hono } from 'hono'
import type { App } from '../context'

export function registerCoordinatorRoutes(app: Hono<App>): void {
	app
		.get('/coordinator/scan', async (c) => {
			try {
				const coordinatorStub = getStub<StructureCoordinator>(c.env.STRUCTURE_COORDINATOR, 'default')
				await coordinatorStub.scanCorporations()
				return c.json({ success: true })
			} catch (error) {
				c.status(500)
				return c.json({
					success: false,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		})

		.post('/coordinator/corporations/:corporationId/sync', async (c) => {
			const corporationId = c.req.param('corporationId')

			if (!corporationId) {
				return c.json({ success: false, error: 'corporationId is required' }, 400)
			}

			try {
				const coordinatorStub = getStub<StructureCoordinator>(c.env.STRUCTURE_COORDINATOR, 'default')
				await coordinatorStub.syncStructuresForCorp(corporationId)
				return c.json({ success: true })
			} catch (error) {
				c.status(500)
				return c.json({
					success: false,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		})

		.post('/coordinator/structures/:structureId/ensure', async (c) => {
			const structureId = c.req.param('structureId')
			const corporationId = c.req.query('corporationId')

			if (!structureId) {
				return c.json({ success: false, error: 'structureId is required' }, 400)
			}

			if (!corporationId) {
				return c.json({ success: false, error: 'corporationId query parameter is required' }, 400)
			}

			try {
				const coordinatorStub = getStub<StructureCoordinator>(c.env.STRUCTURE_COORDINATOR, 'default')
				await coordinatorStub.ensureMonitor(corporationId, structureId)
				return c.json({ success: true })
			} catch (error) {
				c.status(500)
				return c.json({
					success: false,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		})
}
