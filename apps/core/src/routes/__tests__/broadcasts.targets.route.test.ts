import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { getStub } from '@repo/do-utils'

import { getCachedUserPermissions } from '../../lib/groups-cache'
import broadcastsRoutes from '../broadcasts'

import type { BroadcastTarget } from '@repo/broadcasts'
import type { UserPermission } from '@repo/groups'
import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: vi.fn(),
	getCachedUserMemberships: vi.fn(),
}))

const getStubMock = vi.mocked(getStub)
const getCachedUserPermissionsMock = vi.mocked(getCachedUserPermissions)

const env = {
	BROADCASTS: { name: 'BROADCASTS' },
} as any

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: '7001',
		sessionId: 'session-1',
		characters: [],
		is_admin: false,
		roles: [ROLE_CORE_ALLIANCE_MEMBER],
		discordUserId: null,
		...overrides,
	}
}

function makePermission(permissionId: string | null, urn: string): UserPermission {
	return {
		permissionId,
		urn,
		name: urn,
		description: null,
		category: null,
		groupId: 'group-1',
		groupName: 'Group 1',
		targetType: 'all_members',
		source: permissionId ? 'global' : 'group_scoped',
	}
}

function makeTarget(
	id: string,
	sendPermissionId: string,
	managePermissionId = sendPermissionId
): BroadcastTarget {
	return {
		id,
		name: `Target ${id}`,
		description: null,
		type: 'discord_channel',
		sendPermissionId,
		managePermissionId,
		config: { guildId: 'g', channelId: 'c' },
		createdBy: 'user-1',
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
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

	app.route('/api/broadcasts', broadcastsRoutes)
	return app
}

function makeBroadcastsStub() {
	return {
		listTargets: vi.fn().mockResolvedValue([]),
	}
}

describe('broadcasts targets route', () => {
	let broadcastsStub: ReturnType<typeof makeBroadcastsStub>

	beforeEach(() => {
		vi.clearAllMocks()
		broadcastsStub = makeBroadcastsStub()
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.BROADCASTS) return broadcastsStub as any
			throw new Error('Unexpected binding')
		})
		getCachedUserPermissionsMock.mockResolvedValue([])
	})

	it('returns 401 when unauthenticated', async () => {
		const app = createApp()
		const response = await app.request('/api/broadcasts/targets', {}, env)

		expect(response.status).toBe(401)
		expect(await response.json()).toEqual({ error: 'Unauthorized' })
	})

	it('returns empty list early when user has no broadcast target permission IDs', async () => {
		const app = createApp(makeUser())
		getCachedUserPermissionsMock.mockResolvedValue([
			makePermission(null, 'urn:group:abc:custom:permission'),
		])

		const response = await app.request('/api/broadcasts/targets', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([])
		expect(broadcastsStub.listTargets).not.toHaveBeenCalled()
	})

	it('passes allowed permission ID set to DO and filters response targets', async () => {
		const app = createApp(makeUser())
		getCachedUserPermissionsMock.mockResolvedValue([
			makePermission('perm-a-send', 'urn:broadcasts:alliance:a:send'),
			makePermission('perm-a-send', 'urn:broadcasts:alliance:a:send'),
		])

		broadcastsStub.listTargets.mockResolvedValue([
			makeTarget('target-a', 'perm-a-send'),
			makeTarget('target-a', 'perm-a-send'),
			makeTarget('target-b', 'perm-b-send'),
		])

		const response = await app.request('/api/broadcasts/targets', {}, env)
		const body = (await response.json()) as BroadcastTarget[]

		expect(response.status).toBe(200)
		expect(broadcastsStub.listTargets).toHaveBeenCalledWith('user-1', ['perm-a-send'])
		expect(body.map((t) => t.id)).toEqual(['target-a'])
	})

	it('treats managePermissionId as send-capable for target selection', async () => {
		const app = createApp(makeUser())
		getCachedUserPermissionsMock.mockResolvedValue([
			makePermission('perm-a-manage', 'urn:broadcasts:alliance:a:manage'),
		])

		broadcastsStub.listTargets.mockResolvedValue([
			makeTarget('target-manage-only', 'perm-a-send', 'perm-a-manage'),
			makeTarget('target-denied', 'perm-b-send', 'perm-b-manage'),
		])

		const response = await app.request('/api/broadcasts/targets', {}, env)
		const body = (await response.json()) as BroadcastTarget[]

		expect(response.status).toBe(200)
		expect(broadcastsStub.listTargets).toHaveBeenCalledWith('user-1', ['perm-a-manage'])
		expect(body.map((t) => t.id)).toEqual(['target-manage-only'])
	})

	it('bypasses permission filtering for admin users', async () => {
		const app = createApp(makeUser({ id: 'admin-1', is_admin: true }))
		broadcastsStub.listTargets.mockResolvedValue([
			makeTarget('target-a', 'perm-a'),
			makeTarget('target-b', 'perm-b'),
		])

		const response = await app.request('/api/broadcasts/targets', {}, env)

		expect(response.status).toBe(200)
		expect(getCachedUserPermissionsMock).not.toHaveBeenCalled()
		expect(broadcastsStub.listTargets).toHaveBeenCalledWith('admin-1', undefined)
		expect(await response.json()).toEqual([
			expect.objectContaining({ id: 'target-a' }),
			expect.objectContaining({ id: 'target-b' }),
		])
	})
})
