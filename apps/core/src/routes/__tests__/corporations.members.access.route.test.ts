import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import { getCachedUserPermissions } from '../../lib/groups-cache'
import corporationsRoutes from '../corporations'

import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: vi.fn(),
}))

const getStubMock = vi.mocked(getStub)
const getCachedUserPermissionsMock = vi.mocked(getCachedUserPermissions)

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: '1001',
		sessionId: 'session-1',
		characters: [],
		is_admin: false,
		roles: [],
		discordUserId: null,
		...overrides,
	}
}

function makeDbStub() {
	return {
		query: {
			managedCorporations: {
				findFirst: vi.fn().mockResolvedValue({
					corporationId: '1001',
					name: 'Alpha Corp',
					ticker: 'ALP',
					isActive: true,
				}),
			},
			userCharacters: {
				findMany: vi.fn().mockResolvedValue([]),
				findFirst: vi.fn().mockResolvedValue({
					characterId: '2001',
					characterName: 'Pilot One',
					userId: 'target-user-1',
					status: 'active',
					hasValidToken: true,
				}),
			},
			users: {
				findMany: vi.fn().mockResolvedValue([]),
			},
		},
		update: vi.fn().mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue(undefined),
			}),
		}),
	}
}

function createApp(opts: { user?: SessionUser; db?: ReturnType<typeof makeDbStub> }) {
	const app = new Hono<{
		Bindings: any
		Variables: {
			user?: SessionUser
			db?: ReturnType<typeof makeDbStub>
		}
	}>()

	app.use('*', async (c, next) => {
		if (opts.user) c.set('user', opts.user)
		if (opts.db) c.set('db', opts.db)
		await next()
	})

	app.route('/api/corporations', corporationsRoutes)
	return app
}

describe('corporations members access matrix', () => {
	const env = {
		EVE_CHARACTER_DATA: { name: 'EVE_CHARACTER_DATA' },
		EVE_CORPORATION_DATA: { name: 'EVE_CORPORATION_DATA' },
		EVE_TOKEN_STORE: { name: 'EVE_TOKEN_STORE' },
		HR: { name: 'HR' },
	} as any

	let dbStub: ReturnType<typeof makeDbStub>
	let hrStub: {
		checkPermission: ReturnType<typeof vi.fn>
		checkCharactersBlacklisted: ReturnType<typeof vi.fn>
	}
	let corpStub: {
		getCorporationInfo: ReturnType<typeof vi.fn>
		getCoreData: ReturnType<typeof vi.fn>
		getDirectors: ReturnType<typeof vi.fn>
		fetchCoreData: ReturnType<typeof vi.fn>
	}
	let charStub: {
		getCharacterInfo: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.clearAllMocks()
		dbStub = makeDbStub()
		hrStub = {
			checkPermission: vi.fn().mockResolvedValue(false),
			checkCharactersBlacklisted: vi.fn().mockResolvedValue({}),
		}
		charStub = {
			getCharacterInfo: vi.fn().mockResolvedValue(null),
		}
		corpStub = {
			getCorporationInfo: vi.fn().mockResolvedValue({ ceoId: '9999', allianceId: null }),
			getCoreData: vi.fn().mockResolvedValue({
				members: [{ characterId: '2001', updatedAt: new Date('2026-04-01T00:00:00.000Z') }],
				memberTracking: [],
			}),
			getDirectors: vi.fn().mockResolvedValue([]),
			fetchCoreData: vi.fn().mockResolvedValue(undefined),
		}

		getCachedUserPermissionsMock.mockResolvedValue([])
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			if (binding === env.EVE_CHARACTER_DATA) {
				return charStub as any
			}
			if (binding === env.EVE_CORPORATION_DATA) {
				return corpStub as any
			}
			if (binding === env.EVE_TOKEN_STORE) {
				return {
					resolveIds: vi.fn().mockImplementation(async (ids: string[]) =>
						Object.fromEntries(ids.map((id) => [id, id === '2001' ? 'Pilot One' : `Character ${id}`]))
					),
				} as any
			}
			throw new Error('Unexpected binding')
		})
	})

	it('denies members access for non-auditor without corp/hr role', async () => {
		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/corporations/1001/members', {}, env)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({
			error:
				'Access denied. Corporation CEO, Director, site admin, HR role, or HR auditor permission required.',
		})
	})

	it('allows hr auditor to view members without corp/hr role', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([
			{
				permissionId: 'perm-auditor',
				urn: 'urn:hr:auditor',
				name: 'HR Auditor',
				description: null,
				category: null,
				groupId: 'g-1',
				groupName: 'HR',
				targetType: 'all_members',
				source: 'global',
			},
		] as any)

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/corporations/1001/members', {}, env)

		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			items: Array<{ characterId: string; characterName: string; hasValidToken?: boolean | null }>
			pagination: { totalItems: number; totalPages: number }
		}
		expect(body.items).toHaveLength(1)
		expect(body.items[0]).toMatchObject({
			characterId: '2001',
			characterName: 'Pilot One',
		})
		expect(body.pagination.totalItems).toBe(1)
		expect(body.pagination.totalPages).toBe(1)
		expect(hrStub.checkCharactersBlacklisted).toHaveBeenCalledWith(['2001'])
	})

	it('supports members pagination/search/sort and returns token validity in items', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([
			{
				permissionId: 'perm-auditor',
				urn: 'urn:hr:auditor',
				name: 'HR Auditor',
				description: null,
				category: null,
				groupId: 'g-1',
				groupName: 'HR',
				targetType: 'all_members',
				source: 'global',
			},
		] as any)

		corpStub.getCoreData.mockResolvedValue({
			members: [
				{ characterId: '2001', updatedAt: new Date('2026-04-01T00:00:00.000Z') },
				{ characterId: '2002', updatedAt: new Date('2026-04-01T00:00:00.000Z') },
			],
			memberTracking: [],
		})
		dbStub.query.userCharacters.findMany.mockResolvedValue([
			{
				characterId: '2001',
				userId: 'target-user-1',
				status: 'active',
				hasValidToken: true,
			},
		])
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			if (binding === env.EVE_CHARACTER_DATA) return charStub as any
			if (binding === env.EVE_CORPORATION_DATA) return corpStub as any
			if (binding === env.EVE_TOKEN_STORE) {
				return {
					resolveIds: vi.fn().mockImplementation(async (ids: string[]) =>
						Object.fromEntries(
							ids.map((id) => [id, id === '2001' ? 'Pilot One' : id === '2002' ? 'Pilot Two' : id])
						)
					),
				} as any
			}
			throw new Error('Unexpected binding')
		})

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request(
			'/api/corporations/1001/members?page=1&limit=1&search=pilot&sortField=name&sortOrder=asc',
			{},
			env
		)

		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			items: Array<{ characterId: string; characterName: string; hasValidToken?: boolean | null }>
			pagination: {
				page: number
				limit: number
				totalItems: number
				totalPages: number
				hasNextPage: boolean
				hasPreviousPage: boolean
			}
			summary: { total: number; linked: number }
		}
		expect(body.items).toHaveLength(1)
		expect(body.items[0]).toMatchObject({
			characterId: '2001',
			characterName: 'Pilot One',
			hasValidToken: true,
		})
		expect(body.pagination).toMatchObject({
			page: 1,
			limit: 1,
			totalItems: 2,
			totalPages: 2,
			hasNextPage: true,
			hasPreviousPage: false,
		})
		expect(body.summary).toMatchObject({
			total: 2,
			linked: 1,
		})
	})

	it('denies members refresh for HR-only access (no CEO/director/admin leadership)', async () => {
		hrStub.checkPermission.mockResolvedValue(true)

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/corporations/1001/members/refresh', { method: 'POST' }, env)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({
			error: 'Access denied. Corporation CEO, Director, or site admin access required.',
		})
	})

	it('allows members refresh for director leadership access', async () => {
		const app = createApp({
			user: makeUser({
				characters: [
					{
						id: 'uc-1',
						characterOwnerHash: 'owner-1',
						characterId: '1001',
						characterName: 'Director Pilot',
						is_primary: true,
						hasValidToken: true,
					},
				],
			}),
			db: dbStub,
		})

		dbStub.query.userCharacters.findMany.mockResolvedValue([
			{
				id: 'uc-1',
				userId: 'user-1',
				characterId: '1001',
				characterName: 'Director Pilot',
				corporationId: '1001',
				isDeleted: false,
			},
		])
		charStub.getCharacterInfo.mockResolvedValue({
			characterId: '1001',
			corporationId: '1001',
			characterName: 'Director Pilot',
		})
		corpStub.getDirectors.mockResolvedValue([{ characterId: '1001', characterName: 'Director Pilot' }])

		const res = await app.request('/api/corporations/1001/members/refresh', { method: 'POST' }, env)

		expect(res.status).toBe(200)
		expect(corpStub.fetchCoreData).toHaveBeenCalledWith('1001', true)
	})
})
