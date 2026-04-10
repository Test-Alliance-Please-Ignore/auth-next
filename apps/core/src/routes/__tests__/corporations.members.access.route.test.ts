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
			},
			users: {
				findMany: vi.fn().mockResolvedValue([]),
			},
		},
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

	beforeEach(() => {
		vi.clearAllMocks()
		dbStub = makeDbStub()
		hrStub = {
			checkPermission: vi.fn().mockResolvedValue(false),
			checkCharactersBlacklisted: vi.fn().mockResolvedValue({}),
		}

		getCachedUserPermissionsMock.mockResolvedValue([])
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			if (binding === env.EVE_CHARACTER_DATA) {
				return { getCharacterInfo: vi.fn().mockResolvedValue(null) } as any
			}
			if (binding === env.EVE_CORPORATION_DATA) {
				return {
					getCorporationInfo: vi.fn().mockResolvedValue({ ceoId: '9999', allianceId: null }),
					getCoreData: vi.fn().mockResolvedValue({
						members: [{ characterId: '2001', updatedAt: new Date('2026-04-01T00:00:00.000Z') }],
						memberTracking: [],
					}),
					getDirectors: vi.fn().mockResolvedValue([]),
				} as any
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
		const body = (await res.json()) as Array<{ characterId: string; characterName: string }>
		expect(body).toHaveLength(1)
		expect(body[0]).toMatchObject({
			characterId: '2001',
			characterName: 'Pilot One',
		})
		expect(hrStub.checkCharactersBlacklisted).toHaveBeenCalledWith(['2001'])
	})
})
