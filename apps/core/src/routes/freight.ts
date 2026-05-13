/**
 * Freight routes - Administrative operations for managing freight routes
 *
 * All endpoints require authentication and admin privileges.
 * These endpoints call the Freight Durable Object via RPC.
 */

import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { TimeCache, logger } from '@repo/hono-helpers'

import { getCachedUserPermissions } from '../lib/groups-cache'
import { requireAllianceMember, requireAuth } from '../middleware/session'

import type { EsiTypeResolver } from '@repo/esi'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Freight } from '@repo/freight'
import type { App } from '../context'

const FREIGHT_MANAGER_URN = 'urn:freight:manager'
const MS_PER_DAY = 86_400_000

/**
 * Hardcoded TEST Alliance Please Ignore alliance ID
 */
const ALLIANCE_ID = '498125261'

/**
 * Permission check cache - 15 second TTL
 */
const permissionCache = new TimeCache<boolean>(15000)

/**
 * Check if a user has the freight manager permission
 */
async function isFreightManager(
	env: { GROUPS: DurableObjectNamespace },
	userId: string,
	isAdmin: boolean
): Promise<boolean> {
	if (isAdmin) return true

	const cacheKey = `${userId}:${FREIGHT_MANAGER_URN}`
	return permissionCache.getOrSet(cacheKey, async () => {
		const permissions = await getCachedUserPermissions(env, userId)
		return permissions.some((p) => p.urn === FREIGHT_MANAGER_URN)
	})
}

const app = new Hono<App>()

/**
 * GET /freight/routes/active
 * List active freight routes (available to all authenticated users)
 */
app.get('/routes/active', requireAuth(), async (c) => {
	try {
		const stub = getStub<Freight>(c.env.FREIGHT, 'default')
		const routes = await stub.listRoutes({ status: 'active' })

		return c.json(routes)
	} catch (error) {
		logger.error('Error listing active freight routes:', { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined })
		return c.json({ error: 'Failed to list freight routes' }, 500)
	}
})

/**
 * GET /freight/routes
 * List all freight routes with optional status filter (requires freight:manager permission)
 */
app.get('/routes', requireAuth(), async (c) => {
	const user = c.get('user')!
	if (!(await isFreightManager(c.env, user.id, user.is_admin))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const status = c.req.query('status')

		const stub = getStub<Freight>(c.env.FREIGHT, 'default')
		const routes = await stub.listRoutes({
			status: status as any,
		})

		return c.json(routes)
	} catch (error) {
		logger.error('Error listing freight routes:', { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined })
		return c.json({ error: 'Failed to list freight routes' }, 500)
	}
})

/**
 * Validate optional freight route fields (used for both create and update)
 * Returns an error message string if invalid, or null if valid
 */
function validateFreightRouteOptionalFields(data: Record<string, unknown>): string | null {
	if (data.maxVolume !== undefined && data.maxVolume !== null) {
		const maxVol = typeof data.maxVolume === 'string' ? parseFloat(data.maxVolume) : Number(data.maxVolume)
		if (isNaN(maxVol) || maxVol <= 0) {
			return 'maxVolume must be a positive number'
		}
	}
	if (data.collateralFeeRate !== undefined && data.collateralFeeRate !== null) {
		const rate = typeof data.collateralFeeRate === 'string' ? parseFloat(data.collateralFeeRate) : Number(data.collateralFeeRate)
		if (isNaN(rate) || rate < 0 || rate > 1) {
			return 'collateralFeeRate must be a decimal between 0 and 1'
		}
	}
	if (data.expiration !== undefined && data.expiration !== null) {
		const exp = Number(data.expiration)
		if (!Number.isInteger(exp) || exp < 1) {
			return 'expiration must be a positive integer'
		}
	}
	if (data.daysToComplete !== undefined && data.daysToComplete !== null) {
		const days = Number(data.daysToComplete)
		if (!Number.isInteger(days) || days < 1) {
			return 'daysToComplete must be a positive integer'
		}
	}
	return null
}

/**
 * Validate fields for update (all required fields are optional, only validate if present)
 */
function validateFreightRouteUpdateFields(data: Record<string, unknown>): string | null {
	if (data.pickupName !== undefined && (typeof data.pickupName !== 'string' || !data.pickupName.trim())) {
		return 'pickupName must be a non-empty string'
	}
	if (data.destinationName !== undefined && (typeof data.destinationName !== 'string' || !data.destinationName.trim())) {
		return 'destinationName must be a non-empty string'
	}
	if (data.iskPerVolumeUnit !== undefined) {
		if (typeof data.iskPerVolumeUnit !== 'string' || !data.iskPerVolumeUnit.trim()) {
			return 'iskPerVolumeUnit must be a non-empty string'
		}
		const iskRate = parseFloat(data.iskPerVolumeUnit as string)
		if (isNaN(iskRate) || iskRate <= 0) {
			return 'iskPerVolumeUnit must be a positive number'
		}
	}
	return validateFreightRouteOptionalFields(data)
}

/**
 * Validate common freight route fields for create
 * Returns an error message string if invalid, or null if valid
 */
function validateFreightRouteFields(data: Record<string, unknown>): string | null {
	if (typeof data.pickupName !== 'string' || !data.pickupName.trim()) {
		return 'pickupName must be a non-empty string'
	}
	if (typeof data.destinationName !== 'string' || !data.destinationName.trim()) {
		return 'destinationName must be a non-empty string'
	}
	if (typeof data.iskPerVolumeUnit !== 'string' || !data.iskPerVolumeUnit.trim()) {
		return 'iskPerVolumeUnit must be a non-empty string'
	}
	const iskRate = parseFloat(data.iskPerVolumeUnit as string)
	if (isNaN(iskRate) || iskRate <= 0) {
		return 'iskPerVolumeUnit must be a positive number'
	}
	return validateFreightRouteOptionalFields(data)
}

/**
 * POST /freight/routes
 * Create a new freight route (requires freight:manager permission)
 */
app.post('/routes', requireAuth(), async (c) => {
	const user = c.get('user')!
	if (!(await isFreightManager(c.env, user.id, user.is_admin))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const data = await c.req.json()

		const validationError = validateFreightRouteFields(data)
		if (validationError) {
			return c.json({ error: validationError }, 400)
		}

		const stub = getStub<Freight>(c.env.FREIGHT, 'default')
		const route = await stub.createRoute(user.id, data)

		return c.json(route, 201)
	} catch (error) {
		logger.error('Error creating freight route:', error)
		return c.json({ error: 'Failed to create freight route' }, 500)
	}
})

/**
 * GET /freight/routes/:routeId
 * Get a specific freight route (requires freight:manager permission)
 */
app.get('/routes/:routeId', requireAuth(), async (c) => {
	const user = c.get('user')!
	const routeId = c.req.param('routeId')

	if (!(await isFreightManager(c.env, user.id, user.is_admin))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<Freight>(c.env.FREIGHT, 'default')
		const route = await stub.getRoute(routeId)

		if (!route) {
			return c.json({ error: 'Route not found' }, 404)
		}

		return c.json(route)
	} catch (error) {
		logger.error('Error getting freight route:', error)
		return c.json({ error: 'Failed to get freight route' }, 500)
	}
})

/**
 * PUT /freight/routes/:routeId
 * Update an existing freight route (requires freight:manager permission)
 */
app.put('/routes/:routeId', requireAuth(), async (c) => {
	const user = c.get('user')!
	const routeId = c.req.param('routeId')

	if (!(await isFreightManager(c.env, user.id, user.is_admin))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const data = await c.req.json()

		const validationError = validateFreightRouteUpdateFields(data)
		if (validationError) {
			return c.json({ error: validationError }, 400)
		}

		const stub = getStub<Freight>(c.env.FREIGHT, 'default')
		const route = await stub.updateRoute(user.id, routeId, data)

		return c.json(route)
	} catch (error) {
		logger.error('Error updating freight route:', error)

		if (error instanceof Error && error.message === 'Route not found') {
			return c.json({ error: 'Route not found' }, 404)
		}

		return c.json({ error: 'Failed to update freight route' }, 500)
	}
})

/**
 * POST /freight/routes/:routeId/activate
 * Activate a freight route (requires freight:manager permission)
 */
app.post('/routes/:routeId/activate', requireAuth(), async (c) => {
	const user = c.get('user')!
	const routeId = c.req.param('routeId')

	if (!(await isFreightManager(c.env, user.id, user.is_admin))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<Freight>(c.env.FREIGHT, 'default')
		const route = await stub.activateRoute(user.id, routeId)

		return c.json(route)
	} catch (error) {
		logger.error('Error activating freight route:', error)

		if (error instanceof Error && error.message === 'Route not found') {
			return c.json({ error: 'Route not found' }, 404)
		}

		return c.json({ error: 'Failed to activate freight route' }, 500)
	}
})

/**
 * POST /freight/routes/:routeId/deactivate
 * Deactivate a freight route (requires freight:manager permission)
 */
app.post('/routes/:routeId/deactivate', requireAuth(), async (c) => {
	const user = c.get('user')!
	const routeId = c.req.param('routeId')

	if (!(await isFreightManager(c.env, user.id, user.is_admin))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<Freight>(c.env.FREIGHT, 'default')
		const route = await stub.deactivateRoute(user.id, routeId)

		return c.json(route)
	} catch (error) {
		logger.error('Error deactivating freight route:', error)

		if (error instanceof Error && error.message === 'Route not found') {
			return c.json({ error: 'Route not found' }, 404)
		}

		return c.json({ error: 'Failed to deactivate freight route' }, 500)
	}
})

/**
 * DELETE /freight/routes/:routeId
 * Delete a freight route (requires freight:manager permission)
 */
app.delete('/routes/:routeId', requireAuth(), async (c) => {
	const user = c.get('user')!
	const routeId = c.req.param('routeId')

	if (!(await isFreightManager(c.env, user.id, user.is_admin))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<Freight>(c.env.FREIGHT, 'default')
		await stub.deleteRoute(user.id, routeId)

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error deleting freight route:', error)

		if (error instanceof Error && error.message === 'Route not found') {
			return c.json({ error: 'Route not found' }, 404)
		}

		return c.json({ error: 'Failed to delete freight route' }, 500)
	}
})

/**
 * GET /freight/contracts
 * List alliance courier contracts with optional status filter (requires alliance membership)
 */
app.get('/contracts', requireAuth(), requireAllianceMember(), async (c) => {
	try {
		const status = c.req.query('status')
		const corpDataStub = getStub<EveCorporationData>(
			c.env.EVE_CORPORATION_DATA,
			'alliance-queries'
		)

		const contracts = await corpDataStub.getAllianceCourierContracts(
			ALLIANCE_ID,
			status || undefined
		)

		// Collect all unique IDs that need name resolution
		const idsToResolve = new Set<string>()
		for (const contract of contracts) {
			if (contract.issuerId) idsToResolve.add(contract.issuerId)
			if (contract.acceptorId) idsToResolve.add(contract.acceptorId)
			if (contract.startLocationId) idsToResolve.add(contract.startLocationId)
			if (contract.endLocationId) idsToResolve.add(contract.endLocationId)
		}

		let names: Record<string, string> = {}
		if (idsToResolve.size > 0) {
			try {
				const resolver = getStub<EsiTypeResolver>(c.env.ESI_TYPE_RESOLVER, 'global')
				names = await resolver.resolveIds([...idsToResolve])
			} catch (error) {
				logger.error('Error resolving ESI IDs for freight contracts:', {
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		const enriched = contracts.map((contract) => ({
			...contract,
			issuerName: contract.issuerId ? (names[contract.issuerId] ?? null) : null,
			acceptorName: contract.acceptorId ? (names[contract.acceptorId] ?? null) : null,
			startLocationName: contract.startLocationId
				? (names[contract.startLocationId] ?? null)
				: null,
			endLocationName: contract.endLocationId
				? (names[contract.endLocationId] ?? null)
				: null,
		}))

		return c.json(enriched)
	} catch (error) {
		logger.error('Error listing freight contracts:', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		return c.json({ error: 'Failed to list freight contracts' }, 500)
	}
})

/**
 * GET /freight/leaderboard
 * Get leaderboard of completed courier contracts (requires alliance membership)
 */
app.get('/leaderboard', requireAuth(), requireAllianceMember(), async (c) => {
	try {
		const corpDataStub = getStub<EveCorporationData>(
			c.env.EVE_CORPORATION_DATA,
			'alliance-queries'
		)

		const period = c.req.query('period')
		const since = period === '30d' ? new Date(Date.now() - 30 * MS_PER_DAY) : undefined
		const leaderboard = await corpDataStub.getCourierLeaderboard(ALLIANCE_ID, since)

		// Resolve acceptor names
		const idsToResolve = leaderboard.entries.map((entry) => entry.acceptorId)
		let names: Record<string, string> = {}
		if (idsToResolve.length > 0) {
			try {
				const resolver = getStub<EsiTypeResolver>(c.env.ESI_TYPE_RESOLVER, 'global')
				names = await resolver.resolveIds(idsToResolve)
			} catch (error) {
				logger.error('Error resolving ESI IDs for leaderboard:', {
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		return c.json({
			oldestContractDate: leaderboard.oldestContractDate,
			entries: leaderboard.entries.map((entry) => ({
				...entry,
				acceptorName: names[entry.acceptorId] ?? null,
			})),
		})
	} catch (error) {
		logger.error('Error fetching freight leaderboard:', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		return c.json({ error: 'Failed to fetch leaderboard' }, 500)
	}
})

export default app
