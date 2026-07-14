import { Hono } from 'hono'
import { createExecutionContext } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import groupsRoutes from '../groups'
import { createDb } from '../../db'

import type { SessionUser } from '../../context'

const serviceMocks = vi.hoisted(() => ({
	waitUntilWithTelemetry: vi.fn((_: unknown, __: string, task: () => Promise<unknown>) => {
		void task()
	}),
	triggerDiscordRefreshWorkflow: vi.fn(),
	triggerMumbleRefreshWorkflow: vi.fn(),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../db', () => ({
	createDb: vi.fn(),
}))

vi.mock('../../lib/background-task', () => ({
	waitUntilWithTelemetry: serviceMocks.waitUntilWithTelemetry,
}))

vi.mock('../../lib/workflow-triggers', () => ({
	triggerDiscordRefreshWorkflow: serviceMocks.triggerDiscordRefreshWorkflow,
	triggerMumbleRefreshWorkflow: serviceMocks.triggerMumbleRefreshWorkflow,
}))

vi.mock('../../middleware/session', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../middleware/session')>()

	const passThrough =
		() =>
			async (_c: unknown, next: () => Promise<void>): Promise<void> => {
				await next()
			}

	return {
		...actual,
		requireAuth: passThrough,
		requireAllianceMember: passThrough,
		requireAdmin:
			() =>
				async (c: any, next: () => Promise<void>): Promise<Response | void> => {
					const user = c.get('user')
					if (!user?.is_admin) {
						return c.json({ error: 'Forbidden' }, 403)
					}
					await next()
				},
	}
})

const getStubMock = vi.mocked(getStub)
const createDbMock = vi.mocked(createDb)

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
		getGroup: ReturnType<typeof vi.fn>
		addMember: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.clearAllMocks()
		groupsStub = {
			addAdmin: vi.fn(),
			removeAdmin: vi.fn(),
			getGroup: vi.fn(),
			addMember: vi.fn(),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.GROUPS) return groupsStub as any
			throw new Error('Unexpected binding')
		})

			createDbMock.mockReturnValue({
				query: {
					userCharacters: {
						findFirst: vi.fn(),
					},
				},
			} as any)
			serviceMocks.triggerDiscordRefreshWorkflow.mockResolvedValue(undefined)
			serviceMocks.triggerMumbleRefreshWorkflow.mockResolvedValue(undefined)
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

	it('forces site-admin direct member adds through the admin-managed endpoint', async () => {
		const user = makeUser({ id: 'admin-user', is_admin: true })
		const app = createApp(user)
		const findFirst = vi.fn().mockResolvedValue({ userId: 'target-user' })
		const executionCtx = createExecutionContext()

		createDbMock.mockReturnValue({
			query: {
				userCharacters: {
					findFirst,
				},
			},
		} as any)

		groupsStub.getGroup.mockResolvedValue({
			id: 'group-1',
			joinMode: 'admin_managed',
		})

		const res = await app.request(
			'/api/groups/group-1/members',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ characterName: 'Target Main' }),
			},
			env,
			executionCtx
		)

		expect(res.status).toBe(200)
		expect(groupsStub.addMember).toHaveBeenCalledWith('group-1', 'admin-user', 'target-user')
		expect(findFirst).toHaveBeenCalled()
	})
})
