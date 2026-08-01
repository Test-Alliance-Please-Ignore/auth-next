import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import usersRoutes from '../users'

import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

const getStubMock = vi.mocked(getStub)

function makeRpcResult<T extends object>(
	value: T
): { value: T; dispose: ReturnType<typeof vi.fn> } {
	const dispose = vi.fn()
	Object.defineProperty(value, Symbol.dispose, { value: dispose })
	return { value, dispose }
}

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

function createApp(opts: { user?: SessionUser; db?: any }) {
	const app = new Hono<{
		Bindings: any
		Variables: {
			user?: SessionUser
			db?: any
		}
	}>()

	app.use('*', async (c, next) => {
		if (opts.user) c.set('user', opts.user)
		if (opts.db) c.set('db', opts.db)
		await next()
	})

	app.route('/api/users', usersRoutes)
	return app
}

describe('users corporation access', () => {
	const env = {
		EVE_CHARACTER_DATA: { name: 'EVE_CHARACTER_DATA' },
		EVE_CORPORATION_DATA: { name: 'EVE_CORPORATION_DATA' },
		HR: { name: 'HR' },
		DATABASE_URL: 'postgresql://test',
	} as any

	let dbStub: {
		query: {
			managedCorporations: {
				findMany: ReturnType<typeof vi.fn>
			}
			userCharacters: {
				findMany: ReturnType<typeof vi.fn>
			}
			users: {
				findMany: ReturnType<typeof vi.fn>
			}
		}
	}
	let hrStub: {
		getUserHrCorporations: ReturnType<typeof vi.fn>
		getUserRoles: ReturnType<typeof vi.fn>
	}
	let charStub: {
		getCharacterInfo: ReturnType<typeof vi.fn>
	}
	let corpStub: {
		getCorporationInfo: ReturnType<typeof vi.fn>
		getDirectors: ReturnType<typeof vi.fn>
		getMembers: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.clearAllMocks()

		dbStub = {
			query: {
				managedCorporations: {
					findMany: vi.fn().mockResolvedValue([
						{
							corporationId: '1001',
							name: 'Alpha Corp',
							ticker: 'ALP',
							isMemberCorporation: true,
							isAltCorp: false,
							isSpecialPurpose: false,
						},
						{
							corporationId: '2001',
							name: 'Bravo Corp',
							ticker: 'BRV',
							isMemberCorporation: false,
							isAltCorp: true,
							isSpecialPurpose: false,
						},
						{
							corporationId: '3001',
							name: 'Charlie Corp',
							ticker: 'CHR',
							isMemberCorporation: false,
							isAltCorp: false,
							isSpecialPurpose: true,
						},
					]),
				},
				userCharacters: {
					findMany: vi.fn().mockResolvedValue([]),
				},
				users: {
					findMany: vi.fn().mockResolvedValue([]),
				},
			},
		}
		hrStub = {
			getUserHrCorporations: vi
				.fn()
				.mockResolvedValue(makeRpcResult(['1001', '2001', '3001']).value),
			getUserRoles: vi.fn().mockResolvedValue(
				makeRpcResult([
					{
						id: 'role-1',
						corporationId: '1001',
						role: 'hr_viewer',
						isActive: true,
					},
					{
						id: 'role-2',
						corporationId: '2001',
						role: 'hr_admin',
						isActive: true,
					},
				]).value
			),
		}
		charStub = {
			getCharacterInfo: vi.fn(),
		}
		corpStub = {
			getCorporationInfo: vi.fn().mockResolvedValue(makeRpcResult({ ceoId: '9999' }).value as any),
			getDirectors: vi.fn().mockResolvedValue(makeRpcResult([]).value),
			getMembers: vi.fn(),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			if (binding === env.EVE_CHARACTER_DATA) return charStub as any
			if (binding === env.EVE_CORPORATION_DATA) return corpStub as any
			throw new Error('Unexpected binding')
		})
	})

	it('returns only member corporation HR access for non-admin users', async () => {
		dbStub.query.userCharacters.findMany
			.mockResolvedValueOnce([
				{
					characterId: '2001',
					characterName: 'Alpha One',
					corporationId: '1001',
					status: 'active',
					hasValidToken: true,
				},
				{
					characterId: '2002',
					characterName: 'Alpha Two',
					corporationId: '1001',
					status: 'active',
					hasValidToken: true,
				},
				{
					characterId: '2003',
					characterName: 'Bravo One',
					corporationId: '2001',
					status: 'active',
					hasValidToken: true,
				},
			] as any)
			.mockResolvedValueOnce([
				{ characterId: '2001', userId: 'user-a', status: 'active', hasValidToken: true },
				{ characterId: '2002', userId: 'user-a', status: 'active', hasValidToken: true },
				{ characterId: '2003', userId: 'user-b', status: 'active', hasValidToken: true },
			] as any)
		corpStub.getMembers.mockResolvedValue(
			makeRpcResult([
				{ characterId: '2001' },
				{ characterId: '2002' },
				{ characterId: '2003' },
				{ characterId: '2004' },
			] as any).value
		)

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/users/corporation-access', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			hasAccess: true,
			corporations: [
				{
					corporationId: '1001',
					name: 'Alpha Corp',
					ticker: 'ALP',
					userRole: 'hr_viewer',
					characterId: null,
					characterName: null,
					isMemberCorporation: true,
					isAltCorp: false,
					isSpecialPurpose: false,
					memberCount: 4,
					linkedMemberCount: 2,
					unlinkedMemberCount: 1,
					validEsiKeyMemberCount: 3,
				},
			],
		})
		expect(hrStub.getUserHrCorporations).toHaveBeenCalledWith('user-1')
		expect(hrStub.getUserRoles).toHaveBeenCalledWith('user-1')
		expect(corpStub.getMembers).toHaveBeenCalledWith('1001')
		expect(charStub.getCharacterInfo).not.toHaveBeenCalled()
	})

	it('returns all managed corporations for site admins without character lookups', async () => {
		dbStub.query.userCharacters.findMany.mockResolvedValue([] as any)
		corpStub.getMembers
			.mockResolvedValueOnce(makeRpcResult([{ characterId: '1001' }] as any).value)
			.mockResolvedValueOnce(makeRpcResult([{ characterId: '2001' }] as any).value)
			.mockResolvedValueOnce(makeRpcResult([{ characterId: '3001' }] as any).value)

		const app = createApp({ user: makeUser({ is_admin: true }), db: dbStub })
		const res = await app.request('/api/users/corporation-access', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			hasAccess: true,
			corporations: [
				{
					corporationId: '1001',
					name: 'Alpha Corp',
					ticker: 'ALP',
					userRole: 'admin',
					characterId: null,
					characterName: null,
					isMemberCorporation: true,
					isAltCorp: false,
					isSpecialPurpose: false,
					memberCount: 1,
					linkedMemberCount: 0,
					unlinkedMemberCount: 1,
					validEsiKeyMemberCount: 0,
				},
				{
					corporationId: '2001',
					name: 'Bravo Corp',
					ticker: 'BRV',
					userRole: 'admin',
					characterId: null,
					characterName: null,
					isMemberCorporation: false,
					isAltCorp: true,
					isSpecialPurpose: false,
					memberCount: 1,
					linkedMemberCount: 0,
					unlinkedMemberCount: 1,
					validEsiKeyMemberCount: 0,
				},
				{
					corporationId: '3001',
					name: 'Charlie Corp',
					ticker: 'CHR',
					userRole: 'admin',
					characterId: null,
					characterName: null,
					isMemberCorporation: false,
					isAltCorp: false,
					isSpecialPurpose: true,
					memberCount: 1,
					linkedMemberCount: 0,
					unlinkedMemberCount: 1,
					validEsiKeyMemberCount: 0,
				},
			],
		})
		expect(charStub.getCharacterInfo).not.toHaveBeenCalled()
		expect(corpStub.getCorporationInfo).not.toHaveBeenCalled()
		expect(corpStub.getDirectors).not.toHaveBeenCalled()
		expect(corpStub.getMembers).toHaveBeenCalledTimes(3)
	})

	it('disposes RPC results when checking quick corporation access', async () => {
		dbStub.query.userCharacters.findMany.mockResolvedValue([
			{
				characterId: '2001',
				characterName: 'Alpha One',
				corporationId: '1001',
				status: 'active',
				hasValidToken: true,
			},
		] as any)
		const characterResult = makeRpcResult({ corporationId: '1001' })
		const corporationResult = makeRpcResult({ ceoId: '9999' })
		const directorsResult = makeRpcResult([])
		const hrCorporationsResult = makeRpcResult(['1001'])
		charStub.getCharacterInfo.mockResolvedValue(characterResult.value)
		corpStub.getCorporationInfo.mockResolvedValue(corporationResult.value)
		corpStub.getDirectors.mockResolvedValue(directorsResult.value)
		hrStub.getUserHrCorporations.mockResolvedValue(hrCorporationsResult.value)

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/users/has-corporation-access', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ hasAccess: true })
		expect(characterResult.dispose).toHaveBeenCalledOnce()
		expect(corporationResult.dispose).toHaveBeenCalledOnce()
		expect(directorsResult.dispose).toHaveBeenCalledOnce()
		expect(hrCorporationsResult.dispose).toHaveBeenCalledOnce()
	})
})
