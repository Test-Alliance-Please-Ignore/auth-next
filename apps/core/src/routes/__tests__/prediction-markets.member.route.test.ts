import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'

import predictionMarketsRoutes from '../prediction-markets'

import type { SessionUser } from '../../context'

const mocks = vi.hoisted(() => ({
	hasMarketPermission: vi.fn(),
	createAndPublishMarket: vi.fn(),
}))

// requireAuth → pass-through; the test injects the session user directly.
vi.mock('../../middleware/session', () => ({
	requireAuth: () => async (_c: unknown, next: () => Promise<void>) => next(),
	requireAllianceMember: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../lib/market-permissions', () => ({
	hasMarketPermission: mocks.hasMarketPermission,
}))
// Keep createMarketSchema + mapMarketCreateError real; only stub the write.
vi.mock('../../services/market-create.service', async (orig) => ({
	...(await (orig() as Promise<Record<string, unknown>>)),
	createAndPublishMarket: mocks.createAndPublishMarket,
}))

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: 'main-1',
		sessionId: 'session-1',
		characters: [],
		is_admin: false,
		roles: [ROLE_CORE_ALLIANCE_MEMBER],
		discordUserId: null,
		...overrides,
	}
}

function createApp(user: SessionUser) {
	const app = new Hono<{ Bindings: any; Variables: { user?: SessionUser; db?: unknown } }>()
	app.use('*', async (c, next) => {
		c.set('user', user)
		c.set('db', {})
		await next()
	})
	app.route('/api/prediction-markets', predictionMarketsRoutes)
	return app
}

const futureIso = new Date(Date.now() + 86_400_000).toISOString()
const resolvesOnIso = new Date(Date.now() + 2 * 86_400_000).toISOString()
const validBody = {
	question: 'Will it rain tomorrow?',
	outcomes: ['Yes', 'No'],
	closesAt: futureIso,
	resolvesOn: resolvesOnIso,
}
const env = { GROUPS: {}, PREDICTION_MARKETS: {}, DISCORD: {} } as any

function post(app: ReturnType<typeof createApp>, body: unknown) {
	return app.request(
		'/api/prediction-markets/markets',
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
		env
	)
}

describe('member prediction-markets create route', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.createAndPublishMarket.mockResolvedValue({
			market: { id: 'm1' },
			post: null,
			postError: null,
		})
	})

	// hasMarketPermission is called per-tier: ('creator') gates the route, ('manager') picks the
	// schema + rate-limit exemption. Resolve per the tier argument.
	function mockTiers(creator: boolean, manager: boolean) {
		mocks.hasMarketPermission.mockImplementation((_env, _userId, tier) =>
			Promise.resolve(tier === 'manager' ? manager : creator)
		)
	}

	it('403s a user without urn:markets:creator and never creates', async () => {
		mockTiers(false, false)
		const res = await post(createApp(makeUser()), validBody)
		expect(res.status).toBe(403)
		expect(mocks.createAndPublishMarket).not.toHaveBeenCalled()
	})

	it('creator (non-manager): 201, createdBy from session, rate-limited', async () => {
		mockTiers(true, false)
		// Even if the client tries to spoof createdBy, the route ignores it.
		const res = await post(createApp(makeUser({ id: 'user-1' })), {
			...validBody,
			createdBy: 'evil',
		})
		expect(res.status).toBe(201)
		expect(mocks.hasMarketPermission).toHaveBeenCalledWith(env, 'user-1', 'creator', false)
		expect(mocks.createAndPublishMarket).toHaveBeenCalledWith(
			expect.anything(),
			env,
			'user-1',
			expect.objectContaining({ question: 'Will it rain tomorrow?' }),
			{ enforceRateLimit: true, createdByAdmin: false }
		)
	})

	it('creator: slim schema strips economic params (they default from config)', async () => {
		mockTiers(true, false)
		await post(createApp(makeUser()), { ...validBody, rakeBps: 1500, minStake: '50', twoOfN: true })
		const body = mocks.createAndPublishMarket.mock.calls[0][3]
		expect(body).not.toHaveProperty('rakeBps')
		expect(body).not.toHaveProperty('minStake')
		expect(body).not.toHaveProperty('twoOfN')
		expect(body).toMatchObject({ question: 'Will it rain tomorrow?' })
	})

	it('non-admin manager: full schema, no rate limit, but still duration-capped (createdByAdmin false)', async () => {
		mockTiers(true, true)
		await post(createApp(makeUser()), { ...validBody, rakeBps: 1500 })
		expect(mocks.createAndPublishMarket).toHaveBeenCalledWith(
			expect.anything(),
			env,
			'user-1',
			expect.objectContaining({ rakeBps: 1500 }),
			{ enforceRateLimit: false, createdByAdmin: false }
		)
	})

	it('site admin: exempt from the duration cap (createdByAdmin true)', async () => {
		mockTiers(true, true)
		await post(createApp(makeUser({ is_admin: true })), validBody)
		expect(mocks.createAndPublishMarket).toHaveBeenCalledWith(
			expect.anything(),
			env,
			'user-1',
			expect.objectContaining({ question: 'Will it rain tomorrow?' }),
			{ enforceRateLimit: false, createdByAdmin: true }
		)
	})

	it('429s when the per-user creation rate budget is exhausted', async () => {
		mockTiers(true, false)
		mocks.createAndPublishMarket.mockRejectedValue(new Error('RATE_LIMITED:5000'))
		const res = await post(createApp(makeUser()), validBody)
		expect(res.status).toBe(429)
		expect(await res.json()).toMatchObject({ retryAfterMs: 5000 })
	})

	it('400s an invalid body (validation) even when permitted', async () => {
		mockTiers(true, true)
		const res = await post(createApp(makeUser()), { question: 'x', outcomes: ['only one'] })
		expect(res.status).toBe(400)
		expect(mocks.createAndPublishMarket).not.toHaveBeenCalled()
	})

	it('manager: forwards designatedResolverIds (lowercase-canonicalized)', async () => {
		mockTiers(true, true)
		const upper = 'AAAAAAAA-1111-4111-8111-111111111111'
		await post(createApp(makeUser()), { ...validBody, designatedResolverIds: [upper] })
		const body = mocks.createAndPublishMarket.mock.calls[0][3]
		expect(body.designatedResolverIds).toEqual([upper.toLowerCase()])
	})

	it('creator: slim schema strips designatedResolverIds', async () => {
		mockTiers(true, false)
		await post(createApp(makeUser()), {
			...validBody,
			designatedResolverIds: ['aaaaaaaa-1111-4111-8111-111111111111'],
		})
		const body = mocks.createAndPublishMarket.mock.calls[0][3]
		expect(body).not.toHaveProperty('designatedResolverIds')
	})

	it('maps a CREATOR_IS_RESOLVER rejection to 400', async () => {
		mockTiers(true, true)
		mocks.createAndPublishMarket.mockRejectedValue(new Error('CREATOR_IS_RESOLVER'))
		const res = await post(createApp(makeUser()), {
			...validBody,
			designatedResolverIds: ['aaaaaaaa-1111-4111-8111-111111111111'],
		})
		expect(res.status).toBe(400)
		expect(await res.json()).toMatchObject({ error: 'CREATOR_IS_RESOLVER' })
	})

	it('maps a DESIGNATED_RESOLVER_INVALID rejection to 400', async () => {
		mockTiers(true, true)
		mocks.createAndPublishMarket.mockRejectedValue(new Error('DESIGNATED_RESOLVER_INVALID'))
		const res = await post(createApp(makeUser()), {
			...validBody,
			designatedResolverIds: ['aaaaaaaa-1111-4111-8111-111111111111'],
		})
		expect(res.status).toBe(400)
	})
})
