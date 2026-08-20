import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'
import { getPublicEsiInstance } from '@repo/esi'

import { getCachedUserPermissions } from '../../lib/groups-cache'
import hrRoutes from '../hr'

import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
	withRpcResult: async <T, R>(rpcCall: Promise<T>, consume: (result: T) => R | Promise<R>) =>
		consume(await rpcCall),
}))

vi.mock('@repo/esi', () => ({
	getPublicEsiInstance: vi.fn(),
}))

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: vi.fn(),
}))

const getStubMock = vi.mocked(getStub)
const getPublicEsiInstanceMock = vi.mocked(getPublicEsiInstance)
const getCachedUserPermissionsMock = vi.mocked(getCachedUserPermissions)
const { searchUsersForHrAccessMock } = vi.hoisted(() => ({
	searchUsersForHrAccessMock: vi.fn(),
}))

vi.mock('../../services/core-rpc.service', () => ({
	CoreRpcService: class {
		searchUsersForHrAccess = searchUsersForHrAccessMock
	},
}))

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: '1001',
		sessionId: 'session-1',
		characters: [
			{
				id: 'uc-1',
				characterOwnerHash: 'owner-1',
				characterId: '1001',
				characterName: 'Main Pilot',
				is_primary: true,
				hasValidToken: true,
			},
		],
		is_admin: false,
		roles: [],
		discordUserId: null,
		...overrides,
	}
}

function makeHrStub() {
	return {
		getUserRoles: vi.fn().mockResolvedValue([]),
		getUserHrCorporations: vi.fn().mockResolvedValue([]),
		isUserBlacklisted: vi.fn().mockResolvedValue(false),
		checkPermission: vi.fn().mockResolvedValue(false),
		checkCharactersBlacklisted: vi.fn().mockResolvedValue({}),
		checkBlacklistTargets: vi.fn().mockResolvedValue([]),
		listApplications: vi.fn().mockResolvedValue([]),
		listApplicationsPaged: vi.fn().mockResolvedValue({
			items: [],
			total: 0,
			limit: 10,
			offset: 0,
			counts: {
				pending: 0,
				under_review: 0,
				accepted: 0,
				rejected: 0,
				withdrawn: 0,
			},
		}),
		getApplicationCountsByCorporation: vi.fn().mockResolvedValue([]),
		getApplication: vi.fn().mockResolvedValue({
			id: 'app-1',
			userId: 'target-user-1',
			characterId: '2001',
			characterName: 'Target Pilot',
			corporationId: '1001',
			corporationName: 'Alpha Corp',
			applicationText: 'Test application',
			status: 'pending',
			reviewedBy: null,
			reviewedAt: null,
			reviewNotes: null,
			altCharacterIds: [],
			recommendations: [],
			recommendationCount: 0,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}),
		listCorpApplicationsForRecommendation: vi.fn().mockResolvedValue([]),
		getApplicationForRecommender: vi.fn().mockResolvedValue({
			id: 'app-1',
			corporationId: '1001',
			characterId: '2001',
			characterName: 'Target Pilot',
			applicationText: 'Test application',
			status: 'pending',
			createdAt: new Date().toISOString(),
			recommendations: [],
			recommendationCount: 0,
			userRecommendation: null,
		}),
		addRecommendation: vi.fn().mockResolvedValue({
			id: 'rec-1',
			applicationId: 'app-1',
			userId: 'user-1',
			characterId: '1001',
			characterName: 'Main Pilot',
			recommendationText: 'Looks good to me',
			sentiment: 'positive',
			isPublic: false,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}),
		listMessages: vi.fn().mockResolvedValue([]),
		getMessageCount: vi.fn().mockResolvedValue(0),
		listApplicationStaffNotes: vi.fn().mockResolvedValue([
			{
				id: 'staff-note-1',
				applicationId: 'app-1',
				authorId: 'user-1',
				authorCharacterId: '1001',
				authorCharacterName: 'Main Pilot',
				noteText: 'Check history',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			},
		]),
		addApplicationStaffNote: vi.fn().mockResolvedValue({
			id: 'staff-note-2',
			applicationId: 'app-1',
			authorId: 'user-1',
			authorCharacterId: '1001',
			authorCharacterName: 'Main Pilot',
			noteText: 'New note',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}),
		updateApplicationStaffNote: vi.fn().mockResolvedValue({
			id: 'staff-note-1',
			applicationId: 'app-1',
			authorId: 'user-1',
			authorCharacterId: '1001',
			authorCharacterName: 'Main Pilot',
			noteText: 'Updated note',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}),
		deleteApplicationStaffNote: vi.fn().mockResolvedValue(undefined),
		grantRole: vi.fn().mockResolvedValue({
			id: 'role-1',
			corporationId: '1001',
			userId: 'target-user-1',
			characterId: '2001',
			characterName: 'Target Pilot',
			role: 'hr_reviewer',
			grantedBy: 'user-1',
			grantedAt: new Date().toISOString(),
			expiresAt: null,
			isActive: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}),
		getRole: vi.fn().mockResolvedValue({
			id: 'role-1',
			corporationId: '1001',
			userId: 'target-user-1',
			characterId: '2001',
			characterName: 'Target Pilot',
			role: 'hr_reviewer',
			grantedBy: 'user-1',
			grantedAt: new Date().toISOString(),
			expiresAt: null,
			isActive: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}),
		revokeRole: vi.fn().mockResolvedValue(undefined),
		createNote: vi.fn().mockResolvedValue({
			id: 'note-1',
			subjectUserId: 'target-1',
			subjectCharacterId: null,
			authorId: 'user-1',
			authorCharacterId: '1001',
			authorCharacterName: 'Main Pilot',
			noteText: 'Test note',
			noteType: 'general',
			priority: 'normal',
			metadata: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		}),
	}
}

function makeResolverStub() {
	return {
		resolveIds: vi.fn().mockResolvedValue({}),
	}
}

function makeEsiStub() {
	return {
		fetchCorporationPublicInfo: vi.fn().mockResolvedValue({
			ceo_id: 'ceo-character-id',
		}),
	}
}

function makeDbStub() {
	const selectResult = [{ discordUserId: null }]
	const selectChain = {
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		limit: vi.fn().mockResolvedValue(selectResult),
	}

	return {
		select: vi.fn().mockReturnValue(selectChain),
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
			users: {
				findMany: vi.fn().mockResolvedValue([]),
			},
			userCharacters: {
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
		if (opts.user) {
			c.set('user', opts.user)
		}
		if (opts.db) {
			c.set('db', opts.db)
		}
		await next()
	})

	app.route('/api/hr', hrRoutes)
	return app
}

describe('hr route access matrix', () => {
	const env = {
		HR: { name: 'HR' },
		ESI_TYPE_RESOLVER: { name: 'ESI_TYPE_RESOLVER' },
		ESI: { name: 'ESI' },
		CORE: {
			getCharacterOwner: vi.fn().mockResolvedValue({ userId: 'target-user-1' }),
			getUserCharacters: vi.fn().mockResolvedValue([]),
		},
		ADMIN: {
			searchUsers: vi.fn().mockResolvedValue({ users: [], total: 0 }),
			getUserDetails: vi.fn().mockResolvedValue(null),
		},
		LEGACY: {
			listHistory: vi.fn().mockResolvedValue({
				items: [],
				pagination: { total: 0, page: 1, pageSize: 25 },
			}),
			getHistoryApplication: vi.fn().mockResolvedValue(null),
		},
	} as any

	let hrStub: ReturnType<typeof makeHrStub>
	let resolverStub: ReturnType<typeof makeResolverStub>
	let esiStub: ReturnType<typeof makeEsiStub>
	let dbStub: ReturnType<typeof makeDbStub>

	beforeEach(() => {
		vi.clearAllMocks()
		hrStub = makeHrStub()
		resolverStub = makeResolverStub()
		esiStub = makeEsiStub()
		dbStub = makeDbStub()

		getCachedUserPermissionsMock.mockResolvedValue([])
		searchUsersForHrAccessMock.mockResolvedValue({ users: [], total: 0, limit: 10, offset: 0 })
		getPublicEsiInstanceMock.mockReturnValue(esiStub as any)
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			if (binding === env.ESI_TYPE_RESOLVER) return resolverStub as any
			if (binding === env.ESI) return esiStub as any
			if (binding === env.CORE) return env.CORE as any
			if (binding === env.LEGACY) return env.LEGACY as any
			throw new Error('Unexpected binding')
		})
	})

	it('returns 401 for unauthenticated access to /roles/check', async () => {
		const app = createApp({ db: dbStub })
		const res = await app.request('/api/hr/roles/check?corporationId=1001', {}, env)
		expect(res.status).toBe(401)
	})

	it('treats hr auditor as hr_viewer on /roles/check when no corp role exists', async () => {
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
		const res = await app.request('/api/hr/roles/check?corporationId=1001', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ hasPermission: true, currentRole: 'hr_viewer' })
	})

	it('returns no permission on /roles/check for non-auditor with no roles', async () => {
		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/hr/roles/check?corporationId=1001', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ hasPermission: false, currentRole: null })
	})

	it('returns admin bypass on /roles/check for site admin', async () => {
		const app = createApp({ user: makeUser({ is_admin: true }), db: dbStub })
		const res = await app.request('/api/hr/roles/check?corporationId=1001', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ hasPermission: true, currentRole: 'hr_admin' })
	})

	it('returns all active corporations as hr_viewer for auditor on /corporations', async () => {
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
		const res = await app.request('/api/hr/corporations', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual([
			{
				corporationId: '1001',
				name: 'Alpha Corp',
				ticker: 'ALP',
				isMemberCorporation: true,
				isAltCorp: false,
				isSpecialPurpose: false,
				currentRole: 'hr_viewer',
			},
			{
				corporationId: '2001',
				name: 'Bravo Corp',
				ticker: 'BRV',
				isMemberCorporation: false,
				isAltCorp: true,
				isSpecialPurpose: false,
				currentRole: 'hr_viewer',
			},
			{
				corporationId: '3001',
				name: 'Charlie Corp',
				ticker: 'CHR',
				isMemberCorporation: false,
				isAltCorp: false,
				isSpecialPurpose: true,
				currentRole: 'hr_viewer',
			},
		])
	})

	it('returns all active corporations as hr_admin for site admin on /corporations', async () => {
		const app = createApp({ user: makeUser({ is_admin: true }), db: dbStub })
		const res = await app.request('/api/hr/corporations', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual([
			{
				corporationId: '1001',
				name: 'Alpha Corp',
				ticker: 'ALP',
				isMemberCorporation: true,
				isAltCorp: false,
				isSpecialPurpose: false,
				currentRole: 'hr_admin',
			},
			{
				corporationId: '2001',
				name: 'Bravo Corp',
				ticker: 'BRV',
				isMemberCorporation: false,
				isAltCorp: true,
				isSpecialPurpose: false,
				currentRole: 'hr_admin',
			},
			{
				corporationId: '3001',
				name: 'Charlie Corp',
				ticker: 'CHR',
				isMemberCorporation: false,
				isAltCorp: false,
				isSpecialPurpose: true,
				currentRole: 'hr_admin',
			},
		])
	})

	it('returns only member corporations for non-admin non-auditor users on /corporations', async () => {
		dbStub.query.managedCorporations.findMany.mockResolvedValue([
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
		])
		hrStub.getUserHrCorporations.mockResolvedValue(['1001', '2001', '3001'])
		hrStub.getUserRoles.mockResolvedValue([
			{
				id: 'role-viewer',
				corporationId: '1001',
				role: 'hr_viewer',
				isActive: true,
			},
			{
				id: 'role-reviewer',
				corporationId: '2001',
				role: 'hr_reviewer',
				isActive: true,
			},
			{
				id: 'role-admin-inactive',
				corporationId: '2001',
				role: 'hr_admin',
				isActive: false,
			},
		] as any)

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/hr/corporations', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual([
			{
				corporationId: '1001',
				name: 'Alpha Corp',
				ticker: 'ALP',
				isMemberCorporation: true,
				isAltCorp: false,
				isSpecialPurpose: false,
				currentRole: 'hr_viewer',
			},
			{
				corporationId: '2001',
				name: 'Bravo Corp',
				ticker: 'BRV',
				isMemberCorporation: false,
				isAltCorp: true,
				isSpecialPurpose: false,
				currentRole: 'hr_reviewer',
			},
			{
				corporationId: '3001',
				name: 'Charlie Corp',
				ticker: 'CHR',
				isMemberCorporation: false,
				isAltCorp: false,
				isSpecialPurpose: true,
				currentRole: 'hr_admin',
			},
		])
		expect(hrStub.getUserRoles).toHaveBeenCalledTimes(1)
		expect(hrStub.getUserRoles).toHaveBeenCalledWith('user-1')
		expect(hrStub.getUserRoles).not.toHaveBeenCalledWith('user-1', expect.any(String))
	})

	it('passes auditor=true into listApplications for auditors', async () => {
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
		const res = await app.request('/api/hr/applications?corporationId=1001', {}, env)

		expect(res.status).toBe(200)
		expect(hrStub.listApplications).toHaveBeenCalledWith(
			expect.objectContaining({ corporationId: '1001' }),
			'user-1',
			{ isAdmin: false, isAuditor: true }
		)
	})

	it('uses one grouped application-count request for auditor-visible member corporations', async () => {
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
		hrStub.getApplicationCountsByCorporation.mockResolvedValue([
			{ corporationId: '1001', pending: 2, underReview: 1 },
		])
		dbStub.query.managedCorporations.findMany.mockResolvedValue([
			{
				corporationId: '1001',
				isActive: true,
				isMemberCorporation: true,
			},
		] as any)

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/hr/applications/counts', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			corporations: [{ corporationId: '1001', pending: 2, underReview: 1 }],
		})
		expect(hrStub.getApplicationCountsByCorporation).toHaveBeenCalledTimes(1)
		expect(hrStub.getApplicationCountsByCorporation).toHaveBeenCalledWith(['1001'], 'user-1', {
			isAdmin: false,
			isAuditor: true,
		})
	})

	it('passes only active member corporations to the HR authorization boundary', async () => {
		hrStub.getUserHrCorporations.mockResolvedValue(['1001', '2001'])
		dbStub.query.managedCorporations.findMany.mockResolvedValue([
			{
				corporationId: '1001',
				isActive: true,
				isMemberCorporation: true,
			},
		] as any)

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/hr/applications/counts', {}, env)

		expect(res.status).toBe(200)
		expect(hrStub.getApplicationCountsByCorporation).toHaveBeenCalledWith(['1001'], 'user-1', {
			isAdmin: false,
			isAuditor: false,
		})
	})

	it('passes auditor=true into listApplicationsPaged for auditors', async () => {
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
		const res = await app.request(
			'/api/hr/applications/paged?corporationId=1001&limit=10&offset=0',
			{},
			env
		)

		expect(res.status).toBe(200)
		expect(hrStub.listApplicationsPaged).toHaveBeenCalledWith(
			expect.objectContaining({ corporationId: '1001', limit: 10, offset: 0 }),
			'user-1',
			{ isAdmin: false, isAuditor: true }
		)
	})

	it('denies /applications/paged for non-member corporations', async () => {
		dbStub.query.managedCorporations.findMany.mockResolvedValue([
			{
				corporationId: '2001',
				name: 'Bravo Corp',
				ticker: 'BRV',
				isMemberCorporation: false,
				isAltCorp: true,
				isSpecialPurpose: false,
			},
		])
		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request(
			'/api/hr/applications/paged?corporationId=2001&limit=10&offset=0',
			{},
			env
		)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({
			error: 'Access denied. HR tools are only available for member corporations.',
		})
		expect(hrStub.listApplicationsPaged).not.toHaveBeenCalled()
	})

	it('allows corp-user application history queries even for non-member corporations', async () => {
		dbStub.query.managedCorporations.findMany.mockResolvedValue([
			{
				corporationId: '2001',
				name: 'Bravo Corp',
				ticker: 'BRV',
				isMemberCorporation: false,
				isAltCorp: true,
				isSpecialPurpose: false,
			},
		])

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request(
			'/api/hr/applications?corporationId=2001&userId=target-user-1',
			{},
			env
		)

		expect(res.status).toBe(200)
		expect(hrStub.listApplications).toHaveBeenCalledWith(
			expect.objectContaining({ corporationId: '2001', userId: 'target-user-1' }),
			'user-1',
			{ isAdmin: false, isAuditor: false }
		)
	})

	it('passes admin=true into listApplicationsPaged for site admins', async () => {
		const app = createApp({ user: makeUser({ is_admin: true }), db: dbStub })
		const res = await app.request(
			'/api/hr/applications/paged?corporationId=1001&limit=10&offset=0',
			{},
			env
		)

		expect(res.status).toBe(200)
		expect(hrStub.listApplicationsPaged).toHaveBeenCalledWith(
			expect.objectContaining({ corporationId: '1001', limit: 10, offset: 0 }),
			'user-1',
			{ isAdmin: true, isAuditor: false }
		)
	})

	it('allows CEO path to reach listApplicationsPaged with standard access flags', async () => {
		const ceoUser = makeUser({
			characters: [
				{
					id: 'uc-ceo',
					characterOwnerHash: 'owner-ceo',
					characterId: 'ceo-character-id',
					characterName: 'CEO Pilot',
					is_primary: true,
					hasValidToken: true,
				},
			],
		})
		const app = createApp({ user: ceoUser, db: dbStub })
		const res = await app.request(
			'/api/hr/applications/paged?corporationId=1001&limit=10&offset=0',
			{},
			env
		)

		expect(res.status).toBe(200)
		expect(hrStub.listApplicationsPaged).toHaveBeenCalledWith(
			expect.objectContaining({ corporationId: '1001', limit: 10, offset: 0 }),
			'user-1',
			{ isAdmin: false, isAuditor: false }
		)
	})

	it('allows /applications/:id read for auditor and passes elevated access flag', async () => {
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
		const res = await app.request('/api/hr/applications/app-1', {}, env)

		expect(res.status).toBe(200)
		expect(hrStub.getApplication).toHaveBeenCalledWith('app-1', 'user-1', {
			isAdmin: false,
			isAuditor: true,
		})
	})

	it('allows attached corp members to discover, view, and submit recommendations for member corporations', async () => {
		dbStub.query.userCharacters.findMany.mockResolvedValue([
			{
				corporationId: '1001',
			},
		] as any)

		const app = createApp({ user: makeUser(), db: dbStub })

		const pendingRes = await app.request('/api/hr/recommendations/pending', {}, env)
		expect(pendingRes.status).toBe(200)
		expect(hrStub.listCorpApplicationsForRecommendation).toHaveBeenCalledWith(['1001'], 'user-1')

		const detailRes = await app.request('/api/hr/recommendations/applications/app-1', {}, env)
		expect(detailRes.status).toBe(200)
		expect(hrStub.getApplicationForRecommender).toHaveBeenCalledWith('app-1', 'user-1', ['1001'], {
			isAdmin: false,
			isAuditor: false,
		})

		const submitRes = await app.request(
			'/api/hr/applications/app-1/recommendations',
			{
				method: 'POST',
				body: JSON.stringify({
					characterId: '1001',
					recommendationText: 'Looks good to me',
					sentiment: 'positive',
					isPublic: false,
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(submitRes.status).toBe(201)
		expect(hrStub.addRecommendation).toHaveBeenCalledWith(
			'app-1',
			'user-1',
			'1001',
			'Main Pilot',
			'Looks good to me',
			'positive',
			false
		)
	})

	it('denies recommendation access when the user is not attached to the target corporation', async () => {
		dbStub.query.userCharacters.findMany.mockResolvedValue([
			{
				corporationId: '2001',
			},
		] as any)
		dbStub.query.managedCorporations.findMany.mockResolvedValue([])
		hrStub.getApplicationForRecommender.mockResolvedValue({
			id: 'app-2',
			corporationId: '2001',
			characterId: '2002',
			characterName: 'Target Pilot',
			applicationText: 'Test application',
			status: 'pending',
			createdAt: new Date().toISOString(),
			recommendations: [],
			recommendationCount: 0,
			userRecommendation: null,
		})

		const app = createApp({ user: makeUser(), db: dbStub })

		const pendingRes = await app.request('/api/hr/recommendations/pending', {}, env)
		expect(pendingRes.status).toBe(200)
		expect(await pendingRes.json()).toEqual([])

		const detailRes = await app.request('/api/hr/recommendations/applications/app-2', {}, env)
		expect(detailRes.status).toBe(403)
		expect(await detailRes.json()).toEqual({
			error:
				'Access denied. Recommendations are only available for member corporations you are attached to.',
		})

		const submitRes = await app.request(
			'/api/hr/applications/app-2/recommendations',
			{
				method: 'POST',
				body: JSON.stringify({
					characterId: '1001',
					recommendationText: 'Looks good to me',
					sentiment: 'positive',
					isPublic: false,
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(submitRes.status).toBe(403)
		expect(await submitRes.json()).toEqual({
			error:
				'Access denied. Recommendations are only available for member corporations you are attached to.',
		})
		expect(hrStub.addRecommendation).not.toHaveBeenCalled()
	})

	it('allows an HR auditor to recommend against a member corporation without a corp attachment', async () => {
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
		dbStub.query.userCharacters.findMany.mockResolvedValue([] as any)
		hrStub.getApplicationForRecommender.mockResolvedValue({
			id: 'app-1',
			corporationId: '1001',
			characterId: '2001',
			characterName: 'Target Pilot',
			applicationText: 'Test application',
			status: 'pending',
			createdAt: new Date().toISOString(),
			recommendations: [],
			recommendationCount: 0,
			userRecommendation: null,
		})

		const app = createApp({ user: makeUser(), db: dbStub })

		const detailRes = await app.request('/api/hr/recommendations/applications/app-1', {}, env)
		expect(detailRes.status).toBe(200)
		expect(hrStub.getApplicationForRecommender).toHaveBeenCalledWith('app-1', 'user-1', [], {
			isAdmin: false,
			isAuditor: true,
		})

		const submitRes = await app.request(
			'/api/hr/applications/app-1/recommendations',
			{
				method: 'POST',
				body: JSON.stringify({
					characterId: '1001',
					recommendationText: 'Looks good to me',
					sentiment: 'positive',
					isPublic: false,
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(submitRes.status).toBe(201)
		expect(hrStub.addRecommendation).toHaveBeenCalledWith(
			'app-1',
			'user-1',
			'1001',
			'Main Pilot',
			'Looks good to me',
			'positive',
			false
		)
	})

	it('denies /applications/:id read for non-member corporations', async () => {
		dbStub.query.managedCorporations.findMany.mockResolvedValue([
			{
				corporationId: '2001',
				name: 'Bravo Corp',
				ticker: 'BRV',
				isMemberCorporation: false,
				isAltCorp: true,
				isSpecialPurpose: false,
			},
		])

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/hr/applications/app-1', {}, env)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({
			error: 'Access denied. HR tools are only available for member corporations.',
		})
		expect(hrStub.getApplication).toHaveBeenCalledTimes(1)
	})

	it('allows /applications/:id/messages read for auditor', async () => {
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
		const res = await app.request('/api/hr/applications/app-1/messages', {}, env)

		expect(res.status).toBe(200)
		expect(hrStub.listMessages).toHaveBeenCalledWith('app-1', 'user-1', {
			isAdmin: false,
			isAuditor: true,
		})
	})

	it('allows /applications/:id/messages/count read for auditor', async () => {
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
		const res = await app.request('/api/hr/applications/app-1/messages/count', {}, env)

		expect(res.status).toBe(200)
		expect(hrStub.getMessageCount).toHaveBeenCalledWith('app-1', 'user-1', {
			isAdmin: false,
			isAuditor: true,
		})
	})

	it('allows /applications/:id/staff-notes read for auditor', async () => {
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
		const res = await app.request('/api/hr/applications/app-1/staff-notes', {}, env)

		expect(res.status).toBe(200)
		expect(hrStub.listApplicationStaffNotes).toHaveBeenCalledWith('app-1')
	})

	it('denies /applications/:id/staff-notes read for non-HR non-auditor', async () => {
		hrStub.checkPermission.mockResolvedValue(false)
		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/hr/applications/app-1/staff-notes', {}, env)

		expect(res.status).toBe(403)
		expect(hrStub.listApplicationStaffNotes).not.toHaveBeenCalled()
	})

	it('allows viewer-level HR to add application staff note', async () => {
		hrStub.checkPermission.mockResolvedValue(true)
		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request(
			'/api/hr/applications/app-1/staff-notes',
			{
				method: 'POST',
				body: JSON.stringify({ noteText: 'New note' }),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(res.status).toBe(201)
		expect(hrStub.addApplicationStaffNote).toHaveBeenCalledWith(
			'app-1',
			'user-1',
			'1001',
			'Main Pilot',
			'New note'
		)
	})

	it('denies non-HR from adding application staff note', async () => {
		hrStub.checkPermission.mockResolvedValue(false)
		esiStub.fetchCorporationPublicInfo.mockResolvedValue({ ceo_id: 'someone-else' })
		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request(
			'/api/hr/applications/app-1/staff-notes',
			{
				method: 'POST',
				body: JSON.stringify({ noteText: 'Nope' }),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(res.status).toBe(403)
		expect(hrStub.addApplicationStaffNote).not.toHaveBeenCalled()
	})

	it('allows author to update own application staff note', async () => {
		hrStub.checkPermission.mockResolvedValue(true)
		hrStub.listApplicationStaffNotes.mockResolvedValue([
			{
				id: 'staff-note-1',
				applicationId: 'app-1',
				authorId: 'user-1',
				authorCharacterId: '1001',
				authorCharacterName: 'Main Pilot',
				noteText: 'Mine',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			},
		])
		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request(
			'/api/hr/applications/app-1/staff-notes/staff-note-1',
			{
				method: 'PATCH',
				body: JSON.stringify({ noteText: 'Updated note' }),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(res.status).toBe(200)
		expect(hrStub.updateApplicationStaffNote).toHaveBeenCalledWith(
			'staff-note-1',
			'Updated note',
			'user-1',
			'1001',
			'Main Pilot'
		)
	})

	it('denies updating application staff note when user is not author', async () => {
		hrStub.checkPermission.mockResolvedValue(true)
		hrStub.listApplicationStaffNotes.mockResolvedValue([
			{
				id: 'staff-note-1',
				applicationId: 'app-1',
				authorId: 'other-user',
				authorCharacterId: '2002',
				authorCharacterName: 'Other Pilot',
				noteText: 'Not mine',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			},
		])
		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request(
			'/api/hr/applications/app-1/staff-notes/staff-note-1',
			{
				method: 'PATCH',
				body: JSON.stringify({ noteText: 'Blocked' }),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(res.status).toBe(403)
		expect(hrStub.updateApplicationStaffNote).not.toHaveBeenCalled()
	})

	it('allows author to delete own application staff note', async () => {
		hrStub.checkPermission.mockResolvedValue(true)
		hrStub.listApplicationStaffNotes.mockResolvedValue([
			{
				id: 'staff-note-1',
				applicationId: 'app-1',
				authorId: 'user-1',
				authorCharacterId: '1001',
				authorCharacterName: 'Main Pilot',
				noteText: 'Check history',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			},
		])

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request(
			'/api/hr/applications/app-1/staff-notes/staff-note-1',
			{ method: 'DELETE' },
			env
		)

		expect(res.status).toBe(200)
		expect(hrStub.deleteApplicationStaffNote).toHaveBeenCalledWith(
			'staff-note-1',
			'user-1',
			'1001',
			'Main Pilot'
		)
	})

	it('denies deleting application staff note when user is not author', async () => {
		hrStub.checkPermission.mockResolvedValue(true)
		hrStub.listApplicationStaffNotes.mockResolvedValue([
			{
				id: 'staff-note-1',
				applicationId: 'app-1',
				authorId: 'other-user',
				authorCharacterId: '2002',
				authorCharacterName: 'Other Pilot',
				noteText: 'Not mine',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			},
		])
		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request(
			'/api/hr/applications/app-1/staff-notes/staff-note-1',
			{ method: 'DELETE' },
			env
		)

		expect(res.status).toBe(403)
		expect(hrStub.deleteApplicationStaffNote).not.toHaveBeenCalled()
	})

	it('denies /audit/users for non-auditor non-admin', async () => {
		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/hr/audit/users?search=test', {}, env)

		expect(res.status).toBe(403)
	})

	it('denies HR user search without HR access', async () => {
		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/hr/users/search?search=pilot', {}, env)

		expect(res.status).toBe(403)
		expect(searchUsersForHrAccessMock).not.toHaveBeenCalled()
	})

	it('requires at least two search characters before querying the directory', async () => {
		const app = createApp({ user: makeUser({ is_admin: true }), db: dbStub })
		const oneCharacter = await app.request('/api/hr/users/search?search=a', {}, env)
		const empty = await app.request('/api/hr/users/search', {}, env)

		expect(oneCharacter.status).toBe(400)
		expect(empty.status).toBe(400)
		expect(searchUsersForHrAccessMock).not.toHaveBeenCalled()
	})

	it('uses HR access only as the search gate and does not scope results to a corporation', async () => {
		hrStub.getUserHrCorporations.mockResolvedValue(['1001', '2001', 'not-managed'])
		searchUsersForHrAccessMock.mockResolvedValue({
			users: [
				{
					summary: {
						id: 'target-user-1',
						mainCharacterId: '1001',
						mainCharacterName: 'Main Pilot',
						characterCount: 1,
						is_admin: false,
						discordUserId: null,
						discordUsername: null,
						matchedCharacterId: '1001',
						matchedCharacterName: 'Main Pilot',
						matchedBy: 'main_character_name',
						createdAt: new Date(),
						updatedAt: new Date(),
					},
					characters: [
						{
							characterId: '1001',
							characterName: 'Main Pilot',
							corporationId: '1001',
							corporationName: 'Alpha Corp',
							allianceId: null,
							allianceName: null,
							is_primary: true,
							hasValidToken: true,
						},
					],
				},
			],
			total: 1,
			limit: 10,
			offset: 0,
		})
		hrStub.checkBlacklistTargets.mockResolvedValue([
			{
				targetType: 'user',
				targetValue: 'target-user-1',
				isBlacklisted: true,
				reason: null,
				createdAt: null,
				blacklistedBy: null,
				entryMode: null,
			},
			{
				targetType: 'character_id',
				targetValue: '1001',
				isBlacklisted: true,
				reason: null,
				createdAt: null,
				blacklistedBy: null,
				entryMode: null,
			},
		])

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/hr/users/search?search=pilot', {}, env)

		expect(res.status).toBe(200)
		expect(searchUsersForHrAccessMock).toHaveBeenCalledWith({
			search: 'pilot',
			limit: 10,
			offset: 0,
		})
		expect(await res.json()).toMatchObject({
			users: [
				{
					summary: { id: 'target-user-1', isBlacklisted: true },
					characters: [{ characterId: '1001', isBlacklisted: true }],
				},
			],
		})
	})

	it('allows /audit/users for auditor', async () => {
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
		const res = await app.request('/api/hr/audit/users?search=pilot&limit=10&offset=5', {}, env)

		expect(res.status).toBe(200)
		expect(env.ADMIN.searchUsers).toHaveBeenCalledWith(
			{ search: 'pilot', limit: 10, offset: 5 },
			'user-1'
		)
	})

	it('includes blocklist status for displayed auditor-search characters', async () => {
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
		env.ADMIN.searchUsers.mockResolvedValue({
			users: [
				{
					id: 'target-user-1',
					mainCharacterId: '1001',
					mainCharacterName: 'Main Pilot',
					characterCount: 2,
					is_admin: false,
					discordUserId: null,
					discordUsername: null,
					matchedCharacterId: '2002',
					matchedCharacterName: 'Alt Pilot',
					matchedBy: 'character_name',
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			],
			total: 1,
			limit: 25,
			offset: 0,
		})
		hrStub.checkCharactersBlacklisted.mockResolvedValue({ '1001': false, '2002': true })

		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/hr/audit/users?search=pilot', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({
			users: [
				{
					mainCharacterIsBlacklisted: false,
					matchedCharacterIsBlacklisted: true,
				},
			],
		})
		expect(hrStub.checkCharactersBlacklisted).toHaveBeenCalledWith(['1001', '2002'])
	})

	it('includes blocklist status on HR user character summaries', async () => {
		env.CORE.getUserCharacters.mockResolvedValue([
			{
				characterId: '1001',
				characterName: 'Main Pilot',
				hasValidToken: true,
				isDeleted: false,
				corporationId: '1001',
				corporationName: 'Alpha Corp',
			},
		])
		hrStub.checkCharactersBlacklisted.mockResolvedValue({ '1001': true })

		const app = createApp({ user: makeUser({ is_admin: true }), db: dbStub })
		const res = await app.request('/api/hr/users/target-user-1/characters', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject([{ characterId: '1001', isBlacklisted: true }])
		expect(hrStub.checkCharactersBlacklisted).toHaveBeenCalledWith(['1001'])
	})

	it('includes account-level blocklist status for HR user profiles', async () => {
		hrStub.isUserBlacklisted.mockResolvedValue(true)

		const app = createApp({ user: makeUser({ is_admin: true }), db: dbStub })
		const res = await app.request('/api/hr/users/target-user-1/blocklist-status', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ isBlacklisted: true })
		expect(hrStub.isUserBlacklisted).toHaveBeenCalledWith('target-user-1')
	})

	it('allows auditors to create hr notes via hasAnyHrAccess', async () => {
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
		const res = await app.request(
			'/api/hr/notes',
			{
				method: 'POST',
				body: JSON.stringify({
					subjectUserId: 'target-1',
					subjectCharacterId: null,
					noteText: 'Hello',
					noteType: 'general',
					priority: 'normal',
					metadata: null,
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(res.status).toBe(201)
		expect(hrStub.createNote).toHaveBeenCalled()
	})

	it('denies legacy history to inferred leadership without an explicit member corp HR role', async () => {
		hrStub.getUserRoles.mockResolvedValue([])
		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/hr/legacy/history', {}, env)

		expect(res.status).toBe(403)
		expect(hrStub.getUserRoles).toHaveBeenCalledWith('user-1')
	})

	it('allows legacy history for explicit HR roles on member corporations', async () => {
		hrStub.getUserRoles.mockResolvedValue([
			{
				id: 'role-1',
				corporationId: '1001',
				userId: 'user-1',
				characterId: '1001',
				characterName: 'Main Pilot',
				role: 'hr_viewer',
				grantedBy: 'groups',
				grantedAt: new Date().toISOString(),
				expiresAt: null,
				isActive: true,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			},
		])
		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/hr/legacy/history', {}, env)

		expect(res.status).toBe(200)
		expect(hrStub.getUserRoles).toHaveBeenCalledWith('user-1')
	})

	it('keeps edit-note gate admin-only', async () => {
		const app = createApp({ user: makeUser({ is_admin: false }), db: dbStub })
		const res = await app.request(
			'/api/hr/notes/note-1',
			{
				method: 'PATCH',
				body: JSON.stringify({ noteText: 'updated' }),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({ error: 'Forbidden - only site admins can edit notes' })
	})

	it('allows hr_admin to grant hr_reviewer but not hr_admin', async () => {
		hrStub.checkPermission.mockResolvedValue(true)
		const app = createApp({ user: makeUser(), db: dbStub })

		const reviewerRes = await app.request(
			'/api/hr/1001/roles',
			{
				method: 'POST',
				body: JSON.stringify({
					userId: 'target-user-1',
					characterId: '2001',
					role: 'hr_reviewer',
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)
		expect(reviewerRes.status).toBe(201)
		expect(hrStub.grantRole).toHaveBeenCalledWith(
			'1001',
			'target-user-1',
			'hr_reviewer',
			'user-1',
			undefined
		)

		const adminRes = await app.request(
			'/api/hr/1001/roles',
			{
				method: 'POST',
				body: JSON.stringify({
					userId: 'target-user-1',
					characterId: '2001',
					role: 'hr_admin',
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)
		expect(adminRes.status).toBe(403)
	})

	it('blocks hr_admin from revoking another hr_admin role', async () => {
		hrStub.checkPermission.mockResolvedValue(true)
		hrStub.getRole.mockResolvedValue({
			id: 'role-hr-admin',
			corporationId: '1001',
			userId: 'target-user-1',
			characterId: '2001',
			characterName: 'Target Pilot',
			role: 'hr_admin',
			grantedBy: 'ceo-user-1',
			grantedAt: new Date().toISOString(),
			expiresAt: null,
			isActive: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		})
		const app = createApp({ user: makeUser(), db: dbStub })

		const res = await app.request('/api/hr/1001/roles/role-hr-admin', { method: 'DELETE' }, env)
		expect(res.status).toBe(403)
		expect(hrStub.revokeRole).not.toHaveBeenCalled()
	})

	it('allows site admin to grant hr_admin', async () => {
		const app = createApp({ user: makeUser({ is_admin: true }), db: dbStub })
		const res = await app.request(
			'/api/hr/1001/roles',
			{
				method: 'POST',
				body: JSON.stringify({
					userId: 'target-user-1',
					characterId: '2001',
					role: 'hr_admin',
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(res.status).toBe(201)
		expect(hrStub.grantRole).toHaveBeenCalledWith(
			'1001',
			'target-user-1',
			'hr_admin',
			'user-1',
			undefined
		)
	})

	it('denies HR role management for alt corporations even for site admins', async () => {
		const app = createApp({ user: makeUser({ is_admin: true }), db: dbStub })
		const res = await app.request(
			'/api/hr/2001/roles',
			{
				method: 'POST',
				body: JSON.stringify({
					userId: 'target-user-1',
					characterId: '2001',
					role: 'hr_reviewer',
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({
			error: 'Access denied. HR roles can only be managed for member corporations.',
		})
		expect(hrStub.grantRole).not.toHaveBeenCalled()
		expect(esiStub.fetchCorporationPublicInfo).not.toHaveBeenCalled()
	})
})
