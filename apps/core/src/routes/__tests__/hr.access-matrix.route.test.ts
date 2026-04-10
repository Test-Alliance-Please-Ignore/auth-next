import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import { getCachedUserPermissions } from '../../lib/groups-cache'
import hrRoutes from '../hr'

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
		listApplications: vi.fn().mockResolvedValue([]),
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

function makeDbStub() {
	return {
		query: {
			managedCorporations: {
				findMany: vi.fn().mockResolvedValue([
					{ corporationId: '2001', name: 'Bravo Corp', ticker: 'BRV' },
					{ corporationId: '1001', name: 'Alpha Corp', ticker: 'ALP' },
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

function createApp(opts: {
	user?: SessionUser
	db?: ReturnType<typeof makeDbStub>
}) {
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
		ADMIN: {
			searchUsers: vi.fn().mockResolvedValue({ users: [], total: 0 }),
			getUserDetails: vi.fn().mockResolvedValue(null),
		},
	} as any

	let hrStub: ReturnType<typeof makeHrStub>
	let resolverStub: ReturnType<typeof makeResolverStub>
	let dbStub: ReturnType<typeof makeDbStub>

	beforeEach(() => {
		vi.clearAllMocks()
		hrStub = makeHrStub()
		resolverStub = makeResolverStub()
		dbStub = makeDbStub()

		getCachedUserPermissionsMock.mockResolvedValue([])
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			if (binding === env.ESI_TYPE_RESOLVER) return resolverStub as any
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
			{ corporationId: '1001', name: 'Alpha Corp', ticker: 'ALP', currentRole: 'hr_viewer' },
			{ corporationId: '2001', name: 'Bravo Corp', ticker: 'BRV', currentRole: 'hr_viewer' },
		])
	})

	it('returns all active corporations as hr_admin for site admin on /corporations', async () => {
		const app = createApp({ user: makeUser({ is_admin: true }), db: dbStub })
		const res = await app.request('/api/hr/corporations', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual([
			{ corporationId: '1001', name: 'Alpha Corp', ticker: 'ALP', currentRole: 'hr_admin' },
			{ corporationId: '2001', name: 'Bravo Corp', ticker: 'BRV', currentRole: 'hr_admin' },
		])
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
			true
		)
	})

	it('denies /audit/users for non-auditor non-admin', async () => {
		const app = createApp({ user: makeUser(), db: dbStub })
		const res = await app.request('/api/hr/audit/users?search=test', {}, env)

		expect(res.status).toBe(403)
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
})
