import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
import { withNotFound, withOnError } from '@repo/hono-helpers'

import { EsiDO } from './durable-object'

import type { Esi } from '@repo/esi'
import type { App } from './context'

const app = new Hono<App>()
	.use(
		'*',
		// middleware
		(c, next) =>
			useWorkersLogger(c.env.NAME, {
				environment: c.env.ENVIRONMENT,
				release: c.env.SENTRY_RELEASE,
			})(c, next)
	)

	.onError(withOnError())
	.notFound(withNotFound())

	.get('/', async (c) => {
		return c.text('Esi Durable Object Worker')
	})

	// Test endpoints for querying ESI data
	.get('/test/members/:corporationId', async (c) => {
		const corporationId = c.req.param('corporationId')
		const stub = getStub<Esi>(c.env.ESI, 'default')

		try {
			const members = await stub.fetchMembers(corporationId)
			return c.json({ corporationId, members })
		} catch (error) {
			return c.json(
				{
					error: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

	.get('/test/member-tracking/:corporationId', async (c) => {
		const corporationId = c.req.param('corporationId')
		const stub = getStub<Esi>(c.env.ESI, 'default')

		try {
			const memberTracking = await stub.fetchMemberTracking(corporationId)
			return c.json({ corporationId, memberTracking })
		} catch (error) {
			return c.json(
				{
					error: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

	.get('/test/wallets/:corporationId', async (c) => {
		const corporationId = c.req.param('corporationId')
		const stub = getStub<Esi>(c.env.ESI, 'default')

		try {
			const wallets = await stub.fetchWallets(corporationId)
			return c.json({ corporationId, wallets })
		} catch (error) {
			return c.json(
				{
					error: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

	.get('/test/wallet-journal/:corporationId/:division', async (c) => {
		const corporationId = c.req.param('corporationId')
		const division = parseInt(c.req.param('division'), 10)

		if (isNaN(division)) {
			return c.json({ error: 'Invalid division parameter' }, 400)
		}

		const stub = getStub<Esi>(c.env.ESI, 'default')

		try {
			const journal = await stub.fetchWalletJournal(corporationId, division)
			return c.json({ corporationId, division, journal })
		} catch (error) {
			return c.json(
				{
					error: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

	.get('/test/wallet-transactions/:corporationId/:division', async (c) => {
		const corporationId = c.req.param('corporationId')
		const division = parseInt(c.req.param('division'), 10)

		if (isNaN(division)) {
			return c.json({ error: 'Invalid division parameter' }, 400)
		}

		const stub = getStub<Esi>(c.env.ESI, 'default')

		try {
			const transactions = await stub.fetchWalletTransactions(corporationId, division)
			return c.json({ corporationId, division, transactions })
		} catch (error) {
			return c.json(
				{
					error: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

	.get('/test/assets/:corporationId', async (c) => {
		const corporationId = c.req.param('corporationId')
		const stub = getStub<Esi>(c.env.ESI, 'default')

		try {
			const assets = await stub.fetchAssets(corporationId)
			return c.json({ corporationId, assets })
		} catch (error) {
			return c.json(
				{
					error: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

	.get('/test/structures/:corporationId', async (c) => {
		const corporationId = c.req.param('corporationId')
		const stub = getStub<Esi>(c.env.ESI, 'default')

		try {
			const structures = await stub.fetchStructures(corporationId)
			return c.json({ corporationId, structures })
		} catch (error) {
			return c.json(
				{
					error: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

	.get('/test/orders/:corporationId', async (c) => {
		const corporationId = c.req.param('corporationId')
		const stub = getStub<Esi>(c.env.ESI, 'default')

		try {
			const orders = await stub.fetchOrders(corporationId)
			return c.json({ corporationId, orders })
		} catch (error) {
			return c.json(
				{
					error: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

	.get('/test/contracts/:corporationId', async (c) => {
		const corporationId = c.req.param('corporationId')
		const stub = getStub<Esi>(c.env.ESI, 'default')

		try {
			const contracts = await stub.fetchContracts(corporationId)
			return c.json({ corporationId, contracts })
		} catch (error) {
			return c.json(
				{
					error: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

	.get('/test/industry-jobs/:corporationId', async (c) => {
		const corporationId = c.req.param('corporationId')
		const stub = getStub<Esi>(c.env.ESI, 'default')

		try {
			const jobs = await stub.fetchIndustryJobs(corporationId)
			return c.json({ corporationId, jobs })
		} catch (error) {
			return c.json(
				{
					error: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

	.get('/test/killmails/:corporationId', async (c) => {
		const corporationId = c.req.param('corporationId')
		const stub = getStub<Esi>(c.env.ESI, 'default')

		try {
			const killmails = await stub.fetchKillmails(corporationId)
			return c.json({ corporationId, killmails })
		} catch (error) {
			return c.json(
				{
					error: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

export default app

// Export the Durable Object class
export { EsiDO as Esi }
