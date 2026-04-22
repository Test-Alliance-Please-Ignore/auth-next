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
	}
}

function makeRequest(overrides: Record<string, unknown> = {}) {
	const now = new Date().toISOString()
	return {
		id: 'req-1',
		userId: 'owner-1',
		characterId: '7002',
		characterName: 'Owner Character',
		corporationName: 'Corp',
		killmailId: '123',
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

		const response = await app.request('/api/srp/requests/req-1', {}, env)

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

		const response = await app.request('/api/srp/requests/req-1', {}, env)

		expect(response.status).toBe(200)
		expect(srpStub.getRequest).toHaveBeenCalledWith('req-1', 'staff-request-view')
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

		const response = await app.request('/api/srp/requests/req-1', {}, env)
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

		const response = await app.request('/api/srp/requests/req-1', {}, env)
		const body = await response.json<any>()

		expect(response.status).toBe(200)
		expect(body.history).toHaveLength(2)
		expect(body.history.find((entry: any) => entry.id === 'h-internal')).toBeTruthy()
	})

	it('denies non-owner non-staff from reading comments for another request', async () => {
		const app = createApp(makeUser({ id: 'outsider-comments-read' }))
		srpStub.getRequest.mockResolvedValue(makeRequest({ userId: 'owner-1' }))

		const response = await app.request('/api/srp/requests/req-1/comments?includeInternal=true', {}, env)

		expect(response.status).toBe(403)
		expect(srpStub.getComments).not.toHaveBeenCalled()
	})

	it('allows srp staff to read internal comments for another request', async () => {
		const app = createApp(makeUser({ id: 'staff-comments-read' }))
		srpStub.getRequest.mockResolvedValue(makeRequest({ userId: 'owner-1' }))
		getCachedUserPermissionsMock.mockImplementation(async (_env, userId) =>
			userId === 'staff-comments-read' ? ([{ urn: 'urn:srp:manager' }] as any) : []
		)

		const response = await app.request('/api/srp/requests/req-1/comments?includeInternal=true', {}, env)

		expect(response.status).toBe(200)
		expect(srpStub.getComments).toHaveBeenCalledWith('req-1', 'staff-comments-read', true)
	})

	it('allows srp staff to add internal comments for another request', async () => {
		const app = createApp(makeUser({ id: 'staff-comments-write' }))
		srpStub.getRequest.mockResolvedValue(makeRequest({ userId: 'owner-1' }))
		srpStub.addComment.mockResolvedValue({ id: 'comment-1' })
		getCachedUserPermissionsMock.mockImplementation(async (_env, userId) =>
			userId === 'staff-comments-write' ? ([{ urn: 'urn:srp:payer' }] as any) : []
		)

		const response = await app.request(
			'/api/srp/requests/req-1/comments',
			{
				method: 'POST',
				body: JSON.stringify({ content: 'Internal note', visibility: 'internal' }),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(response.status).toBe(201)
		expect(srpStub.addComment).toHaveBeenCalledWith(
			'req-1',
			'staff-comments-write',
			'Pilot One',
			'Internal note',
			'internal'
		)
	})
})
