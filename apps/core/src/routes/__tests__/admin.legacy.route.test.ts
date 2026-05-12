import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { getStub } from '@repo/do-utils'

import adminRoutes from '../admin'

import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: '00000000-0000-0000-0000-000000000001',
		mainCharacterId: '7001',
		sessionId: 'session-1',
		characters: [],
		is_admin: true,
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

	app.route('/api/admin', adminRoutes)
	return app
}

describe('admin legacy rpc routes', () => {
	const legacyStub = {
		listMigrations: vi.fn(),
		getMigration: vi.fn(),
		recheckUser: vi.fn(),
		resolveMigration: vi.fn(),
	}

	const env = {
		LEGACY: { name: 'LEGACY' },
	} as any

	beforeEach(() => {
		vi.clearAllMocks()
		legacyStub.listMigrations.mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } })
		legacyStub.getMigration.mockResolvedValue({ item: { id: 'q1' }, actions: [] })
		legacyStub.recheckUser.mockResolvedValue({ ok: true, modernUserId: 'u1', created: 0, updated: 0, dismissed: 0 })
		legacyStub.resolveMigration.mockResolvedValue({ item: { id: 'q1', status: 'pending' } })
		vi.mocked(getStub).mockReturnValue(legacyStub as any)
	})

	it('calls legacy list via rpc', async () => {
		const app = createApp(makeUser())
		const response = await app.request('/api/admin/legacy/migrations?page=2&pageSize=10&status=pending', {}, env)
		expect(response.status).toBe(200)
		expect(legacyStub.listMigrations).toHaveBeenCalledWith(
			expect.objectContaining({ page: 2, pageSize: 10, status: 'pending' })
		)
	})

	it('calls legacy recheck via rpc', async () => {
		const app = createApp(makeUser())
		const response = await app.request('/api/admin/legacy/migrations/recheck/11111111-1111-4111-8111-111111111111', { method: 'POST' }, env)
		expect(response.status).toBe(200)
		expect(legacyStub.recheckUser).toHaveBeenCalled()
	})

	it('calls legacy resolve via rpc', async () => {
		const app = createApp(makeUser())
		const response = await app.request(
			'/api/admin/legacy/migrations/queue-1/resolve',
			{
				method: 'POST',
				body: JSON.stringify({ decision: 'accept' }),
			},
			env
		)
		expect(response.status).toBe(200)
		expect(legacyStub.resolveMigration).toHaveBeenCalledWith('queue-1', { decision: 'accept' })
	})
})

