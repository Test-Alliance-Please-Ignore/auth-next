import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { getStub } from '@repo/do-utils'

import { createDb } from '../../db'
import billsUserRoutes, { clearUserBillScopeCache } from '../bills-user'

import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
	withRpcResult: (promise: Promise<unknown>, map: (value: any) => unknown) => promise.then(map),
}))

vi.mock('../../db', () => ({
	createDb: vi.fn(),
}))

const getStubMock = vi.mocked(getStub)
const createDbMock = vi.mocked(createDb)
let billsStub: ReturnType<typeof makeBillsStub>
let resolverStub: ReturnType<typeof makeResolverStub>
let characterStub: ReturnType<typeof makeCharacterDataStub>
let corporationStub: ReturnType<typeof makeCorporationDataStub>
let groupsStub: ReturnType<typeof makeGroupsStub>

const env = {
	BILLS: { name: 'BILLS' },
	ESI_TYPE_RESOLVER: { name: 'ESI_TYPE_RESOLVER' },
	EVE_CHARACTER_DATA: { name: 'EVE_CHARACTER_DATA' },
	EVE_CORPORATION_DATA: { name: 'EVE_CORPORATION_DATA' },
	GROUPS: { name: 'GROUPS' },
	DATABASE_URL: 'postgres://example',
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
	app.route('/api/bills', billsUserRoutes)
	return app
}

function makeBillsStub() {
	return {
		createBill: vi.fn().mockResolvedValue({ id: 'bill-created', issuerId: 'user-1' }),
		createBillsBulk: vi.fn().mockResolvedValue([{ id: 'bill-created', issuerId: 'user-1' }]),
		updateBill: vi.fn().mockResolvedValue({ id: 'bill-1' }),
		deleteBill: vi.fn().mockResolvedValue(undefined),
		issueBill: vi.fn().mockResolvedValue({ id: 'bill-1', status: 'issued' }),
		cancelBill: vi.fn().mockResolvedValue({ id: 'bill-1', status: 'cancelled' }),
		markBillPaid: vi.fn().mockResolvedValue({ id: 'bill-1', status: 'paid' }),
		markRelatedBillPaid: vi.fn().mockResolvedValue({ id: 'bill-1', status: 'paid' }),
		revertBillToDraft: vi.fn().mockResolvedValue({ id: 'bill-1', status: 'draft' }),
		regeneratePaymentToken: vi.fn().mockResolvedValue({ billId: 'bill-1', token: 'token' }),
		listBillsPage: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
		searchBillParties: vi.fn().mockResolvedValue([]),
		getBill: vi.fn().mockResolvedValue(null),
		getBillIntegrationView: vi.fn().mockResolvedValue(null),
	}
}

describe('issuer manual bill routes', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		createDbMock.mockReturnValue(makeDbStub() as any)
		billsStub = makeBillsStub()
		groupsStub = makeGroupsStub()
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.BILLS) return billsStub as any
			if (binding === env.GROUPS) return groupsStub as any
			throw new Error('Unexpected durable object binding in issuer test')
		})
	})

	it('allows the grantable issuer permission to create a manual bill as the session user', async () => {
		groupsStub.getUserPermissions.mockResolvedValueOnce([{ urn: 'urn:billing:issuer' }])
		const app = createApp(makeUser({ id: 'issuer-user', roles: [] }))
		const response = await app.request(
			'/api/bills/issued',
			{
				method: 'POST',
				body: JSON.stringify({
					payerId: '7001',
					payerType: 'character',
					payeeId: '9001',
					payeeType: 'corporation',
					title: 'Manual charge',
					amount: '1000',
					dueDate: '2026-05-01T00:00:00.000Z',
					externalSourceType: 'corporation_tax_assessment',
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(response.status).toBe(201)
		expect(billsStub.createBill).toHaveBeenCalledWith(
			'issuer-user',
			expect.objectContaining({ payerId: '7001', title: 'Manual charge' })
		)
		const createdData = billsStub.createBill.mock.calls[0]?.[1] as Record<string, unknown>
		expect(createdData.externalSourceType).toBeUndefined()
	})

	it('allows the baseline issuer permission to use group fan-out', async () => {
		groupsStub.getUserPermissions.mockResolvedValueOnce([{ urn: 'urn:billing:issuer' }])
		groupsStub.getGroup.mockResolvedValueOnce({
			id: 'group-1',
			ownerId: 'member-owner',
			adminUserIds: [],
		})
		groupsStub.getGroupMembers.mockResolvedValueOnce([
			{ userId: 'member-owner', mainCharacterId: '7001' },
		])
		const app = createApp(makeUser({ id: 'issuer-user', roles: [] }))
		const response = await app.request(
			'/api/bills/issued',
			{
				method: 'POST',
				body: JSON.stringify({
					payerId: 'group-1',
					payerType: 'group',
					payeeId: '9001',
					payeeType: 'corporation',
					title: 'Group charge',
					amount: '1000',
					dueDate: '2026-05-01T00:00:00.000Z',
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(response.status).toBe(201)
		expect(billsStub.createBillsBulk).toHaveBeenCalledWith(
			'issuer-user',
			expect.arrayContaining([
				expect.objectContaining({
					payerId: '7001',
					payerType: 'character',
					groupBillId: expect.any(String),
				}),
			])
		)
	})

	it('restricts scoped issuer creation to affiliated characters and corporations', async () => {
		groupsStub.getUserPermissions.mockResolvedValueOnce([{ urn: 'urn:billing:issuer:9900' }])
		const db = makeDbStub()
		db.query.userCharacters.findMany
			.mockResolvedValueOnce([{ characterId: '7001' }])
			.mockResolvedValueOnce([{ characterId: '9002' }])
		db.query.managedCorporations.findMany.mockResolvedValueOnce([{ corporationId: '9900' }])
		createDbMock.mockReturnValue(db as any)
		const app = createApp(makeUser({ id: 'scoped-issuer-user', roles: [] }))

		const allowed = await app.request(
			'/api/bills/issued',
			{
				method: 'POST',
				body: JSON.stringify({
					payerId: '7001',
					payerType: 'character',
					payeeId: '9900',
					payeeType: 'corporation',
					title: 'Scoped charge',
					amount: '1000',
					dueDate: '2026-05-01T00:00:00.000Z',
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)
		expect(allowed.status).toBe(201)

		const outOfScope = await app.request(
			'/api/bills/issued',
			{
				method: 'POST',
				body: JSON.stringify({
					payerId: '7001',
					payerType: 'group',
					payeeId: '9900',
					payeeType: 'corporation',
					title: 'Invalid scoped group',
					amount: '1000',
					dueDate: '2026-05-01T00:00:00.000Z',
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)
		expect(outOfScope.status).toBe(400)
		expect(billsStub.createBill).toHaveBeenCalledTimes(1)
	})

	it('unions valid scoped grants and ignores malformed issuer URNs', async () => {
		groupsStub.getUserPermissions.mockResolvedValueOnce([
			{ urn: 'urn:billing:issuer:9900' },
			{ urn: 'urn:billing:issuer:09900' },
			{ urn: 'urn:billing:issuer:not-a-corporation' },
		])
		const app = createApp(makeUser({ id: 'scope-endpoint-user', roles: [] }))

		const response = await app.request('/api/bills/issued/scope', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			unrestricted: false,
			corporationIds: ['9900'],
			corporations: [],
		})
	})

	it('rejects a scoped character payee outside the granted corporation', async () => {
		groupsStub.getUserPermissions.mockResolvedValueOnce([{ urn: 'urn:billing:issuer:9900' }])
		const db = makeDbStub()
		db.query.userCharacters.findMany
			.mockResolvedValueOnce([{ characterId: '7001' }])
			.mockResolvedValueOnce([])
		createDbMock.mockReturnValue(db as any)
		const app = createApp(makeUser({ id: 'scoped-payee-user', roles: [] }))

		const response = await app.request(
			'/api/bills/issued',
			{
				method: 'POST',
				body: JSON.stringify({
					payerId: '7001',
					payerType: 'character',
					payeeId: '9002',
					payeeType: 'character',
					title: 'Out of scope payee',
					amount: '1000',
					dueDate: '2026-05-01T00:00:00.000Z',
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(response.status).toBe(400)
		expect(billsStub.createBill).not.toHaveBeenCalled()
	})

	it('rejects malformed issuer bill input before calling the Bills worker', async () => {
		groupsStub.getUserPermissions.mockResolvedValueOnce([{ urn: 'urn:billing:issuer' }])
		const app = createApp(makeUser({ id: 'issuer-user', roles: [] }))
		const response = await app.request(
			'/api/bills/issued',
			{
				method: 'POST',
				body: JSON.stringify({
					payerId: '7001',
					payerType: 'character',
					payeeId: '9001',
					payeeType: 'corporation',
					title: 'Invalid charge',
					amount: '0',
					dueDate: 'not-a-date',
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(response.status).toBe(400)
		expect(billsStub.createBill).not.toHaveBeenCalled()
	})

	it('does not expose issuer routes without the permission', async () => {
		const app = createApp(makeUser({ roles: [] }))
		const response = await app.request('/api/bills/issued', {}, env)
		expect(response.status).toBe(403)
		expect(billsStub.listBillsPage).not.toHaveBeenCalled()
	})

	it('denies issuer mutations even when the user owns the bill without issuer permission', async () => {
		groupsStub.getUserPermissions.mockResolvedValueOnce([])
		const app = createApp(makeUser({ roles: [ROLE_CORE_ALLIANCE_MEMBER], id: 'no-issuer-user' }))
		const response = await app.request('/api/bills/issued/bill-1', { method: 'DELETE' }, env)

		expect(response.status).toBe(403)
		expect(billsStub.getBillIntegrationView).not.toHaveBeenCalled()
		expect(billsStub.cancelBill).not.toHaveBeenCalled()
	})

	it('does not allow issuer mutation of tax-sourced bills', async () => {
		groupsStub.getUserPermissions.mockResolvedValueOnce([{ urn: 'urn:billing:issuer' }])
		billsStub.getBillIntegrationView.mockResolvedValueOnce({
			id: 'bill-1',
			issuerId: 'issuer-tax',
			externalSourceType: 'corporation_tax_assessment',
		})
		const app = createApp(makeUser({ id: 'issuer-tax', roles: [] }))
		const response = await app.request('/api/bills/issued/bill-1/issue', { method: 'POST' }, env)
		expect(response.status).toBe(404)
		expect(billsStub.issueBill).not.toHaveBeenCalled()
	})

	it('does not allow issuer mutation of template-generated bills', async () => {
		groupsStub.getUserPermissions.mockResolvedValueOnce([{ urn: 'urn:billing:issuer' }])
		billsStub.getBillIntegrationView.mockResolvedValueOnce({
			id: 'bill-1',
			issuerId: 'issuer-user',
			externalSourceType: 'manual',
			templateId: 'template-1',
			scheduleId: null,
			groupBillId: null,
		})
		const app = createApp(makeUser({ id: 'issuer-user', roles: [] }))
		const response = await app.request('/api/bills/issued/bill-1/issue', { method: 'POST' }, env)

		expect(response.status).toBe(404)
		expect(billsStub.issueBill).not.toHaveBeenCalled()
	})

	it("does not allow an issuer to mutate another user's manual bill", async () => {
		groupsStub.getUserPermissions.mockResolvedValueOnce([{ urn: 'urn:billing:issuer' }])
		billsStub.getBillIntegrationView.mockResolvedValueOnce({
			id: 'bill-1',
			issuerId: 'different-user',
			externalSourceType: 'manual',
			templateId: null,
			scheduleId: null,
			groupBillId: null,
		})
		const app = createApp(makeUser({ id: 'issuer-user', roles: [] }))
		const response = await app.request('/api/bills/issued/bill-1/cancel', { method: 'POST' }, env)

		expect(response.status).toBe(404)
		expect(billsStub.cancelBill).not.toHaveBeenCalled()
	})

	it('allows an issuer to mark their own manual bill paid', async () => {
		groupsStub.getUserPermissions.mockResolvedValueOnce([{ urn: 'urn:billing:issuer' }])
		billsStub.getBillIntegrationView.mockResolvedValueOnce({
			id: 'bill-1',
			issuerId: 'issuer-user',
			externalSourceType: 'manual',
			templateId: null,
			scheduleId: null,
			groupBillId: null,
		})
		const app = createApp(makeUser({ id: 'issuer-user', roles: [] }))
		const response = await app.request(
			'/api/bills/issued/bill-1/mark-paid',
			{ method: 'POST' },
			env
		)

		expect(response.status).toBe(200)
		expect(billsStub.markBillPaid).toHaveBeenCalledWith('issuer-user', 'bill-1', 'owner')
	})

	it('does not allow a related viewer to mark a non-manual bill paid', async () => {
		groupsStub.getUserPermissions.mockResolvedValue([{ urn: 'urn:billing:issuer' }])
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.BILLS) return billsStub as any
			if (binding === env.GROUPS) return groupsStub as any
			if (binding === env.EVE_CHARACTER_DATA)
				return { getCharacterInfo: vi.fn().mockResolvedValue({ corporationId: '9900' }) } as any
			if (binding === env.EVE_CORPORATION_DATA)
				return {
					getCorporationInfo: vi.fn().mockResolvedValue({ ceoId: '9999' }),
					getDirectors: vi.fn().mockResolvedValue([]),
				} as any
			throw new Error('Unexpected durable object binding in issuer test')
		})
		billsStub.getBillIntegrationView.mockResolvedValue({
			id: 'bill-1',
			issuerId: 'tax-issuer',
			payerId: '7001',
			payerType: 'character',
			payeeId: '9001',
			payeeType: 'corporation',
			externalSourceType: 'corporation_tax_assessment',
			status: 'issued',
		})
		const app = createApp(makeUser({ id: 'issuer-user', roles: [] }))

		const response = await app.request(
			'/api/bills/my-bills/bill-1/mark-paid',
			{ method: 'POST' },
			env
		)

		expect(response.status).toBe(404)
		expect(billsStub.markBillPaid).not.toHaveBeenCalled()
		expect(billsStub.markRelatedBillPaid).not.toHaveBeenCalled()
	})

	it('does not allow marking an unrelated non-manual bill paid', async () => {
		groupsStub.getUserPermissions.mockResolvedValue([{ urn: 'urn:billing:issuer' }])
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.BILLS) return billsStub as any
			if (binding === env.GROUPS) return groupsStub as any
			if (binding === env.EVE_CHARACTER_DATA)
				return { getCharacterInfo: vi.fn().mockResolvedValue({ corporationId: '9900' }) } as any
			if (binding === env.EVE_CORPORATION_DATA)
				return {
					getCorporationInfo: vi.fn().mockResolvedValue({ ceoId: '9999' }),
					getDirectors: vi.fn().mockResolvedValue([]),
				} as any
			throw new Error('Unexpected durable object binding in issuer test')
		})
		billsStub.getBillIntegrationView.mockResolvedValue({
			id: 'bill-1',
			issuerId: 'tax-issuer',
			payerId: 'unrelated-payer',
			payerType: 'character',
			payeeId: 'unrelated-payee',
			payeeType: 'corporation',
			externalSourceType: 'corporation_tax_assessment',
			status: 'issued',
		})
		const app = createApp(makeUser({ id: 'issuer-user', roles: [] }))

		const response = await app.request(
			'/api/bills/my-bills/bill-1/mark-paid',
			{ method: 'POST' },
			env
		)

		expect(response.status).toBe(404)
		expect(billsStub.markRelatedBillPaid).not.toHaveBeenCalled()
	})
})

function makeResolverStub() {
	return {
		resolveIds: vi.fn().mockResolvedValue({}),
	}
}

function makeCharacterDataStub() {
	return {
		getCharacterInfo: vi.fn().mockResolvedValue({ corporationId: '9900' }),
	}
}

function makeCorporationDataStub() {
	return {
		getCorporationInfo: vi.fn().mockResolvedValue({ ceoId: '9999' }),
		getDirectors: vi.fn().mockResolvedValue([]),
	}
}

function makeGroupsStub() {
	return {
		getUserPermissions: vi.fn().mockResolvedValue([]),
		getUserMemberships: vi.fn().mockResolvedValue([]),
		getGroupMetadataByIds: vi.fn().mockResolvedValue([]),
		listGroups: vi.fn().mockResolvedValue([]),
		getGroup: vi.fn().mockResolvedValue(null),
		getGroupMembers: vi.fn().mockResolvedValue([]),
	}
}

function makeDbStub() {
	return {
		query: {
			userCharacters: {
				findMany: vi.fn().mockResolvedValue([{ characterId: '7001', characterName: 'Pilot One' }]),
			},
			managedCorporations: {
				findMany: vi.fn().mockResolvedValue([]),
			},
			users: {
				findMany: vi.fn().mockResolvedValue([]),
				findFirst: vi.fn().mockResolvedValue({ mainCharacterId: '7001' }),
			},
		},
	}
}

describe('bills-user routes access matrix', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		void clearUserBillScopeCache()
		createDbMock.mockReturnValue(makeDbStub() as any)
		billsStub = makeBillsStub()
		resolverStub = makeResolverStub()
		characterStub = makeCharacterDataStub()
		corporationStub = makeCorporationDataStub()
		groupsStub = makeGroupsStub()
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.BILLS) return billsStub as any
			if (binding === env.ESI_TYPE_RESOLVER) return resolverStub as any
			if (binding === env.EVE_CHARACTER_DATA) return characterStub as any
			if (binding === env.EVE_CORPORATION_DATA) return corporationStub as any
			if (binding === env.GROUPS) return groupsStub as any
			throw new Error('Unexpected durable object binding in test')
		})
	})

	it('returns 401 for unauthenticated user-route requests', async () => {
		const app = createApp()
		const response = await app.request('/api/bills/my-bills', {}, env)
		expect(response.status).toBe(401)
		expect(await response.json()).toEqual({ error: 'Unauthorized' })
	})

	it('returns 403 for authenticated users without billing viewer role (non-admin)', async () => {
		const app = createApp(makeUser({ roles: [], is_admin: false }))
		const response = await app.request('/api/bills/my-bills', {}, env)
		expect(response.status).toBe(403)
		expect(await response.json()).toEqual({ error: 'Forbidden' })
	})

	it('uses my-scope for entity owners on list route', async () => {
		const app = createApp(makeUser({ is_admin: false, roles: [ROLE_CORE_ALLIANCE_MEMBER] }))
		const response = await app.request('/api/bills/my-bills?limit=25&offset=0', {}, env)
		expect(response.status).toBe(200)
		expect(billsStub.listBillsPage).toHaveBeenCalledTimes(1)
		expect(billsStub.listBillsPage.mock.calls[0]?.[0]?.scope?.mode).toBe('my')
	})

	it('keeps overdue bills visible when a due-date range is applied', async () => {
		const app = createApp(makeUser({ is_admin: false, roles: [ROLE_CORE_ALLIANCE_MEMBER] }))
		const response = await app.request(
			'/api/bills/my-bills?limit=25&offset=0&dueAfter=2026-08-01&dueBefore=2026-09-01',
			{},
			env
		)
		expect(response.status).toBe(200)
		expect(billsStub.listBillsPage.mock.calls[0]?.[0]?.filters).toMatchObject({
			dueAfter: new Date('2026-08-01'),
			dueBefore: new Date('2026-09-01'),
			includeOverdueBeyondDueAfter: true,
		})
	})

	it('rejects invalid bill-list dates instead of sending Invalid Date to the worker', async () => {
		const app = createApp(makeUser({ is_admin: false, roles: [ROLE_CORE_ALLIANCE_MEMBER] }))
		const response = await app.request('/api/bills/my-bills?dueAfter=not-a-date', {}, env)

		expect(response.status).toBe(400)
		expect(billsStub.listBillsPage).not.toHaveBeenCalled()
	})

	it('uses my-scope for site-admin on list and parties search routes', async () => {
		const app = createApp(makeUser({ is_admin: true, roles: [] }))
		const listResponse = await app.request('/api/bills/my-bills?limit=25&offset=0', {}, env)
		expect(listResponse.status).toBe(200)
		const partiesResponse = await app.request('/api/bills/my-bills/parties/search?q=7001', {}, env)
		expect(partiesResponse.status).toBe(200)

		expect(billsStub.listBillsPage.mock.calls[0]?.[0]?.scope?.mode).toBe('my')
		expect(billsStub.searchBillParties.mock.calls[0]?.[0]?.scope?.mode).toBe('my')
	})

	it('resolves party names before applying the bill-party usage limit', async () => {
		billsStub.searchBillParties.mockResolvedValueOnce([
			{ entityId: '7001', entityType: 'character', usageCount: 1 },
		])
		const app = createApp(makeUser())
		const response = await app.request(
			'/api/bills/my-bills/parties/search?q=Pilot&entityType=character',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(billsStub.searchBillParties).toHaveBeenCalledWith(
			expect.objectContaining({ entityIds: ['7001'], q: undefined, limit: 25 })
		)
	})

	it('allows an admin to fetch a related bill without granting global visibility', async () => {
		const app = createApp(makeUser({ is_admin: true, roles: [] }))
		const bill = {
			id: 'bill-1',
			issuerId: 'issuer-2',
			payerId: '7001',
			payerType: 'character',
			payeeId: '9001',
			payeeType: 'corporation',
			status: 'issued',
			payments: [],
		}
		billsStub.getBillIntegrationView.mockResolvedValueOnce(bill)

		const response = await app.request('/api/bills/my-bills/bill-1', {}, env)
		expect(response.status).toBe(200)
	})

	it('keeps a related draft hidden from an admin who is not the issuer', async () => {
		const app = createApp(makeUser({ is_admin: true, roles: [] }))
		const bill = {
			id: 'bill-1',
			issuerId: 'issuer-2',
			payerId: '7001',
			payerType: 'character',
			payeeId: '9001',
			payeeType: 'corporation',
			status: 'draft',
			payments: [],
		}
		billsStub.getBillIntegrationView.mockResolvedValueOnce(bill)

		const response = await app.request('/api/bills/my-bills/bill-1', {}, env)
		expect(response.status).toBe(404)
	})

	it('allows entity owner issuer to fetch bill detail', async () => {
		const app = createApp(makeUser({ id: 'issuer-1', is_admin: false }))
		const bill = {
			id: 'bill-1',
			issuerId: 'issuer-1',
			payerId: '7001',
			payerType: 'character',
			payeeId: '9001',
			payeeType: 'character',
			status: 'issued',
			payments: [],
		}
		billsStub.getBillIntegrationView.mockResolvedValueOnce(bill)
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.BILLS) return billsStub as any
			if (binding === env.ESI_TYPE_RESOLVER) return makeResolverStub() as any
			if (binding === env.EVE_CHARACTER_DATA) return makeCharacterDataStub() as any
			if (binding === env.EVE_CORPORATION_DATA) return makeCorporationDataStub() as any
			if (binding === env.GROUPS) return makeGroupsStub() as any
			throw new Error('Unexpected durable object binding in test')
		})

		const response = await app.request('/api/bills/my-bills/bill-1', {}, env)
		expect(response.status).toBe(200)
	})

	it('resolves historical user payment actors and labels system payments safely', async () => {
		const actorUserId = '123e4567-e89b-12d3-a456-426614174000'
		const app = createApp(makeUser({ id: 'issuer-1', is_admin: false }))
		const bill = {
			id: 'bill-1',
			issuerId: 'issuer-1',
			payerId: '7001',
			payerType: 'character',
			payeeId: '9001',
			payeeType: 'character',
			status: 'paid',
			payments: [
				{ paidById: actorUserId, paidByType: 'character' },
				{ paidById: 'system', paidByType: 'character' },
			],
		}
		billsStub.getBillIntegrationView.mockResolvedValueOnce(bill)
		const db = makeDbStub()
		createDbMock.mockReturnValue(db as any)
		db.query.users.findMany.mockResolvedValueOnce([{ id: actorUserId, mainCharacterId: '7002' }])
		resolverStub.resolveIds.mockResolvedValueOnce({
			'7001': 'Payer Character',
			'7002': 'Actor Character',
			'9001': 'Payee Character',
		})

		const response = await app.request('/api/bills/my-bills/bill-1', {}, env)

		expect(response.status).toBe(200)
		const body = (await response.json()) as { payments?: Array<{ paidByName?: string }> }
		expect(body.payments?.map((payment) => payment.paidByName)).toEqual([
			'Actor Character',
			'System',
		])
		expect(resolverStub.resolveIds).not.toHaveBeenCalledWith(
			expect.arrayContaining([actorUserId, 'system'])
		)
	})

	it('denies non-owner non-party bill detail with 403', async () => {
		const app = createApp(makeUser({ id: 'user-1', is_admin: false }))
		const bill = {
			id: 'bill-1',
			issuerId: 'someone-else',
			payerId: '9999',
			payerType: 'character',
			payeeId: '8888',
			payeeType: 'character',
			status: 'issued',
			payments: [],
		}
		billsStub.getBillIntegrationView.mockResolvedValueOnce(bill)
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.BILLS) return billsStub as any
			if (binding === env.ESI_TYPE_RESOLVER) return makeResolverStub() as any
			if (binding === env.EVE_CHARACTER_DATA) return makeCharacterDataStub() as any
			if (binding === env.EVE_CORPORATION_DATA) return makeCorporationDataStub() as any
			if (binding === env.GROUPS) return makeGroupsStub() as any
			throw new Error('Unexpected durable object binding in test')
		})

		const response = await app.request('/api/bills/my-bills/bill-1', {}, env)
		expect(response.status).toBe(403)
		expect(await response.json()).toEqual({ error: 'Forbidden' })
	})

	it('allows non-admin payer access when bill payerId matches user character id', async () => {
		const app = createApp(makeUser({ id: 'user-1', is_admin: false }))
		const bill = {
			id: 'bill-1',
			issuerId: 'issuer-2',
			payerId: '7001',
			payerType: 'character',
			payeeId: '416584095',
			payeeType: 'corporation',
			status: 'issued',
			payments: [],
			externalMetadata: { groupId: 'group-1' },
			groupBillId: 'group-bill-1',
		}
		billsStub.getBillIntegrationView.mockResolvedValueOnce(bill)

		const response = await app.request('/api/bills/my-bills/bill-1', {}, env)
		expect(response.status).toBe(200)
	})

	it('keeps draft hidden for non-admin non-issuer even if party-linked', async () => {
		const app = createApp(makeUser({ id: 'user-1', is_admin: false }))
		const bill = {
			id: 'bill-1',
			issuerId: 'issuer-2',
			payerId: '7001',
			payerType: 'character',
			payeeId: '9001',
			payeeType: 'character',
			status: 'draft',
			payments: [],
		}
		billsStub.getBillIntegrationView.mockResolvedValueOnce(bill)
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.BILLS) return billsStub as any
			if (binding === env.ESI_TYPE_RESOLVER) return makeResolverStub() as any
			if (binding === env.EVE_CHARACTER_DATA) return makeCharacterDataStub() as any
			if (binding === env.EVE_CORPORATION_DATA) return makeCorporationDataStub() as any
			if (binding === env.GROUPS) return makeGroupsStub() as any
			throw new Error('Unexpected durable object binding in test')
		})

		const response = await app.request('/api/bills/my-bills/bill-1', {}, env)
		expect(response.status).toBe(404)
		expect(await response.json()).toEqual({ error: 'Bill not found' })
	})

	it('returns 403 for site-admin when bill is outside my-bills scope', async () => {
		const app = createApp(makeUser({ is_admin: true, roles: [] }))
		const bill = {
			id: 'bill-1',
			issuerId: 'issuer-2',
			payerId: '9999',
			payerType: 'character',
			payeeId: '8888',
			payeeType: 'character',
			status: 'draft',
			payments: [],
		}
		billsStub.getBillIntegrationView.mockResolvedValueOnce(bill)
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.BILLS) return billsStub as any
			if (binding === env.ESI_TYPE_RESOLVER) return makeResolverStub() as any
			if (binding === env.EVE_CHARACTER_DATA) return makeCharacterDataStub() as any
			if (binding === env.EVE_CORPORATION_DATA) return makeCorporationDataStub() as any
			if (binding === env.GROUPS) return makeGroupsStub() as any
			throw new Error('Unexpected durable object binding in test')
		})

		const response = await app.request('/api/bills/my-bills/bill-1', {}, env)
		expect(response.status).toBe(403)
		expect(await response.json()).toEqual({ error: 'Forbidden' })
		expect(billsStub.getBillIntegrationView).toHaveBeenCalledWith('bill-1')
		expect(billsStub.getBill).not.toHaveBeenCalled()
	})
})
