import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import groupsRoutes from '../groups'

import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../middleware/session', () => ({
	requireAuth:
		() =>
			async (_c: unknown, next: () => Promise<void>): Promise<void> => {
				await next()
			},
	requireAdmin:
		() =>
			async (c: any, next: () => Promise<void>): Promise<Response | void> => {
				const user = c.get('user')
				if (!user?.is_admin) {
					return c.json({ error: 'Forbidden' }, 403)
				}
				await next()
			},
}))

const getStubMock = vi.mocked(getStub)

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: '1001',
		sessionId: 'session-1',
		characters: [],
		is_admin: false,
		roles: [],
		discordUserId: null,
		...overrides,
	}
}

function createApp(user: SessionUser) {
	const app = new Hono<{
		Bindings: any
		Variables: {
			user?: SessionUser
		}
	}>()

	app.use('*', async (c, next) => {
		c.set('user', user)
		await next()
	})

	app.route('/api/groups', groupsRoutes)
	return app
}

describe('groups admin membership routes', () => {
	const env = {
		GROUPS: { name: 'GROUPS' },
	} as any

	let groupsStub: {
		addAdmin: ReturnType<typeof vi.fn>
		removeAdmin: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.clearAllMocks()
		groupsStub = {
			addAdmin: vi.fn(),
			removeAdmin: vi.fn(),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.GROUPS) return groupsStub as any
			throw new Error('Unexpected binding')
		})
	})

	it('allows non-site-admin group owner flow to add an admin (DO enforces ownership)', async () => {
		const user = makeUser({ id: 'owner-user', is_admin: false })
		const app = createApp(user)

		const res = await app.request(
			'/api/groups/group-1/admins',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: 'target-user' }),
			},
			env
		)

		expect(res.status).toBe(200)
		expect(groupsStub.addAdmin).toHaveBeenCalledWith('group-1', 'owner-user', 'target-user', false)
	})

	it('allows non-site-admin group owner flow to remove an admin (DO enforces ownership)', async () => {
		const user = makeUser({ id: 'owner-user', is_admin: false })
		const app = createApp(user)

		const res = await app.request('/api/groups/group-1/admins/target-user', { method: 'DELETE' }, env)

		expect(res.status).toBe(200)
		expect(groupsStub.removeAdmin).toHaveBeenCalledWith('group-1', 'owner-user', 'target-user', false)
	})
})
