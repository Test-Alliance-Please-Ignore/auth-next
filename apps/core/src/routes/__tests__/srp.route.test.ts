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
	EVE_TOKEN_STORE: { name: 'EVE_TOKEN_STORE' },
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
		getRecentLosses: vi.fn().mockResolvedValue([]),
		getRequest: vi.fn(),
		getRequestsByStatus: vi.fn().mockResolvedValue({ requests: [], total: 0 }),
		getPendingPayments: vi.fn().mockResolvedValue([]),
		markPaid: vi.fn(),
		withdrawRequest: vi.fn(),
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

function mockDbPrimaryCharacterRows(
	rows: Array<{ userId: string; characterId: string; characterName?: string }>
) {
	const where = vi.fn().mockResolvedValue(rows)
	const from = vi.fn(() => ({ where }))
	const select = vi.fn(() => ({ from }))
	createDbMock.mockReturnValue({ select } as any)
}

describe('srp routes - permissions', () => {
	let srpStub: ReturnType<typeof makeSrpStub>
	let tokenStoreStub: { validateToken: ReturnType<typeof vi.fn> }
	let doctrinesStub: { getFittings: ReturnType<typeof vi.fn>; getFitting: ReturnType<typeof vi.fn> }
	let universeStub: {
		resolveTypeNamesByIds: ReturnType<typeof vi.fn>
		resolveSolarSystemsByIds: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.clearAllMocks()

		srpStub = makeSrpStub()
		tokenStoreStub = {
			validateToken: vi.fn().mockResolvedValue({
				isValid: true,
				status: 'valid',
			}),
		}
		doctrinesStub = {
			getFittings: vi.fn().mockResolvedValue([]),
			getFitting: vi.fn().mockResolvedValue(null),
		}
		universeStub = {
			resolveTypeNamesByIds: vi.fn().mockResolvedValue({}),
			resolveSolarSystemsByIds: vi.fn().mockResolvedValue({}),
		}

		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.SRP) return srpStub as any
			if (binding === env.EVE_TOKEN_STORE) return tokenStoreStub as any
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

	it('returns partial losses with failedCharacters when one character fetch fails', async () => {
		const app = createApp(
			makeUser({
				id: 'loss-user',
				characters: [
					{
						id: 'char-link-1',
						characterOwnerHash: 'owner-hash-1',
						characterId: '7001',
						characterName: 'Pilot One',
						is_primary: true,
						hasValidToken: true,
					},
					{
						id: 'char-link-2',
						characterOwnerHash: 'owner-hash-2',
						characterId: '7002',
						characterName: 'Pilot Two',
						is_primary: false,
						hasValidToken: true,
					},
				],
			})
		)

		srpStub.getRecentLosses.mockImplementation(async (characterIds: string[]) => {
			if (characterIds[0] === '7002') {
				throw new Error('killmail fetch failed')
			}
			return [
				{
					killmailId: '123',
					killmailHash: 'hash-123',
					killmailTime: '2026-04-01T00:00:00.000Z',
					shipTypeId: '587',
					shipTypeName: 'Rifter',
					totalValue: '1000000',
					solarSystemId: '30000142',
					solarSystemName: 'Jita',
					victimCharacterId: '7001',
					hasSRPRequest: false,
				},
			]
		})

		const response = await app.request('/api/srp/losses?daysBack=60', {}, env)
		const body = await response.json<any>()

		expect(response.status).toBe(200)
		expect(srpStub.getRecentLosses).toHaveBeenCalledWith(['7001'], 'loss-user', 60)
		expect(srpStub.getRecentLosses).toHaveBeenCalledWith(['7002'], 'loss-user', 60)
		expect(body.losses).toHaveLength(1)
		expect(body.losses[0]).toMatchObject({
			killmailId: '123',
			victimCharacterId: '7001',
			victimCharacterName: 'Pilot One',
		})
		expect(body.failedCharacters).toEqual([
			{
				characterId: '7002',
				characterName: 'Pilot Two',
				reason: 'fetch_failed',
				message: 'Could not load losses right now. Please try again shortly.',
				error: 'killmail fetch failed',
			},
		])
	})

	it('returns invalid_token reason when a character token is invalid', async () => {
		const app = createApp(
			makeUser({
				id: 'loss-user-invalid-token',
				characters: [
					{
						id: 'char-link-1',
						characterOwnerHash: 'owner-hash-1',
						characterId: '7001',
						characterName: 'Pilot One',
						is_primary: true,
						hasValidToken: true,
					},
					{
						id: 'char-link-2',
						characterOwnerHash: 'owner-hash-2',
						characterId: '7002',
						characterName: 'Pilot Two',
						is_primary: false,
						hasValidToken: false,
					},
				],
			})
		)

		tokenStoreStub.validateToken.mockImplementation(async (characterId: string) => {
			if (characterId === '7002') {
				return {
					isValid: false,
					status: 'invalid',
					error: 'expired',
				}
			}
			return { isValid: true, status: 'valid' }
		})
		srpStub.getRecentLosses.mockResolvedValue([
			{
				killmailId: '123',
				killmailHash: 'hash-123',
				killmailTime: '2026-04-01T00:00:00.000Z',
				shipTypeId: '587',
				shipTypeName: 'Rifter',
				totalValue: '1000000',
				solarSystemId: '30000142',
				solarSystemName: 'Jita',
				victimCharacterId: '7001',
				hasSRPRequest: false,
			},
		])

		const response = await app.request('/api/srp/losses?daysBack=60', {}, env)
		const body = await response.json<any>()

		expect(response.status).toBe(200)
		expect(srpStub.getRecentLosses).toHaveBeenCalledWith(['7001'], 'loss-user-invalid-token', 60)
		expect(body.losses).toHaveLength(1)
		expect(body.failedCharacters).toEqual([
			{
				characterId: '7002',
				characterName: 'Pilot Two',
				reason: 'invalid_token',
				message: 'ESI token is invalid or expired. Please re-authenticate this character.',
			},
		])
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

	it('allows requestor to view withdrawn request detail', async () => {
		const app = createApp(makeUser({ id: 'owner-withdrawn-hidden' }))
		srpStub.getRequest.mockResolvedValue(
			makeRequest({
				id: '100009',
				userId: 'owner-withdrawn-hidden',
				requestStatus: 'withdrawn',
			})
		)
		mockDbPrimaryCharacterRows([{ userId: 'owner-withdrawn-hidden', characterId: '7002' }])

		const response = await app.request('/api/srp/requests/100009', {}, env)

		expect(response.status).toBe(200)
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

	it('uses request character when requestor adds a follow-up comment', async () => {
		const app = createApp(
			makeUser({
				id: 'requestor-followup',
				characters: [
					{
						id: 'char-link-main',
						characterOwnerHash: 'owner-hash-main',
						characterId: '7001',
						characterName: 'Main Pilot',
						is_primary: true,
						hasValidToken: true,
					},
					{
						id: 'char-link-alt',
						characterOwnerHash: 'owner-hash-alt',
						characterId: '7002',
						characterName: 'Alt Pilot',
						is_primary: false,
						hasValidToken: true,
					},
				],
			})
		)
		srpStub.getRequest.mockResolvedValue(
			makeRequest({
				id: '100010',
				userId: 'requestor-followup',
				characterId: '7002',
				characterName: 'Alt Pilot',
			})
		)
		srpStub.addComment.mockResolvedValue({ id: 'comment-requestor' })

		const response = await app.request(
			'/api/srp/requests/100010/comments',
			{
				method: 'POST',
				body: JSON.stringify({ content: 'Need to add context', visibility: 'public' }),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(response.status).toBe(201)
		expect(srpStub.addComment).toHaveBeenCalledWith(
			'100010',
			'requestor-followup',
			'Alt Pilot',
			'Need to add context',
			'public'
		)
	})

	it('hydrates comment author role and main metadata for requestor and staff', async () => {
		const app = createApp(makeUser({ id: 'staff-hydrate-comments' }))
		srpStub.getRequest.mockResolvedValue(
			makeRequest({
				id: '100011',
				userId: 'owner-1',
				characterId: '7002',
				characterName: 'Owner Alt',
			})
		)
		srpStub.getComments.mockResolvedValue([
			{
				id: 'comment-requestor',
				requestId: '100011',
				authorUserId: 'owner-1',
				authorCharacterName: 'Unknown',
				content: 'Requestor follow-up',
				visibility: 'public',
				isEdited: false,
				createdAt: new Date().toISOString(),
			},
			{
				id: 'comment-staff',
				requestId: '100011',
				authorUserId: 'staff-hydrate-comments',
				authorCharacterName: 'Reviewer',
				content: 'Internal note',
				visibility: 'internal',
				isEdited: false,
				createdAt: new Date().toISOString(),
			},
		] as any)
		getCachedUserPermissionsMock.mockImplementation(async (_env, userId) =>
			userId === 'staff-hydrate-comments' ? ([{ urn: 'urn:srp:manager' }] as any) : []
		)
		mockDbPrimaryCharacterRows([
			{ userId: 'owner-1', characterId: '7001', characterName: 'Owner Main' },
			{
				userId: 'staff-hydrate-comments',
				characterId: '9001',
				characterName: 'Staff Main',
			},
		])

		const response = await app.request('/api/srp/requests/100011/comments?includeInternal=true', {}, env)
		const body = await response.json<any[]>()

		expect(response.status).toBe(200)
		expect(body).toHaveLength(2)
		expect(body[0]).toMatchObject({
			id: 'comment-requestor',
			authorCharacterName: 'Owner Alt',
			authorCharacterId: '7002',
			authorMainCharacterName: 'Owner Main',
			authorMainCharacterId: '7001',
			authorCharacterRole: 'alt',
			authorRole: 'requestor',
		})
		expect(body[1]).toMatchObject({
			id: 'comment-staff',
			authorMainCharacterName: 'Staff Main',
			authorMainCharacterId: '9001',
			authorRole: 'staff',
		})
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

	it('allows payer role to perform reviewer approval actions', async () => {
		const app = createApp(makeUser({ id: 'payer-approve' }))
		srpStub.getRequest.mockResolvedValue(makeRequest({ id: '888999', userId: 'owner-1' }))
		srpStub.approveRequest.mockResolvedValue(
			makeRequest({ id: '888999', userId: 'owner-1', requestStatus: 'approved' })
		)
		getCachedUserPermissionsMock.mockImplementation(async (_env, userId) =>
			userId === 'payer-approve' ? ([{ urn: 'urn:srp:payer' }] as any) : []
		)

		const response = await app.request(
			'/api/srp/requests/888999/approve',
			{
				method: 'POST',
				body: JSON.stringify({ approvedAmount: '2500000' }),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(response.status).toBe(200)
		expect(srpStub.approveRequest).toHaveBeenCalledWith(
			'888999',
			'payer-approve',
			'2500000',
			undefined
		)
	})

	it('allows payer-only users to access review queue listing', async () => {
		const app = createApp(makeUser({ id: 'payer-review-list' }))
		getCachedUserPermissionsMock.mockImplementation(async (_env, userId) =>
			userId === 'payer-review-list' ? ([{ urn: 'urn:srp:payer' }] as any) : []
		)

		const response = await app.request('/api/srp/requests/by-status?status=pending', {}, env)

		expect(response.status).toBe(200)
		expect(srpStub.getRequestsByStatus).toHaveBeenCalledWith('pending', {
			limit: 50,
			offset: 0,
			characterName: undefined,
			shipTypeName: undefined,
			solarSystemName: undefined,
			dateFrom: undefined,
			dateTo: undefined,
		})
	})

	it('allows manager role to access payer queue endpoints', async () => {
		const app = createApp(makeUser({ id: 'manager-payments' }))
		getCachedUserPermissionsMock.mockImplementation(async (_env, userId) =>
			userId === 'manager-payments' ? ([{ urn: 'urn:srp:manager' }] as any) : []
		)

		const response = await app.request('/api/srp/payments/pending', {}, env)

		expect(response.status).toBe(200)
		expect(srpStub.getPendingPayments).toHaveBeenCalledWith(undefined, 50, 0)
	})

	it('does not allow admin bypass on mark-paid mutation without payer-tier permission', async () => {
		const app = createApp(makeUser({ id: 'admin-no-payer', is_admin: true }))

		const response = await app.request(
			'/api/srp/requests/100001/mark-paid',
			{
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(response.status).toBe(403)
		expect(await response.json()).toEqual({ error: 'Requires payer-or-higher permissions' })
		expect(srpStub.markPaid).not.toHaveBeenCalled()
	})

	it('allows request owner to withdraw pending request', async () => {
		const app = createApp(makeUser({ id: 'owner-withdraw' }))
		srpStub.getRequest.mockResolvedValue(
			makeRequest({ id: '999001', userId: 'owner-withdraw', requestStatus: 'pending' })
		)
		srpStub.withdrawRequest.mockResolvedValue(
			makeRequest({ id: '999001', userId: 'owner-withdraw', requestStatus: 'withdrawn' })
		)

		const response = await app.request(
			'/api/srp/requests/999001/withdraw',
			{
				method: 'POST',
				body: JSON.stringify({ notes: 'withdrawing for now' }),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(response.status).toBe(200)
		expect(srpStub.withdrawRequest).toHaveBeenCalledWith(
			'999001',
			'owner-withdraw',
			'Pilot One',
			'withdrawing for now'
		)
	})

	it('denies withdraw for non-owner', async () => {
		const app = createApp(makeUser({ id: 'not-owner-withdraw' }))
		srpStub.getRequest.mockResolvedValue(
			makeRequest({ id: '999002', userId: 'owner-1', requestStatus: 'pending' })
		)

		const response = await app.request(
			'/api/srp/requests/999002/withdraw',
			{
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(response.status).toBe(403)
		expect(await response.json()).toEqual({ error: 'Not authorized to withdraw this request' })
		expect(srpStub.withdrawRequest).not.toHaveBeenCalled()
	})

	it('returns 422 when withdraw is attempted for non-withdrawable state', async () => {
		const app = createApp(makeUser({ id: 'owner-withdraw-422' }))
		srpStub.getRequest.mockResolvedValue(
			makeRequest({ id: '999003', userId: 'owner-withdraw-422', requestStatus: 'approved' })
		)
		srpStub.withdrawRequest.mockRejectedValue(
			new Error('Only pending or needs_context requests can be withdrawn')
		)

		const response = await app.request(
			'/api/srp/requests/999003/withdraw',
			{
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(response.status).toBe(422)
		expect(await response.json()).toEqual({
			error: 'Only pending or needs_context requests can be withdrawn',
		})
	})
})
