import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { getStub } from '@repo/do-utils'

import { createDb } from '../../db'
import { getCachedUserPermissions } from '../../lib/groups-cache'
import srpRoutes from '../srp'

import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: vi.fn(),
}))

vi.mock('../../db', () => ({
	createDb: vi.fn(),
}))

const getStubMock = vi.mocked(getStub)
const getCachedUserPermissionsMock = vi.mocked(getCachedUserPermissions)
const createDbMock = vi.mocked(createDb)

const env = {
	SRP: {
		name: 'SRP',
		idFromName: vi.fn(),
		get: vi.fn(),
	},
	DOCTRINES: { name: 'DOCTRINES' },
	UNIVERSE: { name: 'UNIVERSE' },
	GROUPS: { name: 'GROUPS' },
	DATABASE_URL: 'postgres://test',
} as any

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: '7001',
		sessionId: 'session-1',
		characters: [
			{
				id: 'char-link-1',
				characterOwnerHash: 'owner-hash-1',
				characterId: '7001',
				characterName: 'Pilot One',
				is_primary: true,
				hasValidToken: true,
			},
		],
		is_admin: false,
		roles: [ROLE_CORE_ALLIANCE_MEMBER],
		discordUserId: null,
		...overrides,
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

	app.route('/api/srp', srpRoutes)
	return app
}

function makeSrpStub() {
	return {
		getUserRequests: vi.fn().mockResolvedValue([]),
		getRequest: vi.fn(),
		getComments: vi.fn().mockResolvedValue([]),
		addComment: vi.fn(),
		approveRequest: vi.fn(),
	}
}

function makeRequest(overrides: Record<string, unknown> = {}) {
	const now = new Date().toISOString()
	return {
		id: '100001',
		userId: 'owner-1',
		characterId: '7002',
		characterName: 'Owner Character',
		corporationName: 'Corp',
		shipTypeName: 'Drake',
		requestStatus: 'pending',
		lossDate: now,
		createdAt: now,
		updatedAt: now,
		comments: [],
		history: [],
		...overrides,
	}
}

function mockDbPrimaryCharacterRows(rows: Array<{ userId: string; characterId: string }>) {
	const where = vi.fn().mockResolvedValue(rows)
	const from = vi.fn(() => ({ where }))
	const select = vi.fn(() => ({ from }))
	createDbMock.mockReturnValue({ select } as any)
}

describe('srp routes - permissions', () => {
	let srpStub: ReturnType<typeof makeSrpStub>
	let doctrinesStub: { getFittings: ReturnType<typeof vi.fn>; getFitting: ReturnType<typeof vi.fn> }
	let universeStub: { resolveTypeNamesByIds: ReturnType<typeof vi.fn> }

	beforeEach(() => {
		vi.clearAllMocks()

		srpStub = makeSrpStub()
		doctrinesStub = {
			getFittings: vi.fn().mockResolvedValue([]),
			getFitting: vi.fn().mockResolvedValue(null),
		}
		universeStub = {
			resolveTypeNamesByIds: vi.fn().mockResolvedValue({}),
		}

		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.SRP) return srpStub as any
			if (binding === env.DOCTRINES) return doctrinesStub as any
			if (binding === env.UNIVERSE) return universeStub as any
			throw new Error('Unexpected binding')
		})

		getCachedUserPermissionsMock.mockResolvedValue([])
		mockDbPrimaryCharacterRows([])
	})

	it('lists requests for the authenticated user only', async () => {
		const app = createApp(makeUser({ id: 'request-list-user' }))

		const response = await app.request('/api/srp/requests', {}, env)

		expect(response.status).toBe(200)
		expect(srpStub.getUserRequests).toHaveBeenCalledWith('request-list-user', 50, 0)
	})

	it('denies non-owner non-staff from viewing another request', async () => {
		const app = createApp(makeUser({ id: 'outsider-request-view' }))
		srpStub.getRequest.mockResolvedValue(makeRequest({ userId: 'owner-1' }))

		const response = await app.request('/api/srp/requests/100001', {}, env)

		expect(response.status).toBe(403)
		expect(await response.json()).toEqual({ error: 'Not authorized to view this request' })
	})

	it('allows srp staff to view another users request', async () => {
		const app = createApp(makeUser({ id: 'staff-request-view' }))
		srpStub.getRequest.mockResolvedValue(makeRequest({ userId: 'owner-1' }))
		getCachedUserPermissionsMock.mockImplementation(async (_env, userId) =>
			userId === 'staff-request-view' ? ([{ urn: 'urn:srp:reviewer' }] as any) : []
		)
		mockDbPrimaryCharacterRows([{ userId: 'owner-1', characterId: '7002' }])

		const response = await app.request('/api/srp/requests/100001', {}, env)

		expect(response.status).toBe(200)
		expect(srpStub.getRequest).toHaveBeenCalledWith('100001', 'staff-request-view')
	})

	it('rejects non-killmail request ids on request detail routes', async () => {
		const app = createApp(makeUser({ id: 'owner-1' }))
		const response = await app.request('/api/srp/requests/req-legacy', {}, env)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: 'Invalid request id' })
		expect(srpStub.getRequest).not.toHaveBeenCalled()
	})

	it('returns killmail id as external request id in request detail responses', async () => {
		const app = createApp(makeUser({ id: 'owner-1' }))
		srpStub.getRequest.mockResolvedValue(
			makeRequest({ id: '654321', userId: 'owner-1' })
		)
		mockDbPrimaryCharacterRows([{ userId: 'owner-1', characterId: '7002' }])

		const response = await app.request('/api/srp/requests/654321', {}, env)
		const body = await response.json<any>()

		expect(response.status).toBe(200)
		expect(srpStub.getRequest).toHaveBeenCalledWith('654321', 'owner-1')
		expect(body.id).toBe('654321')
	})

	it('filters internal history for owner without srp staff permissions', async () => {
		const app = createApp(makeUser({ id: 'owner-history-view' }))
		srpStub.getRequest.mockResolvedValue(
			makeRequest({
				userId: 'owner-history-view',
				history: [
					{
						id: 'h-public',
						action: 'request_created',
						visibility: 'public',
						actorCharacterName: 'Pilot One',
						timestamp: new Date().toISOString(),
						previousApprovedAmount: '1000000',
					},
					{
						id: 'h-internal',
						action: 'review_details',
						visibility: 'internal',
						actorCharacterName: 'Reviewer',
						timestamp: new Date().toISOString(),
						previousApprovedAmount: '2000000',
					},
				],
			})
		)
		mockDbPrimaryCharacterRows([{ userId: 'owner-history-view', characterId: '7002' }])

		const response = await app.request('/api/srp/requests/100001', {}, env)
		const body = await response.json<any>()

		expect(response.status).toBe(200)
		expect(body.history).toHaveLength(1)
		expect(body.history[0].id).toBe('h-public')
		expect(body.history[0].previousApprovedAmount).toBeUndefined()
	})

	it('returns internal history for srp staff', async () => {
		const app = createApp(makeUser({ id: 'staff-history-view' }))
		srpStub.getRequest.mockResolvedValue(
			makeRequest({
				userId: 'owner-1',
				history: [
					{
						id: 'h-public',
						action: 'request_created',
						visibility: 'public',
						actorCharacterName: 'Pilot One',
						timestamp: new Date().toISOString(),
						previousApprovedAmount: '1000000',
					},
					{
						id: 'h-internal',
						action: 'review_details',
						visibility: 'internal',
						actorCharacterName: 'Reviewer',
						timestamp: new Date().toISOString(),
						previousApprovedAmount: '2000000',
					},
				],
			})
		)
		getCachedUserPermissionsMock.mockImplementation(async (_env, userId) =>
			userId === 'staff-history-view' ? ([{ urn: 'urn:srp:reviewer' }] as any) : []
		)
		mockDbPrimaryCharacterRows([{ userId: 'owner-1', characterId: '7002' }])

		const response = await app.request('/api/srp/requests/100001', {}, env)
		const body = await response.json<any>()

		expect(response.status).toBe(200)
		expect(body.history).toHaveLength(2)
		expect(body.history.find((entry: any) => entry.id === 'h-internal')).toBeTruthy()
	})

	it('denies non-owner non-staff from reading comments for another request', async () => {
		const app = createApp(makeUser({ id: 'outsider-comments-read' }))
		srpStub.getRequest.mockResolvedValue(makeRequest({ userId: 'owner-1' }))

		const response = await app.request('/api/srp/requests/100001/comments?includeInternal=true', {}, env)

		expect(response.status).toBe(403)
		expect(srpStub.getComments).not.toHaveBeenCalled()
	})

	it('allows srp staff to read internal comments for another request', async () => {
		const app = createApp(makeUser({ id: 'staff-comments-read' }))
		srpStub.getRequest.mockResolvedValue(makeRequest({ userId: 'owner-1' }))
		getCachedUserPermissionsMock.mockImplementation(async (_env, userId) =>
			userId === 'staff-comments-read' ? ([{ urn: 'urn:srp:manager' }] as any) : []
		)

		const response = await app.request('/api/srp/requests/100001/comments?includeInternal=true', {}, env)

		expect(response.status).toBe(200)
		expect(srpStub.getComments).toHaveBeenCalledWith('100001', 'staff-comments-read', true)
	})

	it('allows srp staff to add internal comments for another request', async () => {
		const app = createApp(makeUser({ id: 'staff-comments-write' }))
		srpStub.getRequest.mockResolvedValue(makeRequest({ userId: 'owner-1' }))
		srpStub.addComment.mockResolvedValue({ id: 'comment-1' })
		getCachedUserPermissionsMock.mockImplementation(async (_env, userId) =>
			userId === 'staff-comments-write' ? ([{ urn: 'urn:srp:payer' }] as any) : []
		)

		const response = await app.request(
			'/api/srp/requests/100001/comments',
			{
				method: 'POST',
				body: JSON.stringify({ content: 'Internal note', visibility: 'internal' }),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(response.status).toBe(201)
		expect(srpStub.addComment).toHaveBeenCalledWith(
			'100001',
			'staff-comments-write',
			'Pilot One',
			'Internal note',
			'internal'
		)
	})

	it('approves requests using killmail id request keys', async () => {
		const app = createApp(makeUser({ id: 'staff-approve' }))
		srpStub.getRequest
			.mockResolvedValueOnce(makeRequest({ id: '777888', userId: 'owner-1' }))
			.mockResolvedValueOnce(makeRequest({ id: '777888', userId: 'owner-1' }))
		srpStub.approveRequest.mockResolvedValue(
			makeRequest({ id: '777888', userId: 'owner-1', requestStatus: 'approved' })
		)
		getCachedUserPermissionsMock.mockImplementation(async (_env, userId) =>
			userId === 'staff-approve' ? ([{ urn: 'urn:srp:reviewer' }] as any) : []
		)

		const response = await app.request(
			'/api/srp/requests/777888/approve',
			{
				method: 'POST',
				body: JSON.stringify({ approvedAmount: '1000000' }),
				headers: { 'content-type': 'application/json' },
			},
			env
		)
		const body = await response.json<any>()

		expect(response.status).toBe(200)
		expect(srpStub.approveRequest).toHaveBeenCalledWith(
			'777888',
			'staff-approve',
			'1000000',
			undefined
		)
		expect(body.id).toBe('777888')
	})
})
