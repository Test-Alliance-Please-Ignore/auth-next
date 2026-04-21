import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { getStub } from '@repo/do-utils'

import { getCachedUserPermissions } from '../../lib/groups-cache'
import broadcastsRoutes from '../broadcasts'

import type { BroadcastWithDetails } from '@repo/broadcasts'
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

function makeBroadcast(overrides: Partial<BroadcastWithDetails> = {}): BroadcastWithDetails {
	const now = new Date().toISOString()

	return {
		id: 'broadcast-1',
		templateId: null,
		targetId: 'target-1',
		title: 'Test broadcast',
		content: { message: 'hello' },
		status: 'sent',
		scheduledFor: null,
		sentAt: now,
		errorMessage: null,
		permissionId: 'perm-target-send',
		createdBy: 'creator-1',
		createdByCharacterName: 'Creator',
		createdAt: now,
		updatedAt: now,
		template: null,
		target: {
			id: 'target-1',
			name: 'Target 1',
			description: null,
			type: 'discord_channel',
			sendPermissionId: 'perm-target-send',
			managePermissionId: 'perm-target-manage',
			displayOrder: 0,
			config: { guildId: 'g', channelId: 'c' },
			createdBy: 'creator-1',
			createdAt: now,
			updatedAt: now,
		},
		deliveries: [],
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

	app.route('/api/broadcasts', broadcastsRoutes)
	return app
}

function makeBroadcastsStub() {
	return {
		getBroadcast: vi.fn(),
		deleteBroadcast: vi.fn().mockResolvedValue(undefined),
		rescindBroadcast: vi.fn().mockResolvedValue(undefined),
	}
}

describe('broadcasts action permission gates', () => {
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

	it('blocks delete when user lacks target manage permission ID', async () => {
		const app = createApp(makeUser({ id: 'user-no-manage' }))
		broadcastsStub.getBroadcast.mockResolvedValue(makeBroadcast())
		getCachedUserPermissionsMock.mockResolvedValue([
			makePermission('perm-target-send', 'urn:broadcasts:alliance:ops:send'),
		])

		const response = await app.request('/api/broadcasts/broadcast-1', { method: 'DELETE' }, env)

		expect(response.status).toBe(403)
		expect(broadcastsStub.deleteBroadcast).not.toHaveBeenCalled()
	})

	it('allows delete when user has target manage permission ID', async () => {
		const app = createApp(makeUser({ id: 'user-manage' }))
		broadcastsStub.getBroadcast.mockResolvedValue(makeBroadcast())
		getCachedUserPermissionsMock.mockResolvedValue([
			makePermission('perm-target-manage', 'urn:broadcasts:alliance:ops:manage'),
		])

		const response = await app.request('/api/broadcasts/broadcast-1', { method: 'DELETE' }, env)

		expect(response.status).toBe(200)
		expect(broadcastsStub.deleteBroadcast).toHaveBeenCalledWith('broadcast-1', 'user-manage')
	})

	it('blocks rescind for non-owner without target manage permission ID', async () => {
		const app = createApp(makeUser({ id: 'user-no-manage' }))
		broadcastsStub.getBroadcast.mockResolvedValue(makeBroadcast({ createdBy: 'someone-else' }))
		getCachedUserPermissionsMock.mockResolvedValue([
			makePermission('perm-target-send', 'urn:broadcasts:alliance:ops:send'),
		])

		const response = await app.request(
			'/api/broadcasts/broadcast-1/rescind',
			{ method: 'POST', body: JSON.stringify({ rescindMessage: 'stop' }) },
			env
		)

		expect(response.status).toBe(403)
		expect(broadcastsStub.rescindBroadcast).not.toHaveBeenCalled()
	})

	it('allows rescind for owner without target manage permission ID', async () => {
		const app = createApp(makeUser({ id: 'owner-1' }))
		broadcastsStub.getBroadcast.mockResolvedValue(makeBroadcast({ createdBy: 'owner-1' }))
		getCachedUserPermissionsMock.mockResolvedValue([])

		const response = await app.request(
			'/api/broadcasts/broadcast-1/rescind',
			{ method: 'POST', body: JSON.stringify({ rescindMessage: 'bad ping' }) },
			env
		)

		expect(response.status).toBe(200)
		expect(broadcastsStub.rescindBroadcast).toHaveBeenCalledWith(
			'broadcast-1',
			'owner-1',
			'bad ping'
		)
	})

	it('allows rescind for non-owner with target manage permission ID', async () => {
		const app = createApp(makeUser({ id: 'user-manage' }))
		broadcastsStub.getBroadcast.mockResolvedValue(makeBroadcast({ createdBy: 'someone-else' }))
		getCachedUserPermissionsMock.mockResolvedValue([
			makePermission('perm-target-manage', 'urn:broadcasts:alliance:ops:manage'),
		])

		const response = await app.request(
			'/api/broadcasts/broadcast-1/rescind',
			{ method: 'POST', body: JSON.stringify({ rescindMessage: 'cleanup' }) },
			env
		)

		expect(response.status).toBe(200)
		expect(broadcastsStub.rescindBroadcast).toHaveBeenCalledWith(
			'broadcast-1',
			'user-manage',
			'cleanup'
		)
	})
})
