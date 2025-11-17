import { createDb } from '../common/db'
import { StructureMonitorRepository } from './repository'
import { StructureCoordinator } from './structure-coordinator'

import type { Context, Hono } from 'hono'
import type { BeancounterDb } from '../common/db'
import type { App } from '../context'

type AppContext = Context<App>

export function registerCoordinatorRoutes(app: Hono<App>): void {
	app
		.get('/coordinator/scan', async (c) => {
			try {
				const coordinator = await createCoordinator(c)
				await coordinator.scanCorporations()
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
				const coordinator = await createCoordinator(c)
				await coordinator.syncStructuresForCorp(corporationId)
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

			if (!structureId) {
				return c.json({ success: false, error: 'structureId is required' }, 400)
			}

			try {
				const coordinator = await createCoordinator(c)
				await coordinator.ensureMonitor(structureId)
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

async function getDb(c: AppContext): Promise<BeancounterDb> {
	let db = c.get('db')

	if (!db) {
		db = createDb(c.env.DATABASE_URL)
		c.set('db', db)
	}

	return db
}

async function createCoordinator(c: AppContext): Promise<StructureCoordinator> {
	const db = await getDb(c)
	const repository = new StructureMonitorRepository(db)

	return new StructureCoordinator({
		repository,
		eveCorporationDataNamespace: c.env.EVE_CORPORATION_DATA,
		structureMonitorNamespace: c.env.STRUCTURE_MONITOR,
		logger: console,
	})
}
