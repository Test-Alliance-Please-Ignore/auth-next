import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import { getCachedUserPermissions } from '../../lib/groups-cache'
import corporationsRoutes from '../corporations'

import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
	withRpcResult: async <T, R>(rpcCall: Promise<T>, consume: (result: T) => R | Promise<R>) =>
		consume(await rpcCall),
}))

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: vi.fn(),
}))

vi.mock('../../services/core-rpc.service', () => ({}))

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
				findFirst: vi.fn().mockResolvedValue({
					id: 'target-user-1',
					mainCharacterId: '2001',
				}),
			},
		},
		update: vi.fn().mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue(undefined),
			}),
		}),
	}
}

function makeTokenStoreStub(options?: {
	resolveIds?: (ids: string[]) => Promise<Record<string, string>>
	validateToken?: (characterId: string) => Promise<{
		characterId: string
		isValid: boolean
		missingScopes: string[]
		refreshAttempted: boolean
		refreshSucceeded: boolean
		scopes: string[]
		status: string
		error?: string
	}>
}) {
	return {
		resolveIds:
			options?.resolveIds ??
			vi
				.fn()
				.mockImplementation(async (ids: string[]) =>
					Object.fromEntries(ids.map((id) => [id, id === '2001' ? 'Pilot One' : `Character ${id}`]))
				),
		validateToken:
			options?.validateToken ??
			vi.fn().mockImplementation(async (characterId: string) => ({
				characterId,
				isValid: true,
				missingScopes: [],
				refreshAttempted: false,
				refreshSucceeded: false,
				scopes: ['publicData'],
				status: 'valid',
			})),
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
		CORE: { name: 'CORE' },
		EVE_CHARACTER_DATA: { name: 'EVE_CHARACTER_DATA' },
		EVE_CORPORATION_DATA: { name: 'EVE_CORPORATION_DATA' },
		EVE_TOKEN_STORE: { name: 'EVE_TOKEN_STORE' },
		ESI_TYPE_RESOLVER: { name: 'ESI_TYPE_RESOLVER' },
		DISCORD: { name: 'DISCORD' },
		GROUPS: { name: 'GROUPS' },
		HR: { name: 'HR' },
	} as any

	let dbStub: ReturnType<typeof makeDbStub>
	let hrStub: {
		checkPermission: ReturnType<typeof vi.fn>
		checkCharactersBlacklisted: ReturnType<typeof vi.fn>
		getCorporationRoles: ReturnType<typeof vi.fn>
	}
	let discordStub: {
		searchCoreUsersByUsername: ReturnType<typeof vi.fn>
		getDiscordUserStatus: ReturnType<typeof vi.fn>
	}
	let groupsStub: {
		getUserMemberships: ReturnType<typeof vi.fn>
		getUserPermissionGrants: ReturnType<typeof vi.fn>
	}
	let corpStub: {
		getCorporationInfo: ReturnType<typeof vi.fn>
		getCoreData: ReturnType<typeof vi.fn>
		getMembers: ReturnType<typeof vi.fn>
		getDirectors: ReturnType<typeof vi.fn>
		getCorporationRoles: ReturnType<typeof vi.fn>
		fetchCoreData: ReturnType<typeof vi.fn>
	}
	let charStub: {
		getCharacterInfo: ReturnType<typeof vi.fn>
	}
	let tokenStoreStub: ReturnType<typeof makeTokenStoreStub>

	beforeEach(() => {
		vi.clearAllMocks()
		dbStub = makeDbStub()
		hrStub = {
			checkPermission: vi.fn().mockResolvedValue(false),
			checkCharactersBlacklisted: vi.fn().mockResolvedValue({}),
			getCorporationRoles: vi.fn().mockResolvedValue([]),
		}
		discordStub = {
			searchCoreUsersByUsername: vi.fn().mockResolvedValue([]),
			getDiscordUserStatus: vi.fn().mockResolvedValue(null),
		}
		groupsStub = {
			getUserMemberships: vi.fn().mockResolvedValue([]),
			getUserPermissionGrants: vi.fn().mockResolvedValue([]),
		}
		charStub = {
			getCharacterInfo: vi.fn().mockResolvedValue(null),
		}
		tokenStoreStub = makeTokenStoreStub()
		corpStub = {
			getCorporationInfo: vi.fn().mockResolvedValue({ ceoId: '9999', allianceId: null }),
			getMembers: vi
				.fn()
				.mockResolvedValue([
					{ characterId: '2001', updatedAt: new Date('2026-04-01T00:00:00.000Z') },
				]),
			getCorporationRoles: vi.fn().mockResolvedValue([]),
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
			if (binding === env.DISCORD) return discordStub as any
			if (binding === env.GROUPS) return groupsStub as any
			if (binding === env.EVE_CHARACTER_DATA) {
				return charStub as any
			}
			if (binding === env.EVE_CORPORATION_DATA) {
				return corpStub as any
			}
			if (binding === env.EVE_TOKEN_STORE || binding === env.ESI_TYPE_RESOLVER) {
				return tokenStoreStub as any
			}
			throw new Error('Unexpected binding')
		})
	})

	it('denies members access for non-auditor without corp/hr role', async () => {
		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request(
			'/api/corporations/1001/members?page=1&limit=25&sortField=role&sortOrder=asc',
			{},
			env
		)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({
			error:
				'Access denied. Corporation CEO, Director, site admin, HR role, or HR auditor permission required.',
		})
	})

	it('denies HR-only access for non-member corporations', async () => {
		dbStub.query.managedCorporations.findFirst.mockResolvedValue({
			corporationId: '2001',
			name: 'Bravo Corp',
			ticker: 'BRV',
			isActive: true,
			isMemberCorporation: false,
		} as any)
		hrStub.checkPermission.mockResolvedValue(true)

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/corporations/2001/members', {}, env)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({
			error:
				'Access denied. Corporation CEO, Director, site admin, HR role, or HR auditor permission required.',
		})
	})

	it('allows HR auditors to view a non-member corporation member account detail', async () => {
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
		dbStub.query.managedCorporations.findFirst.mockResolvedValue({
			corporationId: '2001',
			name: 'Bravo Corp',
			ticker: 'BRV',
			isActive: true,
			isMemberCorporation: false,
		} as any)
		dbStub.query.userCharacters.findMany.mockResolvedValue([
			{
				id: 'uc-1',
				userId: 'target-user-1',
				characterId: '2001',
				characterName: 'Pilot One',
				corporationId: null,
				corporationName: null,
				allianceId: null,
				allianceName: null,
				is_primary: true,
				hasValidToken: true,
				status: 'active',
				linkedAt: new Date('2026-04-01T00:00:00.000Z'),
				updatedAt: new Date('2026-04-01T00:00:00.000Z'),
				isDeleted: false,
			},
		] as any)
		corpStub.getCoreData.mockResolvedValue({
			members: [],
			memberTracking: [],
		})
		corpStub.getMembers.mockResolvedValue([
			{ characterId: '2001', updatedAt: new Date('2026-04-01T00:00:00.000Z') },
		])

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/corporations/2001/members/target-user-1', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({
			account: {
				accountId: 'target-user-1',
				isLinked: true,
				characters: [
					{
						authUserId: 'target-user-1',
						characterId: '2001',
					},
				],
			},
		})
	})

	it('denies corporation settings access for non-member corporation leadership', async () => {
		dbStub.query.managedCorporations.findFirst.mockResolvedValue({
			corporationId: '2001',
			name: 'Bravo Corp',
			ticker: 'BRV',
			isActive: true,
			isMemberCorporation: false,
		} as any)

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request(
			'/api/corporations/2001/settings',
			{
				method: 'PATCH',
				body: JSON.stringify({ isRecruiting: true }),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({
			error: 'Access denied. Corporation CEO, site admin, or HR admin required.',
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
				{ characterId: '2003', updatedAt: new Date('2026-04-01T00:00:00.000Z') },
				{ characterId: '2004', updatedAt: new Date('2026-04-01T00:00:00.000Z') },
				{ characterId: '2005', updatedAt: new Date('2026-04-01T00:00:00.000Z') },
			],
			memberTracking: [],
		})
		corpStub.getMembers.mockResolvedValue([
			{ characterId: '2001', updatedAt: new Date('2026-04-01T00:00:00.000Z') },
			{ characterId: '2002', updatedAt: new Date('2026-04-01T00:00:00.000Z') },
			{ characterId: '2003', updatedAt: new Date('2026-04-01T00:00:00.000Z') },
			{ characterId: '2004', updatedAt: new Date('2026-04-01T00:00:00.000Z') },
			{ characterId: '2005', updatedAt: new Date('2026-04-01T00:00:00.000Z') },
		])
		dbStub.query.userCharacters.findMany.mockResolvedValue([
			{
				characterId: '2001',
				userId: 'target-user-a',
				status: 'active',
				hasValidToken: true,
			},
			{
				characterId: '2002',
				userId: 'target-user-a',
				status: 'active',
				hasValidToken: true,
			},
			{
				characterId: '2003',
				userId: 'target-user-b',
				status: 'active',
				hasValidToken: true,
			},
			{
				characterId: '2004',
				userId: 'target-user-b',
				status: 'active',
				hasValidToken: false,
			},
		])
		dbStub.query.users.findMany.mockResolvedValue([
			{ id: 'target-user-a', mainCharacterId: '2001' },
			{ id: 'target-user-b', mainCharacterId: '2003' },
		] as any)
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			if (binding === env.EVE_CHARACTER_DATA) return charStub as any
			if (binding === env.EVE_CORPORATION_DATA) return corpStub as any
			if (binding === env.EVE_TOKEN_STORE || binding === env.ESI_TYPE_RESOLVER) {
				return makeTokenStoreStub({
					resolveIds: vi
						.fn()
						.mockImplementation(async (ids: string[]) =>
							Object.fromEntries(
								ids.map((id) => [
									id,
									id === '2001' ? 'Pilot One' : id === '2002' ? 'Pilot Two' : id,
								])
							)
						),
				}) as any
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
			summary: {
				total: number
				linked: number
				linkedUsers: number
				esiCoverage: {
					full: number
					partial: number
					none: number
					unlinked: number
					linkedUsers: number
				}
			}
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
			linked: 2,
			linkedUsers: 1,
			esiCoverage: {
				full: 1,
				partial: 1,
				none: 0,
				unlinked: 1,
				linkedUsers: 2,
			},
		})

		const mainsResponse = await app.request(
			'/api/corporations/1001/members?mainsOnly=true&sortField=name&sortOrder=asc',
			{},
			env
		)
		expect(mainsResponse.status).toBe(200)
		const mainsBody = (await mainsResponse.json()) as {
			items: Array<{ characterId: string; mainCharacterId?: string }>
			pagination: { totalItems: number }
		}
		expect(new Set(mainsBody.items.map((member) => member.characterId))).toEqual(
			new Set(['2001', '2003'])
		)
		expect(mainsBody.items.every((member) => member.characterId === member.mainCharacterId)).toBe(
			true
		)
		expect(mainsBody.pagination.totalItems).toBe(2)
	})

	it('sorts auth account rows by auth account id first and esi status second', async () => {
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
				{ characterId: '2003', updatedAt: new Date('2026-04-01T00:00:00.000Z') },
				{ characterId: '2004', updatedAt: new Date('2026-04-01T00:00:00.000Z') },
			],
			memberTracking: [],
		})
		dbStub.query.userCharacters.findMany.mockResolvedValue([
			{ characterId: '2001', userId: 'user-b', status: 'active', hasValidToken: true },
			{ characterId: '2002', userId: 'user-a', status: 'active', hasValidToken: false },
			{ characterId: '2003', userId: 'user-c', status: 'active', hasValidToken: null },
		])
		dbStub.query.users.findMany.mockResolvedValue([
			{ id: 'user-a', mainCharacterId: '3001' },
			{ id: 'user-b', mainCharacterId: '3002' },
			{ id: 'user-c', mainCharacterId: '3003' },
		] as any)
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			if (binding === env.EVE_CHARACTER_DATA) return charStub as any
			if (binding === env.EVE_CORPORATION_DATA) return corpStub as any
			if (binding === env.EVE_TOKEN_STORE || binding === env.ESI_TYPE_RESOLVER) {
				return makeTokenStoreStub({
					resolveIds: vi
						.fn()
						.mockImplementation(async (ids: string[]) =>
							Object.fromEntries(
								ids.map((id) => [
									id,
									id === '2001'
										? 'Zulu'
										: id === '2002'
											? 'Alpha'
											: id === '2003'
												? 'Echo'
												: 'Delta',
								])
							)
						),
				}) as any
			}
			throw new Error('Unexpected binding')
		})

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request(
			'/api/corporations/1001/members?sortField=auth&sortOrder=asc',
			{},
			env
		)

		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			items: Array<{ characterId: string }>
		}
		expect(body.items.map((member) => member.characterId)).toEqual(['2004', '2002', '2001', '2003'])
	})

	it('exports the full member list with auth account UUID and primary character columns', async () => {
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
		corpStub.getDirectors.mockResolvedValue([])
		hrStub.getCorporationRoles.mockResolvedValue([
			{ userId: 'target-user-1', role: 'hr_admin' },
		] as any)
		dbStub.query.userCharacters.findMany.mockResolvedValue([
			{
				characterId: '2001',
				userId: 'target-user-1',
				status: 'active',
				hasValidToken: true,
			},
		])
		dbStub.query.users.findMany.mockResolvedValue([
			{
				id: 'target-user-1',
				mainCharacterId: '3001',
				discordUserId: 'discord-user-1',
			},
		] as any)
		discordStub.getDiscordUserStatus.mockResolvedValue({
			username: 'PilotDiscord',
		} as any)
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			if (binding === env.DISCORD) return discordStub as any
			if (binding === env.EVE_CHARACTER_DATA) return charStub as any
			if (binding === env.EVE_CORPORATION_DATA) return corpStub as any
			if (binding === env.EVE_TOKEN_STORE || binding === env.ESI_TYPE_RESOLVER) {
				return makeTokenStoreStub({
					resolveIds: vi
						.fn()
						.mockImplementation(async (ids: string[]) =>
							Object.fromEntries(
								ids.map((id) => [
									id,
									id === '2001' ? 'Pilot One' : id === '2002' ? 'Pilot Two' : 'Captain Main',
								])
							)
						),
				}) as any
			}
			throw new Error('Unexpected binding')
		})

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request(
			'/api/corporations/1001/members/export?page=1&limit=1&sortField=role&sortOrder=asc',
			{},
			env
		)

		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toContain('text/csv')
		expect(res.headers.get('content-disposition')).toContain('attachment;')

		const csv = await res.text()
		const lines = csv.trim().split('\n')
		expect(lines[0]).toBe(
			'Character Name,Character ID,Role,HR Role,ESI Status,Auth Account UUID,Auth Account Primary Character Name,Auth Account Primary Character ID,Discord User ID,Discord Username,Activity Status,Last Login,Join Date'
		)
		expect(lines).toHaveLength(3)
		expect(lines[1]).toContain(
			'Pilot One,2001,Member,hr_admin,ESI Valid,target-user-1,Captain Main,3001,discord-user-1,PilotDiscord,unknown,Never,2026-04-01T00:00:00.000Z'
		)
		expect(lines[2]).toContain(
			'Pilot Two,2002,Member,,Unlinked,,,,,,unknown,Never,2026-04-01T00:00:00.000Z'
		)
		expect(lines[0]).not.toContain('Alliance')
		expect(lines[0]).not.toContain('Location')
	})

	it('supports authFilter=linked_invalid', async () => {
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
			{ characterId: '2001', userId: 'target-user-1', status: 'active', hasValidToken: true },
			{ characterId: '2002', userId: 'target-user-2', status: 'active', hasValidToken: false },
		])
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			if (binding === env.EVE_CHARACTER_DATA) return charStub as any
			if (binding === env.EVE_CORPORATION_DATA) return corpStub as any
			if (binding === env.EVE_TOKEN_STORE || binding === env.ESI_TYPE_RESOLVER) {
				return makeTokenStoreStub({
					resolveIds: vi
						.fn()
						.mockImplementation(async (ids: string[]) =>
							Object.fromEntries(
								ids.map((id) => [
									id,
									id === '2001' ? 'Pilot One' : id === '2002' ? 'Pilot Two' : id,
								])
							)
						),
					validateToken: vi.fn().mockImplementation(async (characterId: string) => ({
						characterId,
						isValid: characterId !== '2002',
						missingScopes: [],
						refreshAttempted: false,
						refreshSucceeded: false,
						scopes: ['publicData'],
						status: characterId === '2002' ? 'invalid_token' : 'valid',
					})),
				}) as any
			}
			throw new Error('Unexpected binding')
		})

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request(
			'/api/corporations/1001/members?authFilter=linked_invalid',
			{},
			env
		)

		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			items: Array<{ characterId: string; hasValidToken?: boolean | null }>
			pagination: { totalItems: number }
			summary: { linkedUsers: number }
		}
		expect(body.pagination.totalItems).toBe(1)
		expect(body.items).toHaveLength(1)
		expect(body.items[0]).toMatchObject({
			characterId: '2002',
			hasValidToken: false,
		})
		expect(body.summary.linkedUsers).toBe(1)
	})

	it('filters member list by ESI coverage partial and sorts by auth account', async () => {
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

		dbStub.query.managedCorporations.findFirst.mockResolvedValue({
			corporationId: '1001',
			name: 'Alpha Corp',
			ticker: 'ALP',
			isActive: true,
			isMemberCorporation: true,
		} as any)
		corpStub.getCoreData.mockResolvedValue({
			members: [
				{ characterId: '2001', updatedAt: new Date('2026-04-01T00:00:00.000Z') },
				{ characterId: '2002', updatedAt: new Date('2026-04-01T00:00:00.000Z') },
				{ characterId: '2003', updatedAt: new Date('2026-04-01T00:00:00.000Z') },
				{ characterId: '2004', updatedAt: new Date('2026-04-01T00:00:00.000Z') },
			],
			memberTracking: [],
		})
		dbStub.query.userCharacters.findMany.mockResolvedValue([
			{ characterId: '2001', userId: 'user-a', status: 'active', hasValidToken: true },
			{ characterId: '2002', userId: 'user-a', status: 'active', hasValidToken: false },
			{ characterId: '2003', userId: 'user-b', status: 'active', hasValidToken: true },
			{ characterId: '2004', userId: 'user-b', status: 'active', hasValidToken: false },
		])
		dbStub.query.users.findMany.mockResolvedValue([
			{ id: 'user-a', mainCharacterId: '3001' },
			{ id: 'user-b', mainCharacterId: '3002' },
		] as any)
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			if (binding === env.EVE_CHARACTER_DATA) return charStub as any
			if (binding === env.EVE_CORPORATION_DATA) return corpStub as any
			if (binding === env.EVE_TOKEN_STORE || binding === env.ESI_TYPE_RESOLVER) {
				return makeTokenStoreStub({
					resolveIds: vi
						.fn()
						.mockImplementation(async (ids: string[]) =>
							Object.fromEntries(
								ids.map((id) => [
									id,
									id === '2001'
										? 'Alpha One'
										: id === '2002'
											? 'Alpha Two'
											: id === '2003'
												? 'Beta Three'
												: id === '2004'
													? 'Beta Four'
													: `Character ${id}`,
								])
							)
						),
				}) as any
			}
			throw new Error('Unexpected binding')
		})

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request(
			'/api/corporations/1001/members?coverageFilter=partial&sortField=auth&sortOrder=asc',
			{},
			env
		)

		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			items: Array<{ characterId: string; authUserId?: string | null }>
			pagination: { totalItems: number }
			summary: { esiCoverage: { full: number; partial: number; none: number; unlinked: number } }
		}
		expect(body.pagination.totalItems).toBe(4)
		expect(body.items.map((item) => item.characterId)).toEqual(['2001', '2002', '2003', '2004'])
		expect(body.items.slice(0, 2).every((item) => item.authUserId === 'user-a')).toBe(true)
		expect(body.items.slice(2).every((item) => item.authUserId === 'user-b')).toBe(true)
		expect(body.summary.esiCoverage).toMatchObject({
			full: 0,
			partial: 2,
			none: 0,
			unlinked: 0,
		})
	})

	it('reads persisted linked token state without live validation', async () => {
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

		dbStub.query.managedCorporations.findFirst.mockResolvedValue({
			corporationId: '9001',
			name: 'Cacheless Corp',
			ticker: 'CCH',
			isActive: true,
			isMemberCorporation: true,
		} as any)
		dbStub.query.userCharacters.findMany.mockResolvedValue([
			{ characterId: '2001', userId: 'target-user-1', status: 'active', hasValidToken: true },
		])
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			if (binding === env.EVE_CHARACTER_DATA) return charStub as any
			if (binding === env.EVE_CORPORATION_DATA) return corpStub as any
			if (binding === env.EVE_TOKEN_STORE || binding === env.ESI_TYPE_RESOLVER) {
				return makeTokenStoreStub({
					validateToken: vi.fn().mockResolvedValue({
						characterId: '2001',
						isValid: false,
						missingScopes: [],
						refreshAttempted: false,
						refreshSucceeded: false,
						scopes: ['publicData'],
						status: 'invalid_token',
						error: 'Token invalid',
					}),
				}) as any
			}
			throw new Error('Unexpected binding')
		})

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request(
			'/api/corporations/9001/members?page=1&limit=25&sortField=role&sortOrder=asc',
			{},
			env
		)

		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			items: Array<{ characterId: string; hasValidToken?: boolean | null }>
		}
		expect(body.items[0]).toMatchObject({
			characterId: '2001',
			hasValidToken: true,
		})
		expect(dbStub.update).not.toHaveBeenCalled()
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
		corpStub.getDirectors.mockResolvedValue([
			{ characterId: '1001', characterName: 'Director Pilot' },
		])

		const res = await app.request('/api/corporations/1001/members/refresh', { method: 'POST' }, env)

		expect(res.status).toBe(200)
		expect(corpStub.fetchCoreData).toHaveBeenCalledWith('1001', true)
	})
})
