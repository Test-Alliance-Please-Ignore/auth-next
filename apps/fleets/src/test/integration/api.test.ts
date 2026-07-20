import { describe, expect, it, vi, beforeEach } from 'vitest'

const harness = vi.hoisted(() => ({
	getStub: vi.fn(() => ({})),
}))

vi.mock('cloudflare:workers', () => ({
	DurableObject: class {
		constructor(
			public state: DurableObjectState,
			public env: unknown
		) {}
	},
}))

vi.mock('@repo/db-utils', () => ({
	and: vi.fn(() => ({})),
	asc: vi.fn(() => ({})),
	desc: vi.fn(() => ({})),
	eq: vi.fn(() => ({})),
	gt: vi.fn(() => ({})),
	gte: vi.fn(() => ({})),
	inArray: vi.fn(() => ({})),
	isNull: vi.fn(() => ({})),
	isNotNull: vi.fn(() => ({})),
	lt: vi.fn(() => ({})),
	lte: vi.fn(() => ({})),
	or: vi.fn(() => ({})),
	sql: vi.fn(() => ({})),
	createDbClient: vi.fn(() => ({})),
	createDbClientWs: vi.fn(() => ({})),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: harness.getStub,
}))

vi.mock('@repo/hono-helpers', () => ({
	logger: {
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
	withOnError: () => async (_err: Error, ctx: { json: (body: unknown, status: number) => Response }) =>
		ctx.json({ success: false, error: { message: 'internal server error' } }, 500),
	withNotFound: () =>
		async (ctx: { json: (body: unknown, status: number) => Response }) =>
			ctx.json({ success: false, error: { message: 'not found' } }, 404),
	withWorkersLogger:
		() =>
		async (_ctx: unknown, next: () => Promise<Response>) =>
			await next(),
}))

import worker from '../../index'

import type { Env } from '../../context'

function createEnv(): Env {
	return {
		DATABASE_URL: 'postgres://example',
		NAME: 'fleets',
		ENVIRONMENT: 'VITEST',
		SENTRY_RELEASE: 'test',
		LOG_LEVEL: 'warn',
		FLEETS: {} as DurableObjectNamespace,
		FLEET_MONITOR: {} as DurableObjectNamespace,
		EVE_TOKEN_STORE: {} as DurableObjectNamespace,
		EVE_CHARACTER_DATA: {} as DurableObjectNamespace,
		EVE_CORPORATION_DATA: {} as DurableObjectNamespace,
		UNIVERSE: {} as DurableObjectNamespace,
		ESI_RATE_LIMITS: {} as KVNamespace,
		EVE_SSO_CLIENT_ID: 'client-id',
	}
}

beforeEach(() => {
	harness.getStub.mockReset()
	harness.getStub.mockReturnValue({})
	vi.clearAllMocks()
})

describe('Fleets Worker', () => {
	it('responds to the root endpoint', async () => {
		const response = await worker.fetch(new Request('http://example.com/'), createEnv())

		expect(response.status).toBe(200)
		await expect(response.text()).resolves.toContain('Fleets Durable Object Worker')
	})

	it('returns a clear error when the fleet monitor stub is unavailable', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/fleet-monitor/123/status'),
			createEnv()
		)

		expect(response.status).toBe(500)
		await expect(response.json()).resolves.toEqual({
			error: 'Fleet monitor endpoint unavailable',
		})
		expect(harness.getStub).toHaveBeenCalledWith(expect.anything(), 'fleet-123')
	})
})
