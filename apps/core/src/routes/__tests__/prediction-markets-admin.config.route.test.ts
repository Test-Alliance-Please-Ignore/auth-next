import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import adminRoutes from '../prediction-markets-admin'

import type { SessionUser } from '../../context'

// Admin config endpoints (GET/PATCH /config, GET /config/threshold-impact). The router-wide
// requireAuth()+requireAdmin() guard is mocked to a pass-through; the PM DO stub is mocked so we test
// the route's schema, error mapping, and actor threading — not the DO logic.

const stub = vi.hoisted(() => ({
	getConfig: vi.fn(),
	updateConfig: vi.fn(),
	previewTwoOfNThreshold: vi.fn(),
}))

vi.mock('../../middleware/session', () => ({
	requireAuth: () => async (_c: unknown, next: () => Promise<void>) => next(),
	requireAdmin: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('@repo/do-utils', () => ({ getStub: () => stub }))

function makeUser(over: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'admin-1',
		mainCharacterId: 'm',
		sessionId: 's',
		characters: [],
		is_admin: true,
		roles: [],
		discordUserId: null,
		...over,
	}
}

function createApp(user: SessionUser) {
	const app = new Hono<{ Bindings: any; Variables: { user?: SessionUser; db?: unknown } }>()
	app.use('*', async (c, next) => {
		c.set('user', user)
		c.set('db', {})
		await next()
	})
	app.route('/api/admin/prediction-markets', adminRoutes)
	return app
}

const env = { PREDICTION_MARKETS: {} } as any

function req(app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) {
	return app.request(
		`/api/admin/prediction-markets${path}`,
		{
			method,
			headers: { 'Content-Type': 'application/json' },
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		},
		env
	)
}

const validBody = {
	defaultRakeBps: 100,
	defaultMinStake: '1',
	twoOfNThreshold: '5000',
	creatorRewardMinBps: 0,
	creatorRewardMaxBps: 0,
}
const configView = {
	defaultRakeBps: 100,
	defaultMinStake: '1',
	twoOfNThreshold: '5000',
	creatorRewardMinBps: 0,
	creatorRewardMaxBps: 0,
	effectiveFrom: '2026-07-08T00:00:00.000Z',
	actorUserId: 'admin-1',
	changeNote: null,
	configured: true,
}

describe('admin prediction-markets /config', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		stub.getConfig.mockResolvedValue(configView)
		stub.updateConfig.mockResolvedValue(configView)
		stub.previewTwoOfNThreshold.mockResolvedValue({
			newlyRequiringCount: 0,
			noLongerRequiringCount: 0,
			strandedCandidates: [],
		})
	})

	it('GET /config returns the active config view', async () => {
		const res = await req(createApp(makeUser()), 'GET', '/config')
		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({ configured: true, defaultRakeBps: 100 })
	})

	it('PATCH /config threads the session actor (spread last — body cannot forge it)', async () => {
		await req(createApp(makeUser({ id: 'admin-1' })), 'PATCH', '/config', {
			...validBody,
			actorUserId: 'attacker',
		})
		expect(stub.updateConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				actorUserId: 'admin-1',
				defaultRakeBps: 100,
				twoOfNThreshold: '5000',
			})
		)
	})

	it('PATCH /config accepts a null threshold (disable)', async () => {
		const res = await req(createApp(makeUser()), 'PATCH', '/config', {
			...validBody,
			twoOfNThreshold: null,
		})
		expect(res.status).toBe(200)
		expect(stub.updateConfig).toHaveBeenCalledWith(
			expect.objectContaining({ twoOfNThreshold: null })
		)
	})

	it('PATCH /config 400s an out-of-range rake (zod)', async () => {
		const res = await req(createApp(makeUser()), 'PATCH', '/config', {
			...validBody,
			defaultRakeBps: 2001,
		})
		expect(res.status).toBe(400)
		expect(stub.updateConfig).not.toHaveBeenCalled()
	})

	it('PATCH /config 400s a "0" threshold (zod refine > 0)', async () => {
		const res = await req(createApp(makeUser()), 'PATCH', '/config', {
			...validBody,
			twoOfNThreshold: '0',
		})
		expect(res.status).toBe(400)
	})

	it('PATCH /config accepts a creator-reward band and forwards it', async () => {
		const res = await req(createApp(makeUser()), 'PATCH', '/config', {
			...validBody,
			creatorRewardMinBps: 1000,
			creatorRewardMaxBps: 5000,
		})
		expect(res.status).toBe(200)
		expect(stub.updateConfig).toHaveBeenCalledWith(
			expect.objectContaining({ creatorRewardMinBps: 1000, creatorRewardMaxBps: 5000 })
		)
	})

	it('PATCH /config 400s a creator-reward band above 100% (zod max)', async () => {
		const res = await req(createApp(makeUser()), 'PATCH', '/config', {
			...validBody,
			creatorRewardMinBps: 0,
			creatorRewardMaxBps: 10001,
		})
		expect(res.status).toBe(400)
		expect(stub.updateConfig).not.toHaveBeenCalled()
	})

	it('PATCH /config 400s an inverted creator-reward band (min > max)', async () => {
		const res = await req(createApp(makeUser()), 'PATCH', '/config', {
			...validBody,
			creatorRewardMinBps: 6000,
			creatorRewardMaxBps: 5000,
		})
		expect(res.status).toBe(400)
		expect(stub.updateConfig).not.toHaveBeenCalled()
	})

	it('PATCH /config maps THRESHOLD_WOULD_STRAND to 400', async () => {
		stub.updateConfig.mockRejectedValue(new Error('THRESHOLD_WOULD_STRAND'))
		const res = await req(createApp(makeUser()), 'PATCH', '/config', validBody)
		expect(res.status).toBe(400)
		expect(await res.json()).toMatchObject({ error: 'THRESHOLD_WOULD_STRAND' })
	})

	it('GET /config/threshold-impact proxies the preview for a valid threshold', async () => {
		const res = await req(createApp(makeUser()), 'GET', '/config/threshold-impact?threshold=5000')
		expect(res.status).toBe(200)
		expect(stub.previewTwoOfNThreshold).toHaveBeenCalledWith('5000')
	})

	it('GET /config/threshold-impact treats empty as null (disable preview)', async () => {
		await req(createApp(makeUser()), 'GET', '/config/threshold-impact?threshold=')
		expect(stub.previewTwoOfNThreshold).toHaveBeenCalledWith(null)
	})

	it('GET /config/threshold-impact 400s a non-integer threshold without hitting the DO', async () => {
		const res = await req(createApp(makeUser()), 'GET', '/config/threshold-impact?threshold=abc')
		expect(res.status).toBe(400)
		expect(stub.previewTwoOfNThreshold).not.toHaveBeenCalled()
	})
})
