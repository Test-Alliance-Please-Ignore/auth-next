import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import corporationsRoutes from '../corporations'

import type { SessionUser } from '../../context'

vi.mock('../../middleware/session', () => ({
	requireAuth:
		() =>
		async (_c: unknown, next: () => Promise<void>): Promise<void> => {
			await next()
		},
	requireAdmin:
		() =>
		async (_c: unknown, next: () => Promise<void>): Promise<void> => {
			await next()
		},
}))

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: '1001',
		sessionId: 'session-1',
		characters: [],
		is_admin: true,
		roles: [],
		discordUserId: null,
		...overrides,
	}
}

function createApp(user: SessionUser, db: any) {
	const app = new Hono<{
		Bindings: any
		Variables: {
			user?: SessionUser
			db?: any
		}
	}>()

	app.use('*', async (c, next) => {
		c.set('user', user)
		c.set('db', db)
		await next()
	})

	app.route('/api/corporations', corporationsRoutes)
	return app
}

describe('corporations list route', () => {
	const env = {
		EVE_CORPORATION_DATA: { name: 'EVE_CORPORATION_DATA' },
		EVE_CORPORATION_DATA_WORKER: {
			getHealthyDirectorCounts: vi.fn(),
		},
		DATABASE_URL: 'postgres://test',
	} as any

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('keeps the persisted verification flag while surfacing live healthy director counts', async () => {
		const findMany = vi.fn().mockResolvedValue([
			{
				corporationId: 'corp-1',
				name: 'Test Corp',
				ticker: 'TST',
				assignedCharacterId: null,
				assignedCharacterName: null,
				isActive: true,
				includeInBackgroundRefresh: true,
				includeInStructureAssetSync: false,
				isMemberCorporation: true,
				isAltCorp: false,
				isSpecialPurpose: false,
				isRecruiting: false,
				shortDescription: null,
				fullDescription: null,
				lastSync: null,
				lastVerified: null,
				isVerified: false,
				healthyDirectorCount: 0,
				configuredBy: null,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			},
		])
		const db = {
			query: {
				managedCorporations: {
					findMany,
				},
			},
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([{ count: 1 }]),
				})),
			})),
		}
		env.EVE_CORPORATION_DATA_WORKER.getHealthyDirectorCounts.mockResolvedValue({ 'corp-1': 2 })

		const app = createApp(makeUser(), db)
		const response = await app.request('/api/corporations', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			data: [
				expect.objectContaining({
					corporationId: 'corp-1',
					isVerified: false,
					healthyDirectorCount: 2,
				}),
			],
			pagination: {
				page: 1,
				pageSize: 25,
				totalCount: 1,
				totalPages: 1,
				hasNextPage: false,
				hasPreviousPage: false,
			},
		})
		expect(findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				limit: 25,
				offset: 0,
			})
		)
		expect(env.EVE_CORPORATION_DATA_WORKER.getHealthyDirectorCounts).toHaveBeenCalledWith([
			'corp-1',
		])
	})

	it('passes requested SQL pagination to the corporation query', async () => {
		const findMany = vi.fn().mockResolvedValue([])
		const db = {
			query: { managedCorporations: { findMany } },
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([{ count: 125 }]),
				})),
			})),
		}

		const app = createApp(makeUser(), db)
		const response = await app.request(
			'/api/corporations?corporationType=alt&search=alpha&page=2&pageSize=100',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			data: [],
			pagination: {
				page: 2,
				pageSize: 100,
				totalCount: 125,
				totalPages: 2,
				hasNextPage: false,
				hasPreviousPage: true,
			},
		})
		expect(findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				limit: 100,
				offset: 100,
			})
		)
		expect(env.EVE_CORPORATION_DATA_WORKER.getHealthyDirectorCounts).not.toHaveBeenCalled()
	})

	it('reuses cached page and per-corporation health data', async () => {
		const findMany = vi.fn().mockResolvedValue([
			{
				corporationId: 'corp-cache-1',
				name: 'Cached Corp',
				ticker: 'CAC',
				assignedCharacterId: null,
				assignedCharacterName: null,
				isActive: true,
				includeInBackgroundRefresh: false,
				includeInStructureAssetSync: false,
				isMemberCorporation: true,
				isAltCorp: false,
				isSpecialPurpose: false,
				isRecruiting: false,
				shortDescription: null,
				fullDescription: null,
				lastSync: null,
				lastVerified: null,
				isVerified: false,
				healthyDirectorCount: 1,
				configuredBy: null,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			},
		])
		const db = {
			query: { managedCorporations: { findMany } },
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([{ count: 1 }]),
				})),
			})),
		}
		env.EVE_CORPORATION_DATA_WORKER.getHealthyDirectorCounts.mockResolvedValue({
			'corp-cache-1': 4,
		})

		const app = createApp(makeUser(), db)
		const firstResponse = await app.request('/api/corporations?search=cache-test', {}, env)
		const secondResponse = await app.request('/api/corporations?search=cache-test', {}, env)

		expect(firstResponse.status).toBe(200)
		expect(secondResponse.status).toBe(200)
		const secondBody = (await secondResponse.json()) as {
			data: Array<{ healthyDirectorCount: number }>
		}
		expect(secondBody.data[0]?.healthyDirectorCount).toBe(4)
		expect(findMany).toHaveBeenCalledTimes(1)
		expect(env.EVE_CORPORATION_DATA_WORKER.getHealthyDirectorCounts).toHaveBeenCalledTimes(1)
	})
})
