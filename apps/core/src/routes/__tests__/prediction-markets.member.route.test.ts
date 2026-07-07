import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import predictionMarketsRoutes from '../prediction-markets'

import type { SessionUser } from '../../context'

const mocks = vi.hoisted(() => ({
	hasMarketPermission: vi.fn(),
	createAndPublishMarket: vi.fn(),
}))

// requireAuth → pass-through; the test injects the session user directly.
vi.mock('../../middleware/session', () => ({
	requireAuth: () => async (_c: unknown, next: () => Promise<void>) => next(),
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
		roles: [],
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
const validBody = { question: 'Will it rain tomorrow?', outcomes: ['Yes', 'No'], closesAt: futureIso }
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

	it('403s a user without urn:markets:creator and never creates', async () => {
		mocks.hasMarketPermission.mockResolvedValue(false)
		const res = await post(createApp(makeUser()), validBody)
		expect(res.status).toBe(403)
		expect(mocks.createAndPublishMarket).not.toHaveBeenCalled()
	})

	it('creates for a permitted user, createdBy from session, rate-limited for a non-admin', async () => {
		mocks.hasMarketPermission.mockResolvedValue(true)
		// Even if the client tries to spoof createdBy, the route ignores it.
		const res = await post(createApp(makeUser({ id: 'user-1' })), { ...validBody, createdBy: 'evil' })
		expect(res.status).toBe(201)
		expect(mocks.hasMarketPermission).toHaveBeenCalledWith(env, 'user-1', 'creator', false)
		expect(mocks.createAndPublishMarket).toHaveBeenCalledWith(
			expect.anything(),
			env,
			'user-1',
			expect.objectContaining({ question: 'Will it rain tomorrow?' }),
			{ enforceRateLimit: true }
		)
	})

	it('does not rate-limit a site admin using the member route', async () => {
		mocks.hasMarketPermission.mockResolvedValue(true)
		await post(createApp(makeUser({ is_admin: true })), validBody)
		expect(mocks.createAndPublishMarket).toHaveBeenCalledWith(
			expect.anything(),
			env,
			'user-1',
			expect.anything(),
			{ enforceRateLimit: false }
		)
	})

	it('429s when the per-user creation rate budget is exhausted', async () => {
		mocks.hasMarketPermission.mockResolvedValue(true)
		mocks.createAndPublishMarket.mockRejectedValue(new Error('RATE_LIMITED:5000'))
		const res = await post(createApp(makeUser()), validBody)
		expect(res.status).toBe(429)
		expect(await res.json()).toMatchObject({ retryAfterMs: 5000 })
	})

	it('400s an invalid body (validation) even when permitted', async () => {
		mocks.hasMarketPermission.mockResolvedValue(true)
		const res = await post(createApp(makeUser()), { question: 'x', outcomes: ['only one'] })
		expect(res.status).toBe(400)
		expect(mocks.createAndPublishMarket).not.toHaveBeenCalled()
	})
})
