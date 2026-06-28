import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import corporationsRoutes from '../corporations'

import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

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

const getStubMock = vi.mocked(getStub)

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
		DATABASE_URL: 'postgres://test',
	} as any

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('keeps the persisted verification flag while surfacing live healthy director counts', async () => {
		const db = {
			query: {
				managedCorporations: {
					findMany: vi.fn().mockResolvedValue([
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
					]),
				},
			},
		}
		const corpStub = {
			getHealthyDirectors: vi.fn().mockResolvedValue([
				{ directorId: 'dir-1' },
				{ directorId: 'dir-2' },
			]),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.EVE_CORPORATION_DATA) return corpStub as any
			throw new Error('Unexpected binding')
		})

		const app = createApp(makeUser(), db)
		const response = await app.request('/api/corporations', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([
			expect.objectContaining({
				corporationId: 'corp-1',
				isVerified: false,
				healthyDirectorCount: 2,
			}),
		])
		expect(corpStub.getHealthyDirectors).toHaveBeenCalledWith('corp-1')
	})
})
