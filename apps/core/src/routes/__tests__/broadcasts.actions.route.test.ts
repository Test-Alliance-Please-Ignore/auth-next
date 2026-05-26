import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { getStub } from '@repo/do-utils'

import { getCachedUserPermissions } from '../../lib/groups-cache'
import broadcastsRoutes from '../broadcasts'

import type { BroadcastWithDetails } from '@repo/broadcasts'
import type { UserPermission } from '@repo/groups'
import type { SessionUser } from '../../context'
import type { BroadcastTemplate } from '@repo/broadcasts'

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

function makeTemplate(overrides: Partial<BroadcastTemplate> = {}): BroadcastTemplate {
	const now = new Date().toISOString()
	return {
		id: 'template-1',
		name: 'Template 1',
		description: null,
		targetType: 'discord_channel',
		displayOrder: 0,
		targetIds: ['target-1'],
		fieldSchema: [{ name: 'message', label: 'Message', type: 'text', required: true }],
		messageTemplate: '{{message}}',
		createdBy: 'creator-1',
		createdAt: now,
		updatedAt: now,
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
		sendBroadcast: vi.fn(),
		deleteBroadcast: vi.fn().mockResolvedValue(undefined),
		rescindBroadcast: vi.fn().mockResolvedValue(undefined),
		addBroadcastAddendum: vi.fn().mockResolvedValue(undefined),
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

	it('blocks send when fleet tracking is requested without tracking-create permission', async () => {
		const app = createApp(makeUser({ id: 'user-send-only' }))
		broadcastsStub.getBroadcast.mockResolvedValue(
			makeBroadcast({
				content: {
					message: 'hello',
					__fleetTrackingEnabled: 'true',
					__fleetTrackingCharacterId: '1234',
				},
				template: {
					...makeTemplate(),
					fieldSchema: [
						{ name: 'message', label: 'Message', type: 'text', required: true },
						{
							name: '__fleetTrackingEnabled',
							label: 'Fleet Tracking',
							type: 'system_fleet_tracking',
							required: false,
						},
					],
				},
			})
		)
		getCachedUserPermissionsMock.mockResolvedValue([
			makePermission('perm-target-send', 'urn:broadcasts:alliance:ops:send'),
		])

		const response = await app.request('/api/broadcasts/broadcast-1/send', { method: 'POST' }, env)

		expect(response.status).toBe(403)
		expect(await response.json()).toEqual(
			expect.objectContaining({
				error: 'You do not have permission to start fleet tracking.',
			})
		)
		expect(broadcastsStub.sendBroadcast).not.toHaveBeenCalled()
	})

	it('allows addendum for sent broadcast with owner access', async () => {
		const app = createApp(makeUser({ id: 'owner-1' }))
		broadcastsStub.getBroadcast.mockResolvedValue(
			makeBroadcast({
				status: 'sent',
				createdBy: 'owner-1',
			})
		)

		const response = await app.request(
			'/api/broadcasts/broadcast-1/addendum',
			{ method: 'POST', body: JSON.stringify({ addendumMessage: 'Additional context' }) },
			env
		)

		expect(response.status).toBe(200)
		expect(broadcastsStub.addBroadcastAddendum).toHaveBeenCalledWith(
			'broadcast-1',
			'owner-1',
			'Additional context'
		)
	})

	it('rejects addendum for rescinded broadcast', async () => {
		const app = createApp(makeUser({ id: 'owner-1' }))
		broadcastsStub.getBroadcast.mockResolvedValue(
			makeBroadcast({
				status: 'rescinded',
				createdBy: 'owner-1',
			})
		)

		const response = await app.request(
			'/api/broadcasts/broadcast-1/addendum',
			{ method: 'POST', body: JSON.stringify({ addendumMessage: 'Should fail' }) },
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual(
			expect.objectContaining({
				error: 'Only sent broadcasts can receive an addendum',
			})
		)
		expect(broadcastsStub.addBroadcastAddendum).not.toHaveBeenCalled()
	})

	it('rejects rescind for already rescinded broadcast', async () => {
		const app = createApp(makeUser({ id: 'owner-1' }))
		broadcastsStub.getBroadcast.mockResolvedValue(
			makeBroadcast({
				status: 'rescinded',
				createdBy: 'owner-1',
			})
		)

		const response = await app.request(
			'/api/broadcasts/broadcast-1/rescind',
			{ method: 'POST', body: JSON.stringify({ rescindMessage: 'Too late' }) },
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual(
			expect.objectContaining({
				error: 'Only sent broadcasts can be rescinded',
			})
		)
		expect(broadcastsStub.rescindBroadcast).not.toHaveBeenCalled()
	})
})
