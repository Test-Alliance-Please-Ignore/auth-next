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

const backgroundTasks: Array<Promise<unknown>> = []

vi.mock('../../lib/background-task', () => ({
	waitUntilWithTelemetry: (
		_executionCtx: unknown,
		_label: string,
		task: () => Promise<unknown>
	) => {
		backgroundTasks.push(task().catch(() => undefined))
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
		getReportSections: vi.fn(),
		getReportSectionData: vi.fn(),
		fetchMailContent: vi.fn(),
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
		getUserCorporations: vi.fn().mockResolvedValue([
			{
				corporationId: '1001',
				corporationName: 'Corp 1001',
			},
		]),
		queueImmunitasAccessAlert: vi.fn().mockResolvedValue({
			added: 1,
			skipped: 0,
			pendingCount: 1,
		}),
	}
}

function makeDbStub() {
	return {
		query: {
			managedCorporations: {
				findFirst: vi.fn().mockResolvedValue({ isMemberCorporation: true }),
			},
			userCharacters: {
				findFirst: vi.fn().mockResolvedValue({
					userId: 'user-1',
					characterName: 'Main Pilot',
				}),
			},
			users: {
				findFirst: vi.fn().mockResolvedValue(null),
			},
		},
	}
}

function createApp(user?: SessionUser, db: ReturnType<typeof makeDbStub> = makeDbStub()) {
	const app = new Hono<{
		Bindings: any
		Variables: { user?: SessionUser; db?: ReturnType<typeof makeDbStub> }
	}>()

	if (user) {
		app.use('*', async (c, next) => {
			c.set('user', user)
			if (db) {
				c.set('db', db)
			}
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
		EVE_CHARACTER_DATA: { name: 'EVE_CHARACTER_DATA' },
		EVE_CORPORATION_DATA: { name: 'EVE_CORPORATION_DATA' },
	} as any

	let hrStub: ReturnType<typeof makeHrStub>
	let fulcrumStub: ReturnType<typeof makeFulcrumStub>
	let coreStub: ReturnType<typeof makeCoreStub>
	let dbStub: ReturnType<typeof makeDbStub>
	let eveCharacterDataStub: {
		getInstance: ReturnType<typeof vi.fn>
	}
	let eveCharacterDataInstance: {
		getCharacterInfo: ReturnType<typeof vi.fn>
	}
	let eveCorporationDataStub: {
		getCorporationInfo: ReturnType<typeof vi.fn>
		getDirectors: ReturnType<typeof vi.fn>
		getMemberTracking: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.clearAllMocks()
		backgroundTasks.length = 0
		hrStub = makeHrStub()
		fulcrumStub = makeFulcrumStub()
		coreStub = makeCoreStub()
		dbStub = makeDbStub()
		eveCharacterDataInstance = {
			getCharacterInfo: vi.fn().mockResolvedValue({
				characterId: '3001',
				corporationId: '1001',
			}),
		}
		eveCharacterDataStub = {
			getInstance: vi.fn().mockResolvedValue(eveCharacterDataInstance),
		}
		eveCorporationDataStub = {
			getCorporationInfo: vi.fn().mockResolvedValue({ ceoId: '9999' }),
			getDirectors: vi.fn().mockResolvedValue([]),
			getMemberTracking: vi.fn().mockResolvedValue([]),
		}

		getCachedUserPermissionsMock.mockResolvedValue([])
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			if (binding === env.FULCRUM) return fulcrumStub as any
			if (binding === env.CORE) return coreStub as any
			if (binding === env.EVE_CHARACTER_DATA) return eveCharacterDataStub as any
			if (binding === env.EVE_CORPORATION_DATA) {
				return eveCorporationDataStub as any
			}
			throw new Error('Unexpected binding')
		})
	})

	it('returns 401 for unauthenticated requests', async () => {
		const app = createApp()
		const res = await app.request('/api/fulcrum/users/target-1/characters', {}, env)
		expect(res.status).toBe(401)
	})

	it('denies non-auditor user character report listing when no backend access scope exists', async () => {
		const app = createApp(makeUser())
		const res = await app.request('/api/fulcrum/users/target-1/characters', {}, env)
		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({
			error: 'HR staff access requires a shared corporation or an open application',
		})
		expect(hrStub.listApplications).toHaveBeenCalledWith({ userId: 'target-1' }, 'user-1', {
			isAdmin: false,
			isAuditor: false,
		})
		expect(coreStub.getUserCorporations).toHaveBeenCalledWith('target-1')
	})

	it('allows non-auditor to list user characters without corporationId when the target has an open application', async () => {
		hrStub.listApplications.mockResolvedValue([
			{
				id: 'app-1',
				userId: 'target-1',
				characterId: '3001',
				characterName: 'Alt Pilot',
				corporationId: '2001',
				status: 'accepted',
			},
		] as any)
		hrStub.checkPermission.mockImplementation(async (_userId, corporationId, role) => {
			return corporationId === '2001' && role === 'hr_reviewer'
		})

		const app = createApp(makeUser())
		const res = await app.request('/api/fulcrum/users/target-1/characters', {}, env)

		expect(res.status).toBe(200)
		expect(hrStub.checkPermission).toHaveBeenCalledWith('user-1', '2001', 'hr_reviewer')
		expect(coreStub.getUserCorporations).not.toHaveBeenCalled()
		expect(coreStub.getUserCharacters).toHaveBeenCalledWith('target-1', false)
		expect(fulcrumStub.listReports).toHaveBeenCalledWith({ characterId: '3001' }, 50)
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
		const body = (await res.json()) as Array<{
			characterId: string
			hasValidToken?: boolean | null
		}>
		expect(body[0]).toMatchObject({ characterId: '3001', hasValidToken: true })
	})

	it('allows site admins to read completed report sections without HR role checks', async () => {
		hrStub.getUserRoles.mockResolvedValue([])
		hrStub.checkPermission.mockResolvedValue(false)
		fulcrumStub.getReportStatus.mockResolvedValue({
			reportId: 'report-1',
			status: 'completed',
			requestorCorporationId: '1001',
		} as any)
		fulcrumStub.getReportSections.mockResolvedValue({
			sections: ['public-info'],
		} as any)

		const app = createApp(makeUser({ is_admin: true }))
		const res = await app.request('/api/fulcrum/reports/report-1/sections', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ sections: ['public-info'] })
		expect(hrStub.checkPermission).not.toHaveBeenCalled()
		expect(fulcrumStub.getReportSections).toHaveBeenCalledWith('report-1')
	})

	it('denies unauthorized report section access before revealing readiness state', async () => {
		hrStub.getUserRoles.mockResolvedValue([])
		hrStub.checkPermission.mockResolvedValue(false)
		fulcrumStub.getReportStatus.mockResolvedValue({
			reportId: 'report-1',
			status: 'pending',
			requestorCorporationId: '1001',
		} as any)

		const app = createApp(makeUser())
		const res = await app.request('/api/fulcrum/reports/report-1/sections', {}, env)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({ error: 'HR role required' })
		expect(fulcrumStub.getReportSections).not.toHaveBeenCalled()
		expect(hrStub.checkPermission).toHaveBeenCalledWith('user-1', '1001', 'hr_viewer')
	})

	it('allows hr_viewer staff to read completed report section data', async () => {
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
		hrStub.checkPermission.mockResolvedValue(true)
		fulcrumStub.getReportStatus.mockResolvedValue({
			reportId: 'report-1',
			status: 'completed',
			requestorCorporationId: '1001',
		} as any)
		fulcrumStub.getReportSectionData.mockResolvedValue({
			rows: [{ section: 'public-info' }],
		} as any)

		const app = createApp(makeUser())
		const res = await app.request('/api/fulcrum/reports/report-1/sections/public-info', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ rows: [{ section: 'public-info' }] })
		expect(hrStub.checkPermission).toHaveBeenCalledWith('user-1', '1001', 'hr_viewer')
		expect(fulcrumStub.getReportSectionData).toHaveBeenCalledWith('report-1', 'public-info')
	})

	it('denies unauthorized mail content access before revealing readiness state', async () => {
		hrStub.getUserRoles.mockResolvedValue([])
		hrStub.checkPermission.mockResolvedValue(false)
		fulcrumStub.getReportStatus.mockResolvedValue({
			reportId: 'report-1',
			status: 'pending',
			requestorCorporationId: '1001',
		} as any)

		const app = createApp(makeUser())
		const res = await app.request('/api/fulcrum/reports/report-1/mails/mail-1/content', {}, env)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({ error: 'HR role required' })
		expect(fulcrumStub.fetchMailContent).not.toHaveBeenCalled()
		expect(hrStub.checkPermission).toHaveBeenCalledWith('user-1', '1001', 'hr_viewer')
	})

	it('denies character report listing when backend access scope does not exist', async () => {
		dbStub.query.userCharacters.findFirst.mockResolvedValue({
			userId: 'target-1',
			characterName: 'Alt Pilot',
		} as any)

		const app = createApp(makeUser(), dbStub)
		const res = await app.request('/api/fulcrum/characters/3001/reports', {}, env)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({
			error: 'HR staff access requires a shared corporation or an open application',
		})
		expect(hrStub.listApplications).toHaveBeenCalledWith({ userId: 'target-1' }, 'user-1', {
			isAdmin: false,
			isAuditor: false,
		})
		expect(coreStub.getUserCorporations).toHaveBeenCalledWith('target-1')
	})

	it('allows character report listing without corporationId when the target has an open application', async () => {
		dbStub.query.userCharacters.findFirst.mockResolvedValue({
			userId: 'target-1',
			characterName: 'Alt Pilot',
		} as any)
		hrStub.listApplications.mockResolvedValue([
			{
				id: 'app-1',
				userId: 'target-1',
				characterId: '3001',
				characterName: 'Alt Pilot',
				corporationId: '2001',
				status: 'accepted',
			},
		] as any)
		hrStub.checkPermission.mockImplementation(async (_userId, corporationId, role) => {
			return corporationId === '2001' && role === 'hr_reviewer'
		})

		const app = createApp(makeUser(), dbStub)
		const res = await app.request('/api/fulcrum/characters/3001/reports', {}, env)

		expect(res.status).toBe(200)
		expect(hrStub.checkPermission).toHaveBeenCalledWith('user-1', '2001', 'hr_reviewer')
		expect(fulcrumStub.listReports).toHaveBeenCalledWith({ characterId: '3001' }, 50)
	})

	it('blocks report creation for immunitas targets and queues an alert', async () => {
		dbStub.query.userCharacters.findFirst.mockResolvedValue({
			userId: 'target-user',
			characterName: 'Immunitas Pilot',
		} as any)
		dbStub.query.users.findFirst.mockResolvedValue({ immunitas: true } as any)

		const app = createApp(makeUser(), dbStub)
		const res = await app.request(
			'/api/fulcrum/characters/1001/reports',
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

		await Promise.all(backgroundTasks.splice(0, backgroundTasks.length))

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({
			error: 'Fulcrum report requests are not allowed for this character',
		})
		expect(fulcrumStub.createCharacterReport).not.toHaveBeenCalled()
		expect(coreStub.queueImmunitasAccessAlert).toHaveBeenCalledWith({
			targetUserId: 'target-user',
			targetCharacterLabel: 'Immunitas Pilot',
			requestorUserId: 'user-1',
			requestorCharacterLabel: 'Main Pilot',
			accessType: 'fulcrum-report',
			source: 'fulcrum-report-request',
		})
	})

	it('allows self-targeted immunitas report requests without alerting', async () => {
		dbStub.query.userCharacters.findFirst.mockResolvedValue({
			userId: 'user-1',
			characterName: 'Main Pilot',
		} as any)
		dbStub.query.users.findFirst.mockResolvedValue({ immunitas: true } as any)
		hrStub.checkPermission.mockResolvedValue(false)
		hrStub.getUserRoles.mockResolvedValue([
			{
				id: 'role-1',
				corporationId: '1001',
				userId: 'user-1',
				characterId: 'user-1',
				characterName: 'Main Pilot',
				role: 'hr_admin',
				grantedBy: 'granted-by',
				grantedAt: new Date(),
				expiresAt: null,
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		] as any)
		const app = createApp(makeUser(), dbStub)
		const res = await app.request(
			'/api/fulcrum/characters/1001/reports',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					corporationId: '1001',
					requestSource: 'hr',
					targetUserId: 'user-1',
				}),
			},
			env
		)

		expect(res.status).toBe(201)
		expect(fulcrumStub.createCharacterReport).toHaveBeenCalledWith({
			characterId: '1001',
			requestorUserId: 'user-1',
			requestorCorporationId: '1001',
			requestSource: 'hr',
			applicationId: undefined,
			targetUserId: 'user-1',
			sendDm: true,
		})
		expect(coreStub.queueImmunitasAccessAlert).not.toHaveBeenCalled()
	})

	it('allows self-targeted immunitas report requests without HR roles or alerts', async () => {
		dbStub.query.userCharacters.findFirst.mockResolvedValue({
			userId: 'user-1',
			characterName: 'Main Pilot',
		} as any)
		dbStub.query.users.findFirst.mockResolvedValue({ immunitas: true } as any)
		hrStub.checkPermission.mockResolvedValue(false)
		hrStub.getUserRoles.mockResolvedValue([])

		const app = createApp(makeUser(), dbStub)
		const res = await app.request(
			'/api/fulcrum/characters/1001/reports',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					requestSource: 'hr',
				}),
			},
			env
		)

		expect(res.status).toBe(201)
		expect(fulcrumStub.createCharacterReport).toHaveBeenCalledWith({
			characterId: '1001',
			requestorUserId: 'user-1',
			requestorCorporationId: '1001',
			requestSource: 'hr',
			applicationId: undefined,
			targetUserId: 'user-1',
			sendDm: true,
		})
		expect(coreStub.queueImmunitasAccessAlert).not.toHaveBeenCalled()
	})

	it('blocks report creation when the target user has no shared corporation and there is no open application', async () => {
		dbStub.query.userCharacters.findFirst.mockResolvedValue({
			userId: 'target-user',
			characterName: 'Target Pilot',
		} as any)
		coreStub.getUserCorporations.mockResolvedValue([
			{
				corporationId: '2002',
				corporationName: 'Corp 2002',
			},
		])
		eveCharacterDataStub.getInstance.mockResolvedValue({
			getCharacterInfo: vi.fn().mockResolvedValue({
				characterId: '3001',
				corporationId: '2002',
			}),
		} as any)
		hrStub.checkPermission.mockResolvedValue(false)
		hrStub.getUserRoles.mockResolvedValue([
			{
				id: 'role-1',
				corporationId: '1001',
				userId: 'user-1',
				characterId: 'user-1',
				characterName: 'Main Pilot',
				role: 'hr_admin',
				grantedBy: 'granted-by',
				grantedAt: new Date(),
				expiresAt: null,
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		] as any)
		const app = createApp(makeUser(), dbStub)
		const res = await app.request(
			'/api/fulcrum/characters/3001/reports',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					corporationId: '1001',
					requestSource: 'hr',
					targetUserId: 'target-user',
				}),
			},
			env
		)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({
			error: 'Fulcrum report requests are not allowed for this character',
		})
		expect(fulcrumStub.createCharacterReport).not.toHaveBeenCalled()
	})

	it('allows report creation when the target user has another character in the request corporation without an open application', async () => {
		dbStub.query.userCharacters.findFirst.mockResolvedValue({
			userId: 'target-user',
			characterName: 'Target Pilot',
		} as any)
		eveCharacterDataStub.getInstance.mockResolvedValue({
			getCharacterInfo: vi.fn().mockResolvedValue({
				characterId: '3001',
				corporationId: '2002',
			}),
		} as any)
		coreStub.getUserCorporations.mockResolvedValue([
			{
				corporationId: '1001',
				corporationName: 'Corp 1001',
			},
			{
				corporationId: '2002',
				corporationName: 'Corp 2002',
			},
		])
		hrStub.checkPermission.mockImplementation(
			async (_userId: string, corporationId: string) => corporationId === '1001'
		)
		hrStub.getUserRoles.mockResolvedValue([
			{
				id: 'role-1',
				corporationId: '1001',
				userId: 'user-1',
				characterId: 'user-1',
				characterName: 'Main Pilot',
				role: 'hr_admin',
				grantedBy: 'granted-by',
				grantedAt: new Date(),
				expiresAt: null,
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		] as any)

		const app = createApp(makeUser(), dbStub)
		const res = await app.request(
			'/api/fulcrum/characters/3001/reports',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
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
			targetUserId: 'target-user',
			sendDm: false,
		})
	})

	it('ignores a spoofed targetUserId and uses the actual target owner for reviewer open-application checks', async () => {
		dbStub.query.userCharacters.findFirst.mockResolvedValue({
			userId: 'target-user',
			characterName: 'Target Pilot',
		} as any)
		hrStub.checkPermission.mockResolvedValue(false)
		hrStub.getUserRoles.mockResolvedValue([
			{
				id: 'role-1',
				corporationId: '2002',
				userId: 'user-1',
				characterId: 'user-1',
				characterName: 'Main Pilot',
				role: 'hr_reviewer',
				grantedBy: 'granted-by',
				grantedAt: new Date(),
				expiresAt: null,
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		] as any)
		hrStub.listApplications.mockImplementation(async (filters: any) =>
			filters.userId === 'target-user'
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

		const app = createApp(makeUser(), dbStub)
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
			error: 'Fulcrum report requests are not allowed for this character',
		})
		expect(fulcrumStub.createCharacterReport).not.toHaveBeenCalled()
	})

	it('allows hr_reviewer report creation when the target user has an open application', async () => {
		dbStub.query.userCharacters.findFirst.mockResolvedValue({
			userId: 'target-user',
			characterName: 'Target Pilot',
		} as any)
		hrStub.checkPermission.mockResolvedValue(true)
		hrStub.getUserRoles.mockResolvedValue([
			{
				id: 'role-1',
				corporationId: '2002',
				userId: 'user-1',
				characterId: 'user-1',
				characterName: 'Main Pilot',
				role: 'hr_reviewer',
				grantedBy: 'granted-by',
				grantedAt: new Date(),
				expiresAt: null,
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		] as any)
		hrStub.listApplications.mockImplementation(async (filters: any) =>
			filters.userId === 'target-user'
				? [
						{
							id: 'app-1',
							corporationId: '2002',
							userId: 'target-user',
							characterId: '3001',
							characterName: 'Target Pilot',
							applicationText: 'app',
							status: 'accepted',
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
				: []
		)

		const app = createApp(makeUser(), dbStub)
		const res = await app.request(
			'/api/fulcrum/characters/3001/reports',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
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
			requestorCorporationId: '2002',
			requestSource: 'hr',
			applicationId: undefined,
			targetUserId: 'target-user',
			sendDm: false,
		})
	})

	it('blocks batch report creation for immunitas targets and queues alerts', async () => {
		dbStub.query.userCharacters.findFirst
			.mockResolvedValueOnce({
				userId: 'target-user',
				characterName: 'Immunitas Pilot',
			} as any)
			.mockResolvedValueOnce({
				userId: 'target-user',
				characterName: 'Regular Pilot',
			} as any)
		dbStub.query.users.findFirst
			.mockResolvedValueOnce({ immunitas: true } as any)
			.mockResolvedValueOnce({ immunitas: false } as any)

		const app = createApp(makeUser(), dbStub)
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

		await Promise.all(backgroundTasks.splice(0, backgroundTasks.length))

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({
			error: 'Fulcrum report requests are not allowed for one or more targeted characters',
		})
		expect(fulcrumStub.createBulkCharacterReports).not.toHaveBeenCalled()
		expect(coreStub.queueImmunitasAccessAlert).toHaveBeenCalledWith({
			targetUserId: 'target-user',
			targetCharacterLabel: 'Immunitas Pilot',
			requestorUserId: 'user-1',
			requestorCharacterLabel: 'Main Pilot',
			accessType: 'fulcrum-report',
			source: 'fulcrum-report-batch-request',
		})
	})

	it('allows self-targeted immunitas batch report requests without alerting', async () => {
		dbStub.query.userCharacters.findFirst.mockResolvedValue({
			userId: 'user-1',
			characterName: 'Main Pilot',
		} as any)
		dbStub.query.users.findFirst.mockResolvedValue({ immunitas: true } as any)
		hrStub.checkPermission.mockResolvedValue(true)
		hrStub.getUserRoles.mockResolvedValue([
			{
				id: 'role-1',
				corporationId: '1001',
				userId: 'user-1',
				characterId: 'user-1',
				characterName: 'Main Pilot',
				role: 'hr_admin',
				grantedBy: 'granted-by',
				grantedAt: new Date(),
				expiresAt: null,
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		] as any)
		const app = createApp(makeUser(), dbStub)
		const res = await app.request(
			'/api/fulcrum/reports/batch',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					corporationId: '1001',
					requestSource: 'hr',
					characterIds: ['1001'],
					targetUserId: 'user-1',
				}),
			},
			env
		)

		expect(res.status).toBe(201)
		expect(fulcrumStub.createBulkCharacterReports).toHaveBeenCalledWith({
			characterIds: ['1001'],
			requestorUserId: 'user-1',
			requestorCorporationId: '1001',
			requestSource: 'hr',
			applicationId: undefined,
			targetUserId: 'user-1',
			sendDm: true,
		})
		expect(coreStub.queueImmunitasAccessAlert).not.toHaveBeenCalled()
	})

	it('allows batch report creation when the target user has characters in different corporations but shares one with the requester', async () => {
		dbStub.query.userCharacters.findFirst
			.mockResolvedValueOnce({
				userId: 'target-user',
				characterName: 'Target Pilot One',
			} as any)
			.mockResolvedValueOnce({
				userId: 'target-user',
				characterName: 'Target Pilot Two',
			} as any)
		coreStub.getUserCorporations.mockImplementation(async (userId: string) =>
			userId === 'user-1'
				? [
						{
							corporationId: '1001',
							corporationName: 'Corp 1001',
						},
						{
							corporationId: '2002',
							corporationName: 'Corp 2002',
						},
					]
				: [
						{
							corporationId: '1001',
							corporationName: 'Corp 1001',
						},
						{
							corporationId: '2002',
							corporationName: 'Corp 2002',
						},
					]
		)
		hrStub.checkPermission.mockImplementation(
			async (_userId: string, corporationId: string) => corporationId === '2002'
		)
		hrStub.getUserRoles.mockResolvedValue([
			{
				id: 'role-1',
				corporationId: '2002',
				userId: 'user-1',
				characterId: 'user-1',
				characterName: 'Main Pilot',
				role: 'hr_admin',
				grantedBy: 'granted-by',
				grantedAt: new Date(),
				expiresAt: null,
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		] as any)
		hrStub.listApplications.mockResolvedValue([
			{
				id: 'app-1',
				corporationId: '2002',
				userId: 'target-user',
				characterId: '3001',
				characterName: 'Target Pilot One',
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
		const app = createApp(makeUser(), dbStub)
		const res = await app.request(
			'/api/fulcrum/reports/batch',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					requestSource: 'hr',
					characterIds: ['3001', '3002'],
					sendDm: false,
				}),
			},
			env
		)

		expect(res.status).toBe(201)
		expect(fulcrumStub.createBulkCharacterReports).toHaveBeenCalledWith({
			characterIds: ['3001', '3002'],
			requestorUserId: 'user-1',
			requestorCorporationId: '2002',
			requestSource: 'hr',
			applicationId: undefined,
			targetUserId: 'target-user',
			sendDm: false,
		})
	})

	it('allows batch report creation when the target user has an open application in an accessible corporation', async () => {
		dbStub.query.userCharacters.findFirst
			.mockResolvedValueOnce({
				userId: 'target-user',
				characterName: 'Target Pilot One',
			} as any)
			.mockResolvedValueOnce({
				userId: 'target-user',
				characterName: 'Target Pilot Two',
			} as any)
		hrStub.checkPermission.mockImplementation(
			async (_userId: string, corporationId: string) => corporationId === '2002'
		)
		hrStub.getUserRoles.mockResolvedValue([
			{
				id: 'role-1',
				corporationId: '2002',
				userId: 'user-1',
				characterId: 'user-1',
				characterName: 'Main Pilot',
				role: 'hr_reviewer',
				grantedBy: 'granted-by',
				grantedAt: new Date(),
				expiresAt: null,
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		] as any)
		hrStub.listApplications.mockImplementation(async (filters: any) =>
			filters.userId === 'target-user'
				? [
						{
							id: 'app-1',
							corporationId: '2002',
							userId: 'target-user',
							characterId: '3001',
							characterName: 'Target Pilot One',
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
				: []
		)

		const app = createApp(makeUser(), dbStub)
		const res = await app.request(
			'/api/fulcrum/reports/batch',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					requestSource: 'hr',
					characterIds: ['3001', '3002'],
					sendDm: false,
				}),
			},
			env
		)

		expect(res.status).toBe(201)
		expect(fulcrumStub.createBulkCharacterReports).toHaveBeenCalledWith({
			characterIds: ['3001', '3002'],
			requestorUserId: 'user-1',
			requestorCorporationId: '2002',
			requestSource: 'hr',
			applicationId: undefined,
			targetUserId: 'target-user',
			sendDm: false,
		})
	})

	it('blocks batch report creation when the target user has no shared corporation and there is no open application', async () => {
		dbStub.query.userCharacters.findFirst.mockResolvedValue({
			userId: 'target-user',
			characterName: 'Target Pilot',
		} as any)
		coreStub.getUserCorporations.mockResolvedValue([
			{
				corporationId: '2002',
				corporationName: 'Corp 2002',
			},
		])
		eveCharacterDataStub.getInstance.mockResolvedValue({
			getCharacterInfo: vi.fn().mockResolvedValue({
				characterId: '3001',
				corporationId: '2002',
			}),
		} as any)
		hrStub.checkPermission.mockResolvedValue(false)
		hrStub.getUserRoles.mockResolvedValue([
			{
				id: 'role-1',
				corporationId: '1001',
				userId: 'user-1',
				characterId: 'user-1',
				characterName: 'Main Pilot',
				role: 'hr_admin',
				grantedBy: 'granted-by',
				grantedAt: new Date(),
				expiresAt: null,
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		] as any)
		const app = createApp(makeUser(), dbStub)
		const res = await app.request(
			'/api/fulcrum/reports/batch',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					corporationId: '1001',
					requestSource: 'hr',
					characterIds: ['3001', '3002'],
					targetUserId: 'target-user',
				}),
			},
			env
		)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({
			error: 'Fulcrum report requests are not allowed for these characters',
		})
		expect(fulcrumStub.createBulkCharacterReports).not.toHaveBeenCalled()
	})

	it('allows batch report creation when the target user has another character in the request corporation without an open application', async () => {
		dbStub.query.userCharacters.findFirst
			.mockResolvedValueOnce({
				userId: 'target-user',
				characterName: 'Target Pilot One',
			} as any)
			.mockResolvedValueOnce({
				userId: 'target-user',
				characterName: 'Target Pilot Two',
			} as any)
		eveCharacterDataStub.getInstance.mockImplementation(
			async (characterId: string) =>
				({
					getCharacterInfo: vi.fn().mockResolvedValue({
						characterId,
						corporationId: characterId === '3001' ? '2002' : '3003',
					}),
				}) as any
		)
		coreStub.getUserCorporations.mockResolvedValue([
			{
				corporationId: '1001',
				corporationName: 'Corp 1001',
			},
			{
				corporationId: '2002',
				corporationName: 'Corp 2002',
			},
		])
		hrStub.checkPermission.mockImplementation(
			async (_userId: string, corporationId: string) => corporationId === '1001'
		)
		hrStub.getUserRoles.mockResolvedValue([
			{
				id: 'role-1',
				corporationId: '1001',
				userId: 'user-1',
				characterId: 'user-1',
				characterName: 'Main Pilot',
				role: 'hr_admin',
				grantedBy: 'granted-by',
				grantedAt: new Date(),
				expiresAt: null,
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		] as any)

		const app = createApp(makeUser(), dbStub)
		const res = await app.request(
			'/api/fulcrum/reports/batch',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					requestSource: 'hr',
					characterIds: ['3001', '3002'],
					sendDm: false,
				}),
			},
			env
		)

		expect(res.status).toBe(201)
		expect(fulcrumStub.createBulkCharacterReports).toHaveBeenCalledWith({
			characterIds: ['3001', '3002'],
			requestorUserId: 'user-1',
			requestorCorporationId: '1001',
			requestSource: 'hr',
			applicationId: undefined,
			targetUserId: 'target-user',
			sendDm: false,
		})
	})

	it('blocks report creation for non-auditor without hr_reviewer+', async () => {
		dbStub.query.userCharacters.findFirst.mockResolvedValue({
			userId: 'target-user',
			characterName: 'Target Pilot',
		} as any)
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
		expect(await res.json()).toEqual({
			error: 'Fulcrum report requests are not allowed for this character',
		})
		expect(fulcrumStub.createCharacterReport).not.toHaveBeenCalled()
	})

	it('blocks hr_admin report creation for member corp CEOs unless auditor or admin', async () => {
		dbStub.query.userCharacters.findFirst.mockResolvedValue({
			userId: 'target-user',
			characterName: 'Target Pilot',
		} as any)
		eveCorporationDataStub.getCorporationInfo.mockResolvedValue({ ceoId: '3001' })
		hrStub.checkPermission.mockResolvedValue(false)
		hrStub.getUserRoles.mockResolvedValue([
			{
				id: 'role-1',
				corporationId: '1001',
				userId: 'user-1',
				characterId: 'user-1',
				characterName: 'Main Pilot',
				role: 'hr_admin',
				grantedBy: 'granted-by',
				grantedAt: new Date(),
				expiresAt: null,
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		] as any)
		hrStub.listApplications.mockResolvedValue([
			{
				id: 'app-1',
				corporationId: '1001',
				userId: 'target-user',
				characterId: '3001',
				characterName: 'Target Pilot One',
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

		const app = createApp(makeUser(), dbStub)
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
		expect(await res.json()).toEqual({
			error: 'Only auditors or site admins can request reports for member corp CEOs',
		})
		expect(fulcrumStub.createCharacterReport).not.toHaveBeenCalled()
	})

	it('blocks batch report creation for member corp CEOs unless auditor or admin', async () => {
		dbStub.query.userCharacters.findFirst
			.mockResolvedValueOnce({
				userId: 'target-user',
				characterName: 'Target Pilot One',
			} as any)
			.mockResolvedValueOnce({
				userId: 'target-user',
				characterName: 'Target Pilot Two',
			} as any)
		eveCorporationDataStub.getCorporationInfo.mockResolvedValue({ ceoId: '3001' })
		hrStub.checkPermission.mockResolvedValue(true)
		hrStub.getUserRoles.mockResolvedValue([
			{
				id: 'role-1',
				corporationId: '1001',
				userId: 'user-1',
				characterId: 'user-1',
				characterName: 'Main Pilot',
				role: 'hr_admin',
				grantedBy: 'granted-by',
				grantedAt: new Date(),
				expiresAt: null,
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		] as any)
		hrStub.listApplications.mockResolvedValue([
			{
				id: 'app-1',
				corporationId: '1001',
				userId: 'target-user',
				characterId: '3001',
				characterName: 'Target Pilot One',
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

		const app = createApp(makeUser(), dbStub)
		const res = await app.request(
			'/api/fulcrum/reports/batch',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					requestSource: 'hr',
					characterIds: ['3001', '3002'],
				}),
			},
			env
		)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({
			error: 'Only auditors or site admins can request reports for member corp CEOs',
		})
		expect(fulcrumStub.createBulkCharacterReports).not.toHaveBeenCalled()
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
			targetUserId: 'user-1',
			sendDm: true,
		})
	})

	it('blocks hr_viewer report creation even when the target user has an open application', async () => {
		hrStub.checkPermission.mockResolvedValue(false)
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
		hrStub.listApplications.mockImplementation(
			async (_filters: any, _userId: string, _access: any) =>
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
								status: 'accepted',
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
		expect(await res.json()).toEqual({
			error: 'Fulcrum report requests are not allowed for this character',
		})
		expect(fulcrumStub.createCharacterReport).not.toHaveBeenCalled()
	})

	it('blocks hr_viewer report creation when the target user has no open application', async () => {
		hrStub.checkPermission.mockResolvedValue(false)
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
		eveCharacterDataStub.getInstance.mockResolvedValue({
			getCharacterInfo: vi.fn().mockResolvedValue({
				characterId: '3001',
				corporationId: '2002',
			}),
		} as any)

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
			error: 'Fulcrum report requests are not allowed for this character',
		})
		expect(fulcrumStub.createCharacterReport).not.toHaveBeenCalled()
	})

	it('blocks hr_viewer bulk report creation even when the target user has an open application', async () => {
		dbStub.query.userCharacters.findFirst.mockResolvedValue({
			userId: 'target-user',
			characterName: 'Target Pilot',
		} as any)
		hrStub.checkPermission.mockResolvedValue(false)
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
		hrStub.listApplications.mockImplementation(
			async (_filters: any, _userId: string, _access: any) =>
				[
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
				] as any
		)

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
		expect(await res.json()).toEqual({
			error: 'Fulcrum report requests are not allowed for these characters',
		})
		expect(fulcrumStub.createBulkCharacterReports).not.toHaveBeenCalled()
	})

	it('allows hr_reviewer bulk report creation when the target user has an open application', async () => {
		dbStub.query.userCharacters.findFirst
			.mockResolvedValueOnce({
				userId: 'target-user',
				characterName: 'Target Pilot One',
			} as any)
			.mockResolvedValueOnce({
				userId: 'target-user',
				characterName: 'Target Pilot Two',
			} as any)
		hrStub.checkPermission.mockResolvedValue(true)
		hrStub.getUserRoles.mockResolvedValue([
			{
				id: 'role-1',
				corporationId: '1001',
				userId: 'user-1',
				characterId: 'user-1',
				characterName: 'Main Pilot',
				role: 'hr_reviewer',
				grantedBy: 'granted-by',
				grantedAt: new Date(),
				expiresAt: null,
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		] as any)
		hrStub.listApplications.mockImplementation(async (filters: any) =>
			filters.userId === 'target-user'
				? [
						{
							id: 'app-1',
							corporationId: '1001',
							userId: 'target-user',
							characterId: '3001',
							characterName: 'Target Pilot One',
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
				: []
		)

		const app = createApp(makeUser(), dbStub)
		const res = await app.request(
			'/api/fulcrum/reports/batch',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					requestSource: 'hr',
					characterIds: ['3001', '3002'],
					sendDm: false,
				}),
			},
			env
		)

		expect(res.status).toBe(201)
		expect(fulcrumStub.createBulkCharacterReports).toHaveBeenCalledWith({
			characterIds: ['3001', '3002'],
			requestorUserId: 'user-1',
			requestorCorporationId: '1001',
			requestSource: 'hr',
			applicationId: undefined,
			targetUserId: 'target-user',
			sendDm: false,
		})
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
			targetUserId: 'user-1',
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
			env
		)

		expect(res.status).toBe(201)
		expect(fulcrumStub.createBulkCharacterReports).toHaveBeenCalledWith({
			characterIds: ['3001', '3002'],
			requestorUserId: 'user-1',
			requestorCorporationId: '1001',
			requestSource: 'hr',
			applicationId: undefined,
			targetUserId: 'user-1',
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
			env
		)

		expect(res.status).toBe(201)
		expect(fulcrumStub.createBulkCharacterReports).toHaveBeenCalledWith({
			characterIds: ['3001', '3002'],
			requestorUserId: 'user-1',
			requestorCorporationId: '1001',
			requestSource: 'hr',
			applicationId: undefined,
			targetUserId: 'user-1',
			sendDm: true,
		})
	})
})
