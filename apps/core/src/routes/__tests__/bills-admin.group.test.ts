import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import { createDb } from '../../db'
import billsAdminRoutes from '../bills-admin'

import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../db', () => ({
	createDb: vi.fn(),
}))

const getStubMock = vi.mocked(getStub)
const createDbMock = vi.mocked(createDb)

const env = {
	BILLS: { name: 'BILLS' },
	GROUPS: { name: 'GROUPS' },
	ESI_TYPE_RESOLVER: { name: 'ESI_TYPE_RESOLVER' },
	DATABASE_URL: 'postgres://example',
} as any

function makeAdmin(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'admin-1',
		mainCharacterId: '7001',
		sessionId: 'session-1',
		characters: [],
		is_admin: true,
		roles: [],
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
	app.route('/api/admin/bills', billsAdminRoutes)
	return app
}

function makeBillsStub() {
	return {
		createBill: vi.fn().mockResolvedValue({ id: 'bill-1' }),
		listBillsPage: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
		getGroupBillAggregate: vi.fn().mockResolvedValue(null),
		issueGroupBill: vi.fn().mockResolvedValue({ issued: 1 }),
		cancelGroupBill: vi.fn().mockResolvedValue({ cancelled: 1 }),
		revertGroupBillToDraft: vi.fn().mockResolvedValue({ reverted: 1 }),
		deleteGroupBill: vi.fn().mockResolvedValue({ deleted: 1 }),
	}
}

function makeGroupsStub() {
	return {
		getGroup: vi.fn().mockResolvedValue(null),
		getGroupMembers: vi.fn().mockResolvedValue([]),
		getGroupMetadataByIds: vi.fn().mockResolvedValue([]),
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
			users: {
				findMany: vi.fn().mockResolvedValue([]),
				findFirst: vi.fn().mockResolvedValue(null),
			},
		},
	}
}

describe('group bill creation (POST /)', () => {
	let billsStub: ReturnType<typeof makeBillsStub>
	let groupsStub: ReturnType<typeof makeGroupsStub>

	beforeEach(() => {
		vi.clearAllMocks()
		billsStub = makeBillsStub()
		groupsStub = makeGroupsStub()
		createDbMock.mockReturnValue(makeDbStub() as any)
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.BILLS) return billsStub as any
			if (binding === env.GROUPS) return groupsStub as any
			throw new Error(`Unexpected binding: ${binding?.name}`)
		})
	})

	it('fans out to individual character bills with externalMetadata.groupId set', async () => {
		const group = { id: 'group-1', ownerId: 'owner-user', adminUserIds: [] }
		const members = [
			{ userId: 'member-user-1', mainCharacterId: 'char-101' },
			{ userId: 'member-user-2', mainCharacterId: 'char-102' },
		]
		groupsStub.getGroup.mockResolvedValueOnce(group)
		groupsStub.getGroupMembers.mockResolvedValueOnce(members)
		billsStub.createBill
			.mockResolvedValueOnce({ id: 'bill-101' })
			.mockResolvedValueOnce({ id: 'bill-102' })

		const app = createApp(makeAdmin())
		const response = await app.request(
			'/api/admin/bills',
			{
				method: 'POST',
				body: JSON.stringify({
					payerId: 'group-1',
					payerType: 'group',
					payeeId: 'corp-1',
					payeeType: 'corporation',
					title: 'Monthly Dues',
					amount: '1000000',
					dueDate: new Date('2026-04-01').toISOString(),
					groupBillOptions: { includeOwner: false, includeAdmins: false, includeMembers: true },
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(response.status).toBe(201)
		const body = await response.json() as any
		expect(body.bills).toHaveLength(2)
		expect(body.billCount).toBe(2)
		expect(typeof body.groupBillId).toBe('string')

		// Each sub-bill must have externalMetadata.groupId pointing to the original group
		expect(billsStub.createBill).toHaveBeenCalledTimes(2)
		for (const call of billsStub.createBill.mock.calls) {
			const data = call[1] as any
			expect(data.payerType).toBe('character')
			expect(data.externalMetadata).toEqual({ groupId: 'group-1' })
			expect(data.groupBillId).toBe(body.groupBillId)
		}
	})

	it('respects groupBillOptions to include only selected member roles', async () => {
		const group = { id: 'group-1', ownerId: 'owner-user', adminUserIds: ['admin-user'] }
		const members = [
			{ userId: 'owner-user', mainCharacterId: 'char-owner' },
			{ userId: 'admin-user', mainCharacterId: 'char-admin' },
			{ userId: 'member-user', mainCharacterId: 'char-member' },
		]
		groupsStub.getGroup.mockResolvedValueOnce(group)
		groupsStub.getGroupMembers.mockResolvedValueOnce(members)
		billsStub.createBill.mockResolvedValueOnce({ id: 'bill-owner' })

		const app = createApp(makeAdmin())
		const response = await app.request(
			'/api/admin/bills',
			{
				method: 'POST',
				body: JSON.stringify({
					payerId: 'group-1',
					payerType: 'group',
					payeeId: 'corp-1',
					payeeType: 'corporation',
					title: 'Dues',
					amount: '500000',
					dueDate: new Date('2026-04-01').toISOString(),
					// Only include owner
					groupBillOptions: { includeOwner: true, includeAdmins: false, includeMembers: false },
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(response.status).toBe(201)
		expect(billsStub.createBill).toHaveBeenCalledTimes(1)
		const billData = billsStub.createBill.mock.calls[0]?.[1] as any
		expect(billData.payerId).toBe('char-owner')
	})

	it('returns 404 when the group is not found', async () => {
		groupsStub.getGroup.mockResolvedValueOnce(null)
		groupsStub.getGroupMembers.mockResolvedValueOnce([])

		const app = createApp(makeAdmin())
		const response = await app.request(
			'/api/admin/bills',
			{
				method: 'POST',
				body: JSON.stringify({
					payerId: 'nonexistent-group',
					payerType: 'group',
					payeeId: 'corp-1',
					payeeType: 'corporation',
					title: 'Dues',
					amount: '1000000',
					dueDate: new Date('2026-04-01').toISOString(),
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(response.status).toBe(404)
		expect(await response.json()).toEqual({ error: 'Group not found' })
		expect(billsStub.createBill).not.toHaveBeenCalled()
	})

	it('returns 400 when no qualifying members have a main character', async () => {
		const group = { id: 'group-1', ownerId: 'owner-user', adminUserIds: [] }
		const members = [
			{ userId: 'member-user', mainCharacterId: null }, // no main character
		]
		groupsStub.getGroup.mockResolvedValueOnce(group)
		groupsStub.getGroupMembers.mockResolvedValueOnce(members)

		const app = createApp(makeAdmin())
		const response = await app.request(
			'/api/admin/bills',
			{
				method: 'POST',
				body: JSON.stringify({
					payerId: 'group-1',
					payerType: 'group',
					payeeId: 'corp-1',
					payeeType: 'corporation',
					title: 'Dues',
					amount: '1000000',
					dueDate: new Date('2026-04-01').toISOString(),
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(response.status).toBe(400)
		expect(billsStub.createBill).not.toHaveBeenCalled()
	})

	it('returns 403 for non-admin users', async () => {
		const app = createApp(makeAdmin({ is_admin: false }))
		const response = await app.request(
			'/api/admin/bills',
			{
				method: 'POST',
				body: JSON.stringify({
					payerId: 'group-1',
					payerType: 'group',
					payeeId: 'corp-1',
					payeeType: 'corporation',
					title: 'Dues',
					amount: '1000000',
					dueDate: new Date('2026-04-01').toISOString(),
				}),
				headers: { 'content-type': 'application/json' },
			},
			env
		)

		expect(response.status).toBe(403)
		expect(billsStub.createBill).not.toHaveBeenCalled()
	})
})

describe('coalesced bill list (GET / with coalesced=true)', () => {
	let billsStub: ReturnType<typeof makeBillsStub>
	let groupsStub: ReturnType<typeof makeGroupsStub>
	let resolverStub: ReturnType<typeof makeResolverStub>

	beforeEach(() => {
		vi.clearAllMocks()
		billsStub = makeBillsStub()
		groupsStub = makeGroupsStub()
		resolverStub = makeResolverStub()
		createDbMock.mockReturnValue(makeDbStub() as any)
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.BILLS) return billsStub as any
			if (binding === env.GROUPS) return groupsStub as any
			if (binding === env.ESI_TYPE_RESOLVER) return resolverStub as any
			throw new Error(`Unexpected binding: ${binding?.name}`)
		})
	})

	function makeSubBill(overrides: Record<string, unknown> = {}) {
		return {
			id: 'bill-1',
			issuerId: 'admin-1',
			payerId: 'char-101',
			payerType: 'character',
			payeeId: 'corp-1',
			payeeType: 'corporation',
			title: 'Dues',
			amount: '1000000',
			lateFee: '0',
			lateFeeType: 'none',
			lateFeeAmount: '0',
			lateFeeCompounding: 'none',
			dueDate: new Date('2026-04-01'),
			status: 'issued',
			paidAt: null,
			paymentToken: 'token-1',
			externalSourceType: null,
			externalSourceId: null,
			externalMetadata: { groupId: 'group-1' },
			groupBillId: 'gbill-1',
			createdAt: new Date(),
			updatedAt: new Date(),
			template: null,
			schedule: null,
			payments: [],
			...overrides,
		}
	}

	it('coalesces sub-bills by groupBillId and resolves group payer name', async () => {
		const rows = [
			makeSubBill({ id: 'bill-1', payerId: 'char-101' }),
			makeSubBill({ id: 'bill-2', payerId: 'char-102' }),
		]
		billsStub.listBillsPage.mockResolvedValueOnce({ rows, rowCount: 2 })
		groupsStub.getGroupMetadataByIds.mockResolvedValueOnce([
			{ id: 'group-1', name: 'Alpha Squadron' },
		])

		const app = createApp(makeAdmin())
		const response = await app.request(
			'/api/admin/bills?limit=25&offset=0&coalesced=true',
			{},
			env
		)

		expect(response.status).toBe(200)
		const body = await response.json() as any
		// Two sub-bills → coalesced into one representative row
		expect(body.rows).toHaveLength(1)
		const rep = body.rows[0]
		expect(rep.groupBillId).toBe('gbill-1')
		expect(rep.groupBillTotalCount).toBe(2)
		expect(rep.payerType).toBe('group')
		expect(rep.payerId).toBe('group-1')
		expect(rep.payerName).toBe('Alpha Squadron')
	})

	it('sets groupBillMixed=true when sub-bills have different statuses', async () => {
		const rows = [
			makeSubBill({ id: 'bill-1', payerId: 'char-101', status: 'issued' }),
			makeSubBill({ id: 'bill-2', payerId: 'char-102', status: 'paid' }),
		]
		billsStub.listBillsPage.mockResolvedValueOnce({ rows, rowCount: 2 })
		groupsStub.getGroupMetadataByIds.mockResolvedValueOnce([
			{ id: 'group-1', name: 'Alpha Squadron' },
		])

		const app = createApp(makeAdmin())
		const response = await app.request(
			'/api/admin/bills?limit=25&offset=0&coalesced=true',
			{},
			env
		)

		expect(response.status).toBe(200)
		const body = await response.json() as any
		expect(body.rows[0].groupBillMixed).toBe(true)
	})

	it('does not set groupBillMixed when all sub-bills share the same status', async () => {
		const rows = [
			makeSubBill({ id: 'bill-1', payerId: 'char-101', status: 'issued' }),
			makeSubBill({ id: 'bill-2', payerId: 'char-102', status: 'issued' }),
		]
		billsStub.listBillsPage.mockResolvedValueOnce({ rows, rowCount: 2 })
		groupsStub.getGroupMetadataByIds.mockResolvedValueOnce([
			{ id: 'group-1', name: 'Alpha Squadron' },
		])

		const app = createApp(makeAdmin())
		const response = await app.request(
			'/api/admin/bills?limit=25&offset=0&coalesced=true',
			{},
			env
		)

		expect(response.status).toBe(200)
		const body = await response.json() as any
		expect(body.rows[0].groupBillMixed).toBeFalsy()
	})

	it('tracks groupBillPaidCount correctly', async () => {
		const rows = [
			makeSubBill({ id: 'bill-1', payerId: 'char-101', status: 'paid' }),
			makeSubBill({ id: 'bill-2', payerId: 'char-102', status: 'issued' }),
			makeSubBill({ id: 'bill-3', payerId: 'char-103', status: 'paid' }),
		]
		billsStub.listBillsPage.mockResolvedValueOnce({ rows, rowCount: 3 })
		groupsStub.getGroupMetadataByIds.mockResolvedValueOnce([
			{ id: 'group-1', name: 'Alpha Squadron' },
		])

		const app = createApp(makeAdmin())
		const response = await app.request(
			'/api/admin/bills?limit=25&offset=0&coalesced=true',
			{},
			env
		)

		expect(response.status).toBe(200)
		const body = await response.json() as any
		const rep = body.rows[0]
		expect(rep.groupBillTotalCount).toBe(3)
		expect(rep.groupBillPaidCount).toBe(2)
	})

	it('returns individual rows when coalesced=false', async () => {
		const rows = [
			makeSubBill({ id: 'bill-1', payerId: 'char-101', status: 'issued' }),
			makeSubBill({ id: 'bill-2', payerId: 'char-102', status: 'issued' }),
		]
		billsStub.listBillsPage.mockResolvedValueOnce({ rows, rowCount: 2 })
		groupsStub.getGroupMetadataByIds.mockResolvedValueOnce([])

		const app = createApp(makeAdmin())
		const response = await app.request(
			'/api/admin/bills?limit=25&offset=0&coalesced=false',
			{},
			env
		)

		expect(response.status).toBe(200)
		const body = await response.json() as any
		// No coalescing → both rows returned individually
		expect(body.rows).toHaveLength(2)
		expect(body.rows[0].groupBillTotalCount).toBeUndefined()
	})
})

describe('group bill bulk action endpoints', () => {
	let billsStub: ReturnType<typeof makeBillsStub>
	let groupsStub: ReturnType<typeof makeGroupsStub>
	let resolverStub: ReturnType<typeof makeResolverStub>

	beforeEach(() => {
		vi.clearAllMocks()
		billsStub = makeBillsStub()
		groupsStub = makeGroupsStub()
		resolverStub = makeResolverStub()
		createDbMock.mockReturnValue(makeDbStub() as any)
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.BILLS) return billsStub as any
			if (binding === env.GROUPS) return groupsStub as any
			if (binding === env.ESI_TYPE_RESOLVER) return resolverStub as any
			throw new Error(`Unexpected binding: ${binding?.name}`)
		})
	})

	const aggregate = {
		groupBillId: 'gbill-1',
		groupId: 'group-1',
		issuerId: 'admin-1',
		title: 'Dues',
		totalCount: 2,
		paidCount: 0,
		bills: [],
	}

	it('GET /group/:groupBillId returns 404 when aggregate not found', async () => {
		billsStub.getGroupBillAggregate.mockResolvedValueOnce(null)

		const app = createApp(makeAdmin())
		const response = await app.request('/api/admin/bills/group/gbill-missing', {}, env)
		expect(response.status).toBe(404)
		expect(await response.json()).toEqual({ error: 'Group bill not found' })
	})

	it('GET /group/:groupBillId returns aggregate with resolved group name', async () => {
		billsStub.getGroupBillAggregate.mockResolvedValueOnce(aggregate)
		groupsStub.getGroupMetadataByIds.mockResolvedValueOnce([
			{ id: 'group-1', name: 'Alpha Squadron' },
		])

		const app = createApp(makeAdmin())
		const response = await app.request('/api/admin/bills/group/gbill-1', {}, env)
		expect(response.status).toBe(200)
		const body = await response.json() as any
		expect(body.groupName).toBe('Alpha Squadron')
	})

	it('POST /group/:groupBillId/issue returns 404 when aggregate not found', async () => {
		billsStub.getGroupBillAggregate.mockResolvedValueOnce(null)

		const app = createApp(makeAdmin())
		const response = await app.request(
			'/api/admin/bills/group/gbill-missing/issue',
			{ method: 'POST' },
			env
		)
		expect(response.status).toBe(404)
		expect(billsStub.issueGroupBill).not.toHaveBeenCalled()
	})

	it('POST /group/:groupBillId/issue calls issueGroupBill and returns result', async () => {
		billsStub.getGroupBillAggregate.mockResolvedValueOnce(aggregate)

		const app = createApp(makeAdmin({ id: 'admin-1' }))
		const response = await app.request(
			'/api/admin/bills/group/gbill-1/issue',
			{ method: 'POST' },
			env
		)
		expect(response.status).toBe(200)
		expect(billsStub.issueGroupBill).toHaveBeenCalledWith('admin-1', 'gbill-1')
	})

	it('POST /group/:groupBillId/cancel calls cancelGroupBill and returns result', async () => {
		billsStub.getGroupBillAggregate.mockResolvedValueOnce(aggregate)

		const app = createApp(makeAdmin({ id: 'admin-1' }))
		const response = await app.request(
			'/api/admin/bills/group/gbill-1/cancel',
			{ method: 'POST' },
			env
		)
		expect(response.status).toBe(200)
		expect(billsStub.cancelGroupBill).toHaveBeenCalledWith('admin-1', 'gbill-1')
	})

	it('POST /group/:groupBillId/revert-to-draft calls revertGroupBillToDraft and returns result', async () => {
		billsStub.getGroupBillAggregate.mockResolvedValueOnce(aggregate)

		const app = createApp(makeAdmin({ id: 'admin-1' }))
		const response = await app.request(
			'/api/admin/bills/group/gbill-1/revert-to-draft',
			{ method: 'POST' },
			env
		)
		expect(response.status).toBe(200)
		expect(billsStub.revertGroupBillToDraft).toHaveBeenCalledWith('admin-1', 'gbill-1')
	})

	it('DELETE /group/:groupBillId calls deleteGroupBill and returns result', async () => {
		billsStub.getGroupBillAggregate.mockResolvedValueOnce(aggregate)

		const app = createApp(makeAdmin({ id: 'admin-1' }))
		const response = await app.request(
			'/api/admin/bills/group/gbill-1',
			{ method: 'DELETE' },
			env
		)
		expect(response.status).toBe(200)
		expect(billsStub.deleteGroupBill).toHaveBeenCalledWith('admin-1', 'gbill-1')
	})

	it.each([
		{ method: 'POST', path: '/api/admin/bills/group/gbill-1/issue' },
		{ method: 'POST', path: '/api/admin/bills/group/gbill-1/cancel' },
		{ method: 'POST', path: '/api/admin/bills/group/gbill-1/revert-to-draft' },
		{ method: 'DELETE', path: '/api/admin/bills/group/gbill-1' },
	] as const)('$method $path returns 403 for non-admin users', async ({ method, path }) => {
		const app = createApp(makeAdmin({ is_admin: false }))
		const response = await app.request(path, { method }, env)
		expect(response.status).toBe(403)
	})
})
