import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'
import type { Srp } from '@repo/srp'

import { createDb } from '../../db'
import publicSrpRoutes from '../srp-public'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../db', () => ({
	createDb: vi.fn(),
}))

const getStubMock = vi.mocked(getStub)
const createDbMock = vi.mocked(createDb)

const env = {
	DATABASE_URL: 'postgres://test',
	SRP_PUBLIC_API_TOKEN: 'expected-token',
	SRP: {
		name: 'SRP',
		idFromName: vi.fn(),
		get: vi.fn(),
	},
} as any

function createApp() {
	const app = new Hono<{ Bindings: any }>()
	app.route('/api/public/srp', publicSrpRoutes)
	return app
}

function makeSrpStub(
	summary: Record<string, unknown> | null = {
		killmailId: '12345',
		userId: 'user-1',
		shipTypeId: '609',
		shipTypeName: 'Raven',
		requestStatus: 'approved',
		approvedAmount: '125000000',
	}
) {
	return {
		getPublicRequestSummary: vi.fn().mockResolvedValue(summary),
	} satisfies Pick<Srp, 'getPublicRequestSummary'>
}

function makeDb(user: Record<string, unknown> | null = null, mainCharacter: Record<string, unknown> | null = null) {
	return {
		query: {
			users: {
				findFirst: vi.fn().mockResolvedValue(
					user ?? {
						id: 'user-1',
						mainCharacterId: '7001',
					}
				),
			},
			userCharacters: {
				findFirst: vi.fn().mockResolvedValue(
					mainCharacter ?? {
						characterName: 'Main Character',
					}
				),
			},
		},
	}
}

describe('public srp route', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		createDbMock.mockReturnValue(makeDb() as any)
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.SRP) {
				return makeSrpStub() as any
			}
			throw new Error('Unexpected binding')
		})
	})

	it('rejects requests without the API token', async () => {
		const app = createApp()
		const res = await app.request('/api/public/srp/12345', {
			method: 'GET',
		}, env)

		expect(res.status).toBe(401)
		expect(await res.json()).toEqual({ error: 'Unauthorized' })
	})

	it('returns a compact summary for a matching request', async () => {
		const app = createApp()
		const res = await app.request('/api/public/srp/12345', {
			method: 'GET',
			headers: {
				Authorization: 'Bearer expected-token',
			},
		}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			killmailId: '12345',
			userId: 'user-1',
			mainCharacterName: 'Main Character',
			shipTypeId: '609',
			shipTypeName: 'Raven',
			requestStatus: 'approved',
			approvedAmount: '125000000',
		})
	})

	it('returns 404 when the killmail request does not exist', async () => {
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.SRP) {
				return makeSrpStub(null) as any
			}
			throw new Error('Unexpected binding')
		})

		const app = createApp()
		const res = await app.request('/api/public/srp/12345', {
			method: 'GET',
			headers: {
				Authorization: 'Bearer expected-token',
			},
		}, env)

		expect(res.status).toBe(404)
		expect(await res.json()).toEqual({ error: 'Request not found' })
	})
})
