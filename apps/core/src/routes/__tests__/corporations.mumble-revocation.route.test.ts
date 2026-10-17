import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import { triggerMumbleRefreshWorkflow } from '../../lib/workflow-triggers'
import corporationsRoutes from '../corporations'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
	withRpcResult: async <T, R>(rpcCall: Promise<T>, consume: (result: T) => R | Promise<R>) =>
		consume(await rpcCall),
}))

vi.mock('../../lib/workflow-triggers', () => ({
	triggerMumbleRefreshWorkflow: vi.fn(),
}))

vi.mock('../../lib/billing-scope-cache', () => ({
	clearUserBillScopeCache: vi.fn(),
}))

vi.mock('../../middleware/session', () => ({
	requireAuth: () => async (_c: unknown, next: () => Promise<void>) => next(),
	requireAdmin: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))

describe('corporation member flag Mumble reconciliation', () => {
	beforeEach(() => vi.clearAllMocks())

	it('queues Mumble access reconciliation only after disabling the member flag', async () => {
		let updated = false
		const db = {
			query: {
				managedCorporations: {
					findFirst: vi.fn().mockResolvedValue({
						corporationId: 'corp-1',
						isMemberCorporation: true,
					}),
				},
			},
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([{ userId: 'user-1' }]),
				})),
			})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => {
							updated = true
							return [{ corporationId: 'corp-1', isMemberCorporation: false }]
						}),
					})),
				})),
			})),
		}
		const env = { GROUPS: {}, CORE: {}, BILLING_SCOPE_CACHE: {} } as any
		const groupsStub = { listCorporationPermissions: vi.fn().mockResolvedValue([]) }
		const coreStub = {
			addPendingDiscordRefreshes: vi.fn().mockResolvedValue({
				added: 1,
				skipped: 0,
				pendingCount: 1,
			}),
		}
		vi.mocked(getStub).mockImplementation((binding: unknown) => {
			if (binding === env.GROUPS) return groupsStub as any
			if (binding === env.CORE) return coreStub as any
			throw new Error('unexpected stub binding')
		})
		vi.mocked(triggerMumbleRefreshWorkflow).mockImplementation(async () => {
			expect(updated).toBe(true)
			return { status: 'triggered', triggered: true, workflowInstanceId: 'wf-1' }
		})

		const app = new Hono<any>()
		app.use('*', async (c, next) => {
			c.set('user', { id: 'admin-1', is_admin: true })
			c.set('db', db)
			await next()
		})
		app.route('/api/corporations', corporationsRoutes)

		const response = await app.request(
			'/api/corporations/corp-1',
			{
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ isMemberCorporation: false }),
			},
			env
		)

		expect(response.status).toBe(200)
		expect(triggerMumbleRefreshWorkflow).toHaveBeenCalledWith({
			env,
			userIds: ['user-1'],
			source: 'corp-member-flag-disabled',
			forceAccessReconciliation: true,
		})
	})

	it('queues Mumble access reconciliation after removing a member corporation', async () => {
		let deleted = false
		const db = {
			query: {
				managedCorporations: {
					findFirst: vi.fn().mockResolvedValue({ isMemberCorporation: true }),
				},
			},
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([{ userId: 'user-1' }]),
				})),
			})),
			delete: vi.fn(() => ({
				where: vi.fn(async () => {
					deleted = true
				}),
			})),
		}
		const env = {} as any
		vi.mocked(triggerMumbleRefreshWorkflow).mockImplementation(async () => {
			expect(deleted).toBe(true)
			return { status: 'triggered', triggered: true, workflowInstanceId: 'wf-2' }
		})
		const app = new Hono<any>()
		app.use('*', async (c, next) => {
			c.set('user', { id: 'admin-1', is_admin: true })
			c.set('db', db)
			await next()
		})
		app.route('/api/corporations', corporationsRoutes)

		const response = await app.request('/api/corporations/corp-1', { method: 'DELETE' }, env)

		expect(response.status).toBe(200)
		expect(triggerMumbleRefreshWorkflow).toHaveBeenCalledWith({
			env,
			userIds: ['user-1'],
			source: 'member-corporation-removed',
			forceAccessReconciliation: true,
		})
	})

	it('can retry Mumble revocation after a failed queue and an already persisted false flag', async () => {
		let isMemberCorporation = true
		const db = {
			query: {
				managedCorporations: {
					findFirst: vi.fn(async () => ({ corporationId: 'corp-1', isMemberCorporation })),
				},
			},
			select: vi.fn(() => ({
				from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ userId: 'user-1' }]) })),
			})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => {
							isMemberCorporation = false
							return [{ corporationId: 'corp-1', isMemberCorporation }]
						}),
					})),
				})),
			})),
		}
		const env = { GROUPS: {}, CORE: {}, BILLING_SCOPE_CACHE: {} } as any
		vi.mocked(getStub).mockImplementation((binding: unknown) => {
			if (binding === env.GROUPS) return { listCorporationPermissions: async () => [] } as any
			if (binding === env.CORE) {
				return {
					addPendingDiscordRefreshes: async () => ({ added: 1, skipped: 0, pendingCount: 1 }),
				} as any
			}
			throw new Error('unexpected stub binding')
		})
		vi.mocked(triggerMumbleRefreshWorkflow)
			.mockResolvedValueOnce({ status: 'failed', triggered: false, error: 'queue unavailable' })
			.mockResolvedValueOnce({ status: 'triggered', triggered: true, workflowInstanceId: 'wf-2' })

		const app = new Hono<any>()
		app.use('*', async (c, next) => {
			c.set('user', { id: 'admin-1', is_admin: true })
			c.set('db', db)
			await next()
		})
		app.route('/api/corporations', corporationsRoutes)
		const request = () =>
			app.request(
				'/api/corporations/corp-1',
				{
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ isMemberCorporation: false }),
				},
				env
			)

		expect((await request()).status).toBe(500)
		expect(isMemberCorporation).toBe(false)
		expect((await request()).status).toBe(200)
		expect(triggerMumbleRefreshWorkflow).toHaveBeenCalledTimes(2)
	})

	it('can retry Mumble revocation after a failed queue and a deleted corporation row', async () => {
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ userId: 'user-1' }]) })),
			})),
			delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
		}
		const env = {} as any
		vi.mocked(triggerMumbleRefreshWorkflow)
			.mockResolvedValueOnce({ status: 'failed', triggered: false, error: 'queue unavailable' })
			.mockResolvedValueOnce({ status: 'triggered', triggered: true, workflowInstanceId: 'wf-2' })
		const app = new Hono<any>()
		app.use('*', async (c, next) => {
			c.set('user', { id: 'admin-1', is_admin: true })
			c.set('db', db)
			await next()
		})
		app.route('/api/corporations', corporationsRoutes)

		expect((await app.request('/api/corporations/corp-1', { method: 'DELETE' }, env)).status).toBe(
			500
		)
		expect((await app.request('/api/corporations/corp-1', { method: 'DELETE' }, env)).status).toBe(
			200
		)
		expect(triggerMumbleRefreshWorkflow).toHaveBeenCalledTimes(2)
	})
})
