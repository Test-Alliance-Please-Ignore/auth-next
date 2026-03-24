import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { getStub } from '@repo/do-utils'

import { createDb } from '../../db'
import billsUserRoutes from '../bills-user'

import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
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
		listBillsPage: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
		searchBillParties: vi.fn().mockResolvedValue([]),
		getBill: vi.fn().mockResolvedValue(null),
		getBillIntegrationView: vi.fn().mockResolvedValue(null),
	}
}

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
		getUserMemberships: vi.fn().mockResolvedValue([]),
		getGroupMetadataByIds: vi.fn().mockResolvedValue([]),
	}
}

function makeDbStub() {
	return {
		query: {
			userCharacters: {
				findMany: vi.fn().mockResolvedValue([{ characterId: '7001', characterName: 'Pilot One' }]),
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

	it('uses all-scope for site-admin on list and parties search routes', async () => {
		const app = createApp(makeUser({ is_admin: true, roles: [] }))
		const listResponse = await app.request('/api/bills/my-bills?limit=25&offset=0', {}, env)
		expect(listResponse.status).toBe(200)
		const partiesResponse = await app.request('/api/bills/my-bills/parties/search?q=7001', {}, env)
		expect(partiesResponse.status).toBe(200)

		expect(billsStub.listBillsPage.mock.calls[0]?.[0]?.scope?.mode).toBe('all')
		expect(billsStub.searchBillParties.mock.calls[0]?.[0]?.scope?.mode).toBe('all')
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
		billsStub.getBill.mockResolvedValueOnce(bill)
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

	it('denies non-owner non-party bill detail with 404', async () => {
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
		billsStub.getBill.mockResolvedValueOnce(bill)
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
		billsStub.getBill.mockResolvedValueOnce(bill)
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

	it('allows site-admin to view bill detail via integration view override', async () => {
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
		expect(response.status).toBe(200)
		expect(billsStub.getBillIntegrationView).toHaveBeenCalledWith('bill-1')
		expect(billsStub.getBill).not.toHaveBeenCalled()
	})
})
