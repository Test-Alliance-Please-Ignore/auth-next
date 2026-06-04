import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import { getCachedUserPermissions } from '../../lib/groups-cache'
import fulcrumRoutes from '../fulcrum'

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
		checkPermission: vi.fn().mockResolvedValue(false),
		getUserRoles: vi.fn().mockResolvedValue([]),
		listApplications: vi.fn().mockResolvedValue([]),
	}
}

function makeFulcrumStub() {
	return {
		listReports: vi.fn().mockResolvedValue([]),
		createCharacterReport: vi.fn().mockResolvedValue('report-1'),
		createBulkCharacterReports: vi.fn().mockResolvedValue({ batchId: 'batch-1' }),
		getReportStatus: vi.fn(),
		getSectionManifest: vi.fn(),
		getSectionData: vi.fn(),
	}
}

function makeCoreStub() {
	return {
		getUserCharacters: vi.fn().mockResolvedValue([
			{
				characterId: '3001',
				characterName: 'Alt Pilot',
				hasValidToken: true,
				corporationId: null,
				corporationName: null,
				allianceId: null,
				allianceName: null,
			},
		]),
	}
}

function createApp(user?: SessionUser) {
	const app = new Hono<{
		Bindings: any
		Variables: { user?: SessionUser }
	}>()

	if (user) {
		app.use('*', async (c, next) => {
			c.set('user', user)
			await next()
		})
	}

	app.route('/api/fulcrum', fulcrumRoutes)
	return app
}

describe('fulcrum route access matrix', () => {
	const env = {
		FULCRUM: { name: 'FULCRUM' },
		HR: { name: 'HR' },
		CORE: { name: 'CORE' },
		EVE_CORPORATION_DATA: { name: 'EVE_CORPORATION_DATA' },
	} as any

	let hrStub: ReturnType<typeof makeHrStub>
	let fulcrumStub: ReturnType<typeof makeFulcrumStub>
	let coreStub: ReturnType<typeof makeCoreStub>

	beforeEach(() => {
		vi.clearAllMocks()
		hrStub = makeHrStub()
		fulcrumStub = makeFulcrumStub()
		coreStub = makeCoreStub()

		getCachedUserPermissionsMock.mockResolvedValue([])
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			if (binding === env.FULCRUM) return fulcrumStub as any
			if (binding === env.CORE) return coreStub as any
			if (binding === env.EVE_CORPORATION_DATA) {
				return {
					getCorporationInfo: vi.fn(),
					getDirectors: vi.fn().mockResolvedValue([]),
					getMemberTracking: vi.fn().mockResolvedValue([]),
				} as any
			}
			throw new Error('Unexpected binding')
		})
	})

	it('returns 401 for unauthenticated requests', async () => {
		const app = createApp()
		const res = await app.request('/api/fulcrum/users/target-1/characters', {}, env)
		expect(res.status).toBe(401)
	})

	it('requires corporationId for non-auditor user character report listing', async () => {
		const app = createApp(makeUser())
		const res = await app.request('/api/fulcrum/users/target-1/characters', {}, env)
		expect(res.status).toBe(400)
		expect(await res.json()).toEqual({ error: 'corporationId query parameter is required' })
	})

	it('allows auditor to list user characters without corporationId', async () => {
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

		const app = createApp(makeUser())
		const res = await app.request('/api/fulcrum/users/target-1/characters', {}, env)

		expect(res.status).toBe(200)
		expect(hrStub.checkPermission).not.toHaveBeenCalled()
		expect(coreStub.getUserCharacters).toHaveBeenCalledWith('target-1', false)
		expect(fulcrumStub.listReports).toHaveBeenCalledWith({ characterId: '3001' }, 50)
		const body = (await res.json()) as Array<{ characterId: string; hasValidToken?: boolean | null }>
		expect(body[0]).toMatchObject({ characterId: '3001', hasValidToken: true })
	})

	it('blocks report creation for non-auditor without hr_reviewer+', async () => {
		const app = createApp(makeUser())
		const res = await app.request(
			'/api/fulcrum/characters/3001/reports',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					corporationId: '1001',
					requestSource: 'hr',
					userId: 'target-1',
				}),
			},
			env
		)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({ error: 'HR reviewer or admin role required' })
		expect(fulcrumStub.createCharacterReport).not.toHaveBeenCalled()
	})

	it('allows auditor to create reports without hr role check', async () => {
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

		const app = createApp(makeUser())
		const res = await app.request(
			'/api/fulcrum/characters/3001/reports',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					corporationId: '1001',
					requestSource: 'hr',
					userId: 'target-1',
				}),
			},
			env
		)

		expect(res.status).toBe(201)
		expect(hrStub.checkPermission).not.toHaveBeenCalled()
		expect(fulcrumStub.createCharacterReport).toHaveBeenCalledWith({
			characterId: '3001',
			requestorUserId: 'user-1',
			requestorCorporationId: '1001',
			requestSource: 'hr',
			applicationId: undefined,
			sendDm: true,
		})
	})

	it('blocks hr_viewer report creation even when the target user has an open application', async () => {
		hrStub.checkPermission.mockResolvedValue(true)
		hrStub.getUserRoles.mockResolvedValue([
			{
				id: 'role-1',
				corporationId: '1001',
				userId: 'user-1',
				characterId: 'user-1',
				characterName: 'Main Pilot',
				role: 'hr_viewer',
				grantedBy: 'granted-by',
				grantedAt: new Date(),
				expiresAt: null,
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		] as any)
		hrStub.listApplications.mockImplementation(async (_filters: any, _userId: string, _access: any) =>
			_filters.status === 'pending'
				? []
				: [
						{
							id: 'app-1',
							corporationId: '1001',
							userId: 'target-1',
							characterId: '3001',
							characterName: 'Alt Pilot',
							applicationText: 'app',
							status: 'under_review',
							reviewedBy: null,
							reviewedByCharacterName: null,
							reviewedAt: null,
							reviewNotes: null,
							createdAt: new Date(),
							updatedAt: new Date(),
							lastStaffInteractionAt: null,
							altCharacterIds: [],
						},
					]
		)

		const app = createApp(makeUser())
		const res = await app.request(
			'/api/fulcrum/characters/3001/reports',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					corporationId: '1001',
					requestSource: 'hr',
					targetUserId: 'target-1',
				}),
			},
			env
		)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({ error: 'HR reviewer or admin role required' })
		expect(fulcrumStub.createCharacterReport).not.toHaveBeenCalled()
	})

	it('blocks hr_viewer report creation when the target user has no open application', async () => {
		hrStub.checkPermission.mockResolvedValue(true)
		hrStub.getUserRoles.mockResolvedValue([
			{
				id: 'role-1',
				corporationId: '1001',
				userId: 'user-1',
				characterId: 'user-1',
				characterName: 'Main Pilot',
				role: 'hr_viewer',
				grantedBy: 'granted-by',
				grantedAt: new Date(),
				expiresAt: null,
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		] as any)
		hrStub.listApplications.mockResolvedValue([])

		const app = createApp(makeUser())
		const res = await app.request(
			'/api/fulcrum/characters/3001/reports',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					corporationId: '1001',
					requestSource: 'hr',
					targetUserId: 'target-1',
				}),
			},
			env
		)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({
			error: 'An open application is required to request Fulcrum reports for this user',
		})
		expect(fulcrumStub.createCharacterReport).not.toHaveBeenCalled()
	})

	it('blocks hr_viewer bulk report creation even when the target user has an open application', async () => {
		hrStub.checkPermission.mockResolvedValue(true)
		hrStub.getUserRoles.mockResolvedValue([
			{
				id: 'role-1',
				corporationId: '1001',
				userId: 'user-1',
				characterId: 'user-1',
				characterName: 'Main Pilot',
				role: 'hr_viewer',
				grantedBy: 'granted-by',
				grantedAt: new Date(),
				expiresAt: null,
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		] as any)
		hrStub.listApplications.mockResolvedValue([])
		hrStub.listApplications.mockImplementation(async (_filters: any, _userId: string, _access: any) => [
			{
				id: 'app-1',
				corporationId: '1001',
				userId: 'target-1',
				characterId: '3001',
				characterName: 'Alt Pilot',
				applicationText: 'app',
				status: 'under_review',
				reviewedBy: null,
				reviewedByCharacterName: null,
				reviewedAt: null,
				reviewNotes: null,
				createdAt: new Date(),
				updatedAt: new Date(),
				lastStaffInteractionAt: null,
				altCharacterIds: [],
			},
		] as any)

		const app = createApp(makeUser())
		const res = await app.request(
			'/api/fulcrum/reports/batch',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					corporationId: '1001',
					requestSource: 'hr',
					characterIds: ['3001', '3002'],
					targetUserId: 'target-1',
				}),
			},
			env
		)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({ error: 'HR reviewer or admin role required' })
		expect(fulcrumStub.createBulkCharacterReports).not.toHaveBeenCalled()
	})

	it('passes sendDm=false through to report creation', async () => {
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

		const app = createApp(makeUser())
		const res = await app.request(
			'/api/fulcrum/characters/3001/reports',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					corporationId: '1001',
					requestSource: 'hr',
					sendDm: false,
				}),
			},
			env
		)

		expect(res.status).toBe(201)
		expect(fulcrumStub.createCharacterReport).toHaveBeenCalledWith({
			characterId: '3001',
			requestorUserId: 'user-1',
			requestorCorporationId: '1001',
			requestSource: 'hr',
			applicationId: undefined,
			sendDm: false,
		})
	})

	it('passes sendDm=false through to bulk report creation', async () => {
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

		const app = createApp(makeUser())
		const res = await app.request(
			'/api/fulcrum/reports/batch',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					corporationId: '1001',
					requestSource: 'hr',
					characterIds: ['3001', '3002'],
					sendDm: false,
				}),
			},
			env,
		)

		expect(res.status).toBe(201)
		expect(fulcrumStub.createBulkCharacterReports).toHaveBeenCalledWith({
			characterIds: ['3001', '3002'],
			requestorUserId: 'user-1',
			requestorCorporationId: '1001',
			requestSource: 'hr',
			applicationId: undefined,
			sendDm: false,
		})
	})

	it('defaults sendDm=true for bulk report creation when omitted', async () => {
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

		const app = createApp(makeUser())
		const res = await app.request(
			'/api/fulcrum/reports/batch',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					corporationId: '1001',
					requestSource: 'hr',
					characterIds: ['3001', '3002'],
				}),
			},
			env,
		)

		expect(res.status).toBe(201)
		expect(fulcrumStub.createBulkCharacterReports).toHaveBeenCalledWith({
			characterIds: ['3001', '3002'],
			requestorUserId: 'user-1',
			requestorCorporationId: '1001',
			requestSource: 'hr',
			applicationId: undefined,
			sendDm: true,
		})
	})
})
