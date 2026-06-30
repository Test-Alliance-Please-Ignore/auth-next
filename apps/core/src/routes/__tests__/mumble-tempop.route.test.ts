import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { createDb } from '../../db'
import { getCachedUserPermissions } from '../../lib/groups-cache'
import { resolveFlag } from '../flags'
import mumbleTempopRoutes from '../mumble-tempop'

import type { SessionUser } from '../../context'

vi.mock('../../db', () => ({
	createDb: vi.fn(),
}))

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: vi.fn(),
}))

vi.mock('../flags', () => ({
	resolveFlag: vi.fn(),
}))

// @neondatabase/api-client (pulled in via @repo/db-utils test helpers) breaks
// the workers-pool CJS shim; it is irrelevant to these tests.
vi.mock('@neondatabase/api-client', () => ({
	createApiClient: vi.fn(),
	EndpointType: {},
}))

const createDbMock = vi.mocked(createDb)
const getCachedUserPermissionsMock = vi.mocked(getCachedUserPermissions)
const resolveFlagMock = vi.mocked(resolveFlag)

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
	const app = new Hono<{
		Bindings: any
		Variables: { user?: SessionUser }
	}>()

	app.use('*', async (c, next) => {
		c.set('user', user)
		await next()
	})

	app.route('/api/mumble-tempop', mumbleTempopRoutes)
	return app
}

describe('GET /api/mumble-tempop', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		resolveFlagMock.mockResolvedValue(true)
		getCachedUserPermissionsMock.mockResolvedValue([
			{ urn: 'urn:mumble:tempop:create' },
		] as any)

		const selectMock = vi.fn()
		selectMock
			.mockImplementationOnce(() => ({
				from: () => ({
					where: () => Promise.resolve([{ count: 12 }]),
				}),
			}))
			.mockImplementationOnce(() => ({
				from: () => ({
					leftJoin: () => ({
						where: () =>
							Promise.resolve([
								{ userId: 'user-1', name: 'Creator One' },
							]),
					}),
				}),
			}))

		const dbStub = {
			select: selectMock,
			query: {
				mumbleTempops: {
					findMany: vi.fn().mockResolvedValue([
						{
							id: 'tempop-2',
							shortCode: 'B2',
							creatorUserId: 'user-1',
							groupName: 'TempOp',
							ttlSeconds: 7200,
							status: 'active',
							expiresAt: new Date('2026-06-26T14:00:00.000Z'),
							createdAt: new Date('2026-06-26T12:00:00.000Z'),
							deletedAt: null,
						},
						{
							id: 'tempop-1',
							shortCode: 'A1',
							creatorUserId: 'user-1',
							groupName: 'TempOp',
							ttlSeconds: 7200,
							status: 'active',
							expiresAt: new Date('2026-06-26T13:30:00.000Z'),
							createdAt: new Date('2026-06-26T11:00:00.000Z'),
							deletedAt: null,
						},
					]),
				},
				mumbleTempopGuests: {
					findMany: vi.fn().mockResolvedValue([{ tempopId: 'tempop-2' }]),
				},
			},
		}

		createDbMock.mockReturnValue(dbStub as any)
	})

	it('returns paginated temp-op rows and metadata', async () => {
		const app = createApp(makeUser())
		const res = await app.request('/api/mumble-tempop?page=2&pageSize=10', {}, { DATABASE_URL: 'postgres://test' } as any)

		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.items).toHaveLength(2)
		expect(body.items[0].shortCode).toBe('B2')
		expect(body.items[0].guestCount).toBe(1)
		expect(body.items[1].shortCode).toBe('A1')
		expect(body.pagination).toEqual({
			page: 2,
			pageSize: 10,
			totalCount: 12,
			totalPages: 2,
			hasNextPage: false,
			hasPreviousPage: true,
		})
	})
})
