import { Hono } from 'hono'
import { createExecutionContext } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import groupsRoutes from '../groups'

import type { SessionUser } from '../../context'

const serviceMocks = vi.hoisted(() => ({
	triggerMumbleRefreshWorkflow: vi.fn(),
	waitUntilWithTelemetry: vi.fn((_: unknown, __: string, task: () => Promise<unknown>) => {
		void task()
	}),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../middleware/session', () => ({
	sessionMiddleware:
		() =>
			async (_c: unknown, next: () => Promise<void>): Promise<void> => {
				await next()
			},
	requireAuth:
		() =>
			async (_c: unknown, next: () => Promise<void>): Promise<void> => {
				await next()
			},
	requireAllianceMember:
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

vi.mock('../../lib/background-task', () => ({
	waitUntilWithTelemetry: serviceMocks.waitUntilWithTelemetry,
}))

vi.mock('../../lib/workflow-triggers', () => ({
	triggerDiscordRefreshWorkflow: vi.fn(),
	triggerMumbleRefreshWorkflow: serviceMocks.triggerMumbleRefreshWorkflow,
}))

const getStubMock = vi.mocked(getStub)

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'admin-user',
		mainCharacterId: 'main-1',
		sessionId: 'session-1',
		characters: [],
		is_admin: true,
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

describe('groups mumble sync triggers on update', () => {
	const env = {
		GROUPS: { name: 'GROUPS' },
	} as any

	let groupsStub: {
		createGroup: ReturnType<typeof vi.fn>
		getGroup: ReturnType<typeof vi.fn>
		updateGroup: ReturnType<typeof vi.fn>
		getGroupMemberUserIds: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.clearAllMocks()
		groupsStub = {
			createGroup: vi.fn(),
			getGroup: vi.fn(),
			updateGroup: vi.fn(),
			getGroupMemberUserIds: vi.fn(),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.GROUPS) return groupsStub as any
			throw new Error('Unexpected binding')
		})

		serviceMocks.triggerMumbleRefreshWorkflow.mockResolvedValue({
			status: 'triggered',
			triggered: true,
			workflowInstanceId: 'workflow-1',
		})
	})

	it('queues a mumble refresh when the group name changes', async () => {
		groupsStub.getGroup.mockResolvedValue({
			id: 'group-1',
			name: 'Old Name',
			mumbleSyncEnabled: true,
		})
		groupsStub.updateGroup.mockResolvedValue({
			id: 'group-1',
			name: 'New Name',
			mumbleSyncEnabled: true,
		})
		groupsStub.getGroupMemberUserIds.mockResolvedValue(['user-1', 'user-2'])

		const app = createApp(makeUser())
		const executionCtx = createExecutionContext()
		const response = await app.request(
			'/api/groups/group-1',
			{
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'New Name' }),
			},
			env,
			executionCtx
		)

		expect(response.status).toBe(200)
		expect(groupsStub.updateGroup).toHaveBeenCalledWith('group-1', { name: 'New Name' }, 'admin-user')
		expect(groupsStub.getGroupMemberUserIds).toHaveBeenCalledWith('group-1')
		expect(serviceMocks.triggerMumbleRefreshWorkflow).toHaveBeenCalledWith(
			expect.objectContaining({
				env,
				userIds: ['user-1', 'user-2'],
				source: 'group-updated',
			})
		)
		expect(serviceMocks.waitUntilWithTelemetry).toHaveBeenCalledWith(
			expect.anything(),
			'groups.mumble-refresh.update-group',
			expect.any(Function),
			expect.objectContaining({
				groupId: 'group-1',
				memberCount: 2,
				source: 'group-updated',
				mumbleSyncEnabled: true,
				groupName: 'New Name',
			})
		)
	})

	it('queues a mumble refresh when mumble sync is enabled for a group', async () => {
		groupsStub.getGroup.mockResolvedValue({
			id: 'group-1',
			name: 'Fleet',
			mumbleSyncEnabled: false,
		})
		groupsStub.updateGroup.mockResolvedValue({
			id: 'group-1',
			name: 'Fleet',
			mumbleSyncEnabled: true,
		})
		groupsStub.getGroupMemberUserIds.mockResolvedValue(['user-3'])

		const app = createApp(makeUser())
		const executionCtx = createExecutionContext()
		const response = await app.request(
			'/api/groups/group-1',
			{
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mumbleSyncEnabled: true }),
			},
			env,
			executionCtx
		)

		expect(response.status).toBe(200)
		expect(groupsStub.updateGroup).toHaveBeenCalledWith(
			'group-1',
			{ mumbleSyncEnabled: true },
			'admin-user'
		)
		expect(groupsStub.getGroupMemberUserIds).toHaveBeenCalledWith('group-1')
		expect(serviceMocks.triggerMumbleRefreshWorkflow).toHaveBeenCalledWith(
			expect.objectContaining({
				env,
				userIds: ['user-3'],
				source: 'group-updated',
			})
		)
	})

	it('queues a mumble refresh when the group ticker changes', async () => {
		groupsStub.getGroup.mockResolvedValue({
			id: 'group-1',
			name: 'Fleet',
			mumbleSyncEnabled: true,
			mumbleTicker: 'OLD',
		})
		groupsStub.updateGroup.mockResolvedValue({
			id: 'group-1',
			name: 'Fleet',
			mumbleSyncEnabled: true,
			mumbleTicker: 'FC',
		})
		groupsStub.getGroupMemberUserIds.mockResolvedValue(['user-4'])

		const app = createApp(makeUser())
		const executionCtx = createExecutionContext()
		const response = await app.request(
			'/api/groups/group-1',
			{
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mumbleTicker: 'FC' }),
			},
			env,
			executionCtx
		)

		expect(response.status).toBe(200)
		expect(serviceMocks.triggerMumbleRefreshWorkflow).toHaveBeenCalledWith(
			expect.objectContaining({
				env,
				userIds: ['user-4'],
				source: 'group-updated',
			})
		)
	})

	it('queues a mumble refresh when a mumble-enabled group is created', async () => {
		groupsStub.createGroup.mockResolvedValue({
			id: 'group-1',
			name: 'Fleet',
			mumbleSyncEnabled: true,
		})

		const app = createApp(makeUser())
		const executionCtx = createExecutionContext()
		const response = await app.request(
			'/api/groups',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					categoryId: 'category-1',
					name: 'Fleet',
					mumbleSyncEnabled: true,
				}),
			},
			env,
			executionCtx
		)

		expect(response.status).toBe(201)
		expect(groupsStub.createGroup).toHaveBeenCalledWith(
			{ categoryId: 'category-1', name: 'Fleet', mumbleSyncEnabled: true },
			'admin-user'
		)
		expect(serviceMocks.triggerMumbleRefreshWorkflow).toHaveBeenCalledWith(
			expect.objectContaining({
				env,
				userIds: ['admin-user'],
				source: 'group-created',
			})
		)
	})
})
