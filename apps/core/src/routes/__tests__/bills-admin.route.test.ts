import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import billsAdminRoutes from '../bills-admin'

import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

const getStubMock = vi.mocked(getStub)

const env = {
	BILLS: { name: 'BILLS' },
} as any

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: '7001',
		sessionId: 'session-1',
		characters: [],
		is_admin: false,
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
		getBillIntegrationView: vi.fn().mockResolvedValue({ id: 'bill-1' }),
		updateBill: vi.fn().mockResolvedValue({ id: 'bill-1' }),
		deleteBill: vi.fn().mockResolvedValue(undefined),
		issueBill: vi.fn().mockResolvedValue({ id: 'bill-1', status: 'issued' }),
		cancelBill: vi.fn().mockResolvedValue({ id: 'bill-1', status: 'cancelled' }),
		revertBillToDraft: vi.fn().mockResolvedValue({ id: 'bill-1', status: 'draft' }),
		regeneratePaymentToken: vi.fn().mockResolvedValue({ token: 'abc123', billId: 'bill-1' }),
		createTemplate: vi.fn().mockResolvedValue({ id: 'template-1' }),
		updateTemplate: vi.fn().mockResolvedValue({ id: 'template-1' }),
		deleteTemplate: vi.fn().mockResolvedValue(undefined),
		createSchedule: vi.fn().mockResolvedValue({ id: 'schedule-1' }),
		updateSchedule: vi.fn().mockResolvedValue({ id: 'schedule-1' }),
		deleteSchedule: vi.fn().mockResolvedValue(undefined),
		pauseSchedule: vi.fn().mockResolvedValue({ id: 'schedule-1', isActive: false }),
		resumeSchedule: vi.fn().mockResolvedValue({ id: 'schedule-1', isActive: true }),
	}
}

describe('bills-admin routes action access matrix', () => {
	let billsStub: ReturnType<typeof makeBillsStub>

	beforeEach(() => {
		vi.clearAllMocks()
		billsStub = makeBillsStub()
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.BILLS) return billsStub as any
			throw new Error('Unexpected binding')
		})
	})

	it('returns 401 for unauthenticated admin-bills action request', async () => {
		const app = createApp()
		const response = await app.request('/api/admin/bills', {
			method: 'POST',
			body: JSON.stringify({}),
			headers: { 'content-type': 'application/json' },
		}, env)
		expect(response.status).toBe(401)
		expect(await response.json()).toEqual({ error: 'Unauthorized' })
	})

	it.each([
		{ method: 'POST', path: '/api/admin/bills', body: { title: 'x' } },
		{ method: 'PUT', path: '/api/admin/bills/bill-1', body: { title: 'x' } },
		{ method: 'DELETE', path: '/api/admin/bills/bill-1' },
		{ method: 'POST', path: '/api/admin/bills/bill-1/issue' },
		{ method: 'POST', path: '/api/admin/bills/bill-1/cancel' },
		{ method: 'POST', path: '/api/admin/bills/bill-1/revert-to-draft' },
		{ method: 'POST', path: '/api/admin/bills/bill-1/regenerate-token' },
		{ method: 'POST', path: '/api/admin/bills/templates', body: { name: 'x' } },
		{ method: 'PUT', path: '/api/admin/bills/templates/template-1', body: { name: 'x' } },
		{ method: 'DELETE', path: '/api/admin/bills/templates/template-1' },
		{ method: 'POST', path: '/api/admin/bills/schedules', body: { templateId: 'template-1' } },
		{
			method: 'PUT',
			path: '/api/admin/bills/schedules/schedule-1',
			body: { frequency: 'daily' },
		},
		{ method: 'DELETE', path: '/api/admin/bills/schedules/schedule-1' },
		{ method: 'POST', path: '/api/admin/bills/schedules/schedule-1/pause' },
		{ method: 'POST', path: '/api/admin/bills/schedules/schedule-1/resume' },
	] as const)(
		'denies non-admin users on $method $path (including entity owners)',
		async ({ method, path, body }) => {
			const app = createApp(makeUser({ is_admin: false }))
			const response = await app.request(
				path,
				{
					method,
					body: body ? JSON.stringify(body) : undefined,
					headers: body ? { 'content-type': 'application/json' } : undefined,
				},
				env
			)
			expect(response.status).toBe(403)
			expect(await response.json()).toEqual({ error: 'Forbidden' })
		}
	)

	it('allows site-admin bill action endpoints and forwards actor id', async () => {
		const app = createApp(makeUser({ id: 'admin-1', is_admin: true }))

		const updateResponse = await app.request(
			'/api/admin/bills/bill-1',
			{
				method: 'PUT',
				body: JSON.stringify({ title: 'updated' }),
				headers: { 'content-type': 'application/json' },
			},
			env
		)
		expect(updateResponse.status).toBe(200)
		expect(billsStub.getBillIntegrationView).toHaveBeenCalledWith('bill-1')
		expect(billsStub.updateBill).toHaveBeenCalledWith('admin-1', 'bill-1', { title: 'updated' })

		const issueResponse = await app.request('/api/admin/bills/bill-1/issue', { method: 'POST' }, env)
		expect(issueResponse.status).toBe(200)
		expect(billsStub.issueBill).toHaveBeenCalledWith('admin-1', 'bill-1')

		const cancelResponse = await app.request('/api/admin/bills/bill-1/cancel', { method: 'POST' }, env)
		expect(cancelResponse.status).toBe(200)
		expect(billsStub.cancelBill).toHaveBeenCalledWith('admin-1', 'bill-1')

		const revertResponse = await app.request(
			'/api/admin/bills/bill-1/revert-to-draft',
			{ method: 'POST' },
			env
		)
		expect(revertResponse.status).toBe(200)
		expect(billsStub.revertBillToDraft).toHaveBeenCalledWith('admin-1', 'bill-1')

		const tokenResponse = await app.request(
			'/api/admin/bills/bill-1/regenerate-token',
			{ method: 'POST' },
			env
		)
		expect(tokenResponse.status).toBe(200)
		expect(billsStub.regeneratePaymentToken).toHaveBeenCalledWith('admin-1', 'bill-1')
	})

	it('allows site-admin template and schedule action endpoints and forwards actor id', async () => {
		const app = createApp(makeUser({ id: 'admin-1', is_admin: true }))

		const createTemplateResponse = await app.request(
			'/api/admin/bills/templates',
			{
				method: 'POST',
				body: JSON.stringify({ name: 'template' }),
				headers: { 'content-type': 'application/json' },
			},
			env
		)
		expect(createTemplateResponse.status).toBe(201)
		expect(billsStub.createTemplate).toHaveBeenCalledWith('admin-1', { name: 'template' })

		const updateTemplateResponse = await app.request(
			'/api/admin/bills/templates/template-1',
			{
				method: 'PUT',
				body: JSON.stringify({ name: 'template-2' }),
				headers: { 'content-type': 'application/json' },
			},
			env
		)
		expect(updateTemplateResponse.status).toBe(200)
		expect(billsStub.updateTemplate).toHaveBeenCalledWith('admin-1', 'template-1', {
			name: 'template-2',
		})

		const deleteTemplateResponse = await app.request(
			'/api/admin/bills/templates/template-1',
			{ method: 'DELETE' },
			env
		)
		expect(deleteTemplateResponse.status).toBe(200)
		expect(billsStub.deleteTemplate).toHaveBeenCalledWith('admin-1', 'template-1')

		const createScheduleResponse = await app.request(
			'/api/admin/bills/schedules',
			{
				method: 'POST',
				body: JSON.stringify({ templateId: 'template-1' }),
				headers: { 'content-type': 'application/json' },
			},
			env
		)
		expect(createScheduleResponse.status).toBe(201)
		expect(billsStub.createSchedule).toHaveBeenCalledWith('admin-1', { templateId: 'template-1' })

		const updateScheduleResponse = await app.request(
			'/api/admin/bills/schedules/schedule-1',
			{
				method: 'PUT',
				body: JSON.stringify({ frequency: 'weekly' }),
				headers: { 'content-type': 'application/json' },
			},
			env
		)
		expect(updateScheduleResponse.status).toBe(200)
		expect(billsStub.updateSchedule).toHaveBeenCalledWith('admin-1', 'schedule-1', {
			frequency: 'weekly',
		})

		const deleteScheduleResponse = await app.request(
			'/api/admin/bills/schedules/schedule-1',
			{ method: 'DELETE' },
			env
		)
		expect(deleteScheduleResponse.status).toBe(200)
		expect(billsStub.deleteSchedule).toHaveBeenCalledWith('admin-1', 'schedule-1')

		const pauseScheduleResponse = await app.request(
			'/api/admin/bills/schedules/schedule-1/pause',
			{ method: 'POST' },
			env
		)
		expect(pauseScheduleResponse.status).toBe(200)
		expect(billsStub.pauseSchedule).toHaveBeenCalledWith('admin-1', 'schedule-1')

		const resumeScheduleResponse = await app.request(
			'/api/admin/bills/schedules/schedule-1/resume',
			{ method: 'POST' },
			env
		)
		expect(resumeScheduleResponse.status).toBe(200)
		expect(billsStub.resumeSchedule).toHaveBeenCalledWith('admin-1', 'schedule-1')
	})

	it('returns 404 on bill actions when bill cannot be loaded', async () => {
		billsStub.getBillIntegrationView.mockResolvedValueOnce(null)
		const app = createApp(makeUser({ id: 'admin-1', is_admin: true }))
		const response = await app.request('/api/admin/bills/missing/issue', { method: 'POST' }, env)
		expect(response.status).toBe(404)
		expect(await response.json()).toEqual({ error: 'Bill not found' })
		expect(billsStub.issueBill).not.toHaveBeenCalled()
	})
})
