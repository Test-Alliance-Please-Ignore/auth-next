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

describe('corporations access route', () => {
	const env = {
		EVE_CHARACTER_DATA: { name: 'EVE_CHARACTER_DATA' },
		EVE_CORPORATION_DATA: { name: 'EVE_CORPORATION_DATA' },
		HR: { name: 'HR' },
		DATABASE_URL: 'postgresql://test',
	} as any

	let dbStub: {
		query: {
			managedCorporations: {
				findFirst: ReturnType<typeof vi.fn>
			}
			userCharacters: {
				findMany: ReturnType<typeof vi.fn>
			}
		}
	}
	let charStub: {
		getCharacterInfo: ReturnType<typeof vi.fn>
	}
	let hrStub: {
		checkPermission: ReturnType<typeof vi.fn>
	}
	let corpStub: {
		getCorporationInfo: ReturnType<typeof vi.fn>
		getDirectors: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.clearAllMocks()

		dbStub = {
			query: {
				managedCorporations: {
					findFirst: vi.fn().mockResolvedValue({
						corporationId: '1001',
						name: 'Alpha Corp',
						ticker: 'ALP',
						isMemberCorporation: true,
						isAltCorp: false,
						isSpecialPurpose: false,
					}),
				},
				userCharacters: {
					findMany: vi.fn().mockResolvedValue([
						{
							characterId: '1001',
							characterName: 'Alpha Main',
							corporationId: '1001',
						},
					]),
				},
			},
		}
		charStub = {
			getCharacterInfo: vi.fn(),
		}
		hrStub = {
			checkPermission: vi.fn().mockResolvedValue(false),
		}
		corpStub = {
			getCorporationInfo: vi.fn().mockResolvedValue({ ceoId: '1001' } as any),
			getDirectors: vi.fn().mockResolvedValue([]),
		}
		getCachedUserPermissionsMock.mockResolvedValue([])

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.EVE_CHARACTER_DATA) return charStub as any
			if (binding === env.HR) return hrStub as any
			if (binding === env.EVE_CORPORATION_DATA) return corpStub as any
			throw new Error('Unexpected binding')
		})
	})

	it('returns corp metadata and role without hitting the character fallback path', async () => {
		const app = createApp(makeUser(), dbStub)
		const response = await app.request('/api/corporations/1001/access', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			hasAccess: true,
			userRole: 'CEO',
			corporation: {
				corporationId: '1001',
				name: 'Alpha Corp',
				ticker: 'ALP',
				isMemberCorporation: true,
				isAltCorp: false,
				isSpecialPurpose: false,
			},
		})
		expect(charStub.getCharacterInfo).not.toHaveBeenCalled()
	})

	it('returns admin access for site admins without probing corp leadership', async () => {
		const app = createApp(makeUser({ is_admin: true }), dbStub)
		const response = await app.request('/api/corporations/1001/access', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			hasAccess: true,
			userRole: 'admin',
			corporation: {
				corporationId: '1001',
				name: 'Alpha Corp',
				ticker: 'ALP',
				isMemberCorporation: true,
				isAltCorp: false,
				isSpecialPurpose: false,
			},
		})
		expect(corpStub.getCorporationInfo).not.toHaveBeenCalled()
		expect(corpStub.getDirectors).not.toHaveBeenCalled()
		expect(charStub.getCharacterInfo).not.toHaveBeenCalled()
	})

	it('returns director access when a persisted character is on the director list', async () => {
		corpStub.getCorporationInfo.mockResolvedValue({ ceoId: '9999' } as any)
		corpStub.getDirectors.mockResolvedValue([{ characterId: '1001' }] as any)

		const app = createApp(makeUser(), dbStub)
		const response = await app.request('/api/corporations/1001/access', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			hasAccess: true,
			userRole: 'Director',
			corporation: {
				corporationId: '1001',
				name: 'Alpha Corp',
				ticker: 'ALP',
				isMemberCorporation: true,
				isAltCorp: false,
				isSpecialPurpose: false,
			},
		})
		expect(charStub.getCharacterInfo).not.toHaveBeenCalled()
	})

	it('returns HR admin access for member corporations', async () => {
		corpStub.getCorporationInfo.mockResolvedValue({ ceoId: '9999' } as any)
		corpStub.getDirectors.mockResolvedValue([] as any)
		dbStub.query.userCharacters.findMany.mockResolvedValue([
			{
				characterId: '2001',
				characterName: 'Alpha Other',
				corporationId: '1001',
			},
		])
		getCachedUserPermissionsMock.mockResolvedValue([])
		hrStub.checkPermission.mockResolvedValue(true)

		const app = createApp(makeUser(), dbStub)
		const response = await app.request('/api/corporations/1001/access', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			hasAccess: true,
			userRole: 'hr_admin',
			corporation: {
				corporationId: '1001',
				name: 'Alpha Corp',
				ticker: 'ALP',
				isMemberCorporation: true,
				isAltCorp: false,
				isSpecialPurpose: false,
			},
		})
		expect(charStub.getCharacterInfo).not.toHaveBeenCalled()
	})

	it('returns HR reviewer access for member corporations', async () => {
		corpStub.getCorporationInfo.mockResolvedValue({ ceoId: '9999' } as any)
		corpStub.getDirectors.mockResolvedValue([] as any)
		dbStub.query.userCharacters.findMany.mockResolvedValue([
			{
				characterId: '2001',
				characterName: 'Alpha Other',
				corporationId: '1001',
			},
		])
		hrStub.checkPermission.mockImplementation(
			async (_userId: string, _corporationId: string, requiredRole: string) =>
				requiredRole === 'hr_viewer' || requiredRole === 'hr_reviewer'
		)

		const app = createApp(makeUser(), dbStub)
		const response = await app.request('/api/corporations/1001/access', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			hasAccess: true,
			userRole: 'hr_reviewer',
			corporation: {
				corporationId: '1001',
				name: 'Alpha Corp',
				ticker: 'ALP',
				isMemberCorporation: true,
				isAltCorp: false,
				isSpecialPurpose: false,
			},
		})
		expect(charStub.getCharacterInfo).not.toHaveBeenCalled()
	})

	it('returns HR viewer access for auditors on member corporations', async () => {
		corpStub.getCorporationInfo.mockResolvedValue({ ceoId: '9999' } as any)
		corpStub.getDirectors.mockResolvedValue([] as any)
		dbStub.query.userCharacters.findMany.mockResolvedValue([
			{
				characterId: '2001',
				characterName: 'Alpha Other',
				corporationId: '1001',
			},
		])
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:hr:auditor' } as any])

		const app = createApp(makeUser(), dbStub)
		const response = await app.request('/api/corporations/1001/access', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			hasAccess: true,
			userRole: 'hr_viewer',
			corporation: {
				corporationId: '1001',
				name: 'Alpha Corp',
				ticker: 'ALP',
				isMemberCorporation: true,
				isAltCorp: false,
				isSpecialPurpose: false,
			},
		})
		expect(charStub.getCharacterInfo).not.toHaveBeenCalled()
		expect(getCachedUserPermissionsMock).toHaveBeenCalledWith(env, 'user-1')
	})

	it('returns corp metadata even when access is denied', async () => {
		dbStub.query.userCharacters.findMany.mockResolvedValue([
			{
				characterId: '2001',
				characterName: 'Bravo Alt',
				corporationId: '2001',
			},
		])
		corpStub.getCorporationInfo.mockResolvedValue({ ceoId: '9999' } as any)

		const app = createApp(makeUser(), dbStub)
		const response = await app.request('/api/corporations/1001/access', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			hasAccess: false,
			userRole: null,
			corporation: {
				corporationId: '1001',
				name: 'Alpha Corp',
				ticker: 'ALP',
				isMemberCorporation: true,
				isAltCorp: false,
				isSpecialPurpose: false,
			},
		})
		expect(charStub.getCharacterInfo).not.toHaveBeenCalled()
	})

	it('returns no corp access when the managed corporation row is missing', async () => {
		dbStub.query.managedCorporations.findFirst.mockResolvedValueOnce(null)

		const app = createApp(makeUser(), dbStub)
		const response = await app.request('/api/corporations/1001/access', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			hasAccess: false,
			userRole: null,
			corporation: null,
		})
		expect(corpStub.getCorporationInfo).not.toHaveBeenCalled()
		expect(corpStub.getDirectors).not.toHaveBeenCalled()
		expect(charStub.getCharacterInfo).not.toHaveBeenCalled()
	})
})
