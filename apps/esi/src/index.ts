import { Hono } from 'hono'

import { getEsiInstanceForCorporation } from '@repo/esi'
import { withNotFound, withOnError, withWorkersLogger } from '@repo/hono-helpers'

import { EsiDO } from './durable-object'
import { EsiTypeResolverDO } from './durable-object-id-resolver'

import type { App } from './context'

const app = new Hono<App>()
	.use('*', (c, next) =>
		withWorkersLogger(c.env.NAME, {
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
		const stub = getEsiInstanceForCorporation(c.env.ESI, corporationId)

		try {
			const members = await stub.fetchCorporationMembers(corporationId)
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
		const stub = getEsiInstanceForCorporation(c.env.ESI, corporationId)

		try {
			const memberTracking = await stub.fetchCorporationMemberTracking(corporationId)
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
		const stub = getEsiInstanceForCorporation(c.env.ESI, corporationId)

		try {
			const wallets = await stub.fetchCorporationWallets(corporationId)
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

		const stub = getEsiInstanceForCorporation(c.env.ESI, corporationId)

		try {
			const journal = await stub.fetchCorporationWalletJournal(corporationId, division)
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

		const stub = getEsiInstanceForCorporation(c.env.ESI, corporationId)

		try {
			const transactions = await stub.fetchCorporationWalletTransactions(corporationId, division)
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
		const stub = getEsiInstanceForCorporation(c.env.ESI, corporationId)

		try {
			const assets = await stub.fetchCorporationAssets(corporationId)
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
		const stub = getEsiInstanceForCorporation(c.env.ESI, corporationId)

		try {
			const structures = await stub.fetchCorporationStructures(corporationId)
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
		const stub = getEsiInstanceForCorporation(c.env.ESI, corporationId)

		try {
			const orders = await stub.fetchCorporationOrders(corporationId)
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
		const stub = getEsiInstanceForCorporation(c.env.ESI, corporationId)

		try {
			const contracts = await stub.fetchCorporationContracts(corporationId)
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
		const stub = getEsiInstanceForCorporation(c.env.ESI, corporationId)

		try {
			const jobs = await stub.fetchCorporationIndustryJobs(corporationId)
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
		const stub = getEsiInstanceForCorporation(c.env.ESI, corporationId)

		try {
			const killmails = await stub.fetchCorporationKillmails(corporationId)
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
export { EsiTypeResolverDO as EsiTypeResolver }
