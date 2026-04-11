import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { getStub } from '@repo/do-utils'

import broadcastsRoutes from '../broadcasts'

import type { BroadcastTarget, BroadcastTemplate } from '@repo/broadcasts'
import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: vi.fn(),
	getCachedUserMemberships: vi.fn(),
}))

const getStubMock = vi.mocked(getStub)

const env = {
	BROADCASTS: { name: 'BROADCASTS' },
} as any

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'admin-1',
		mainCharacterId: '7001',
		sessionId: 'session-1',
		characters: [],
		is_admin: true,
		roles: [ROLE_CORE_ALLIANCE_MEMBER],
		discordUserId: null,
		...overrides,
	}
}

function makeTarget(overrides: Partial<BroadcastTarget> = {}): BroadcastTarget {
	const now = new Date().toISOString()
	return {
		id: 'target-1',
		name: 'Target 1',
		description: null,
		type: 'discord_channel',
		sendPermissionId: 'perm-send',
		managePermissionId: 'perm-manage',
		config: { guildId: 'g', channelId: 'c' },
		createdBy: 'user-1',
		createdAt: now,
		updatedAt: now,
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
		targetId: 'target-1',
		fieldSchema: [{ name: 'message', label: 'Message', type: 'textarea', required: true }],
		messageTemplate: '{{message}}',
		createdBy: 'user-1',
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
		getTarget: vi.fn().mockResolvedValue(makeTarget()),
		getTemplate: vi.fn().mockResolvedValue(makeTemplate()),
		createTemplate: vi.fn(),
		updateTemplate: vi.fn(),
	}
}

describe('broadcast template tag validation and schema normalization', () => {
	let broadcastsStub: ReturnType<typeof makeBroadcastsStub>

	beforeEach(() => {
		vi.clearAllMocks()
		broadcastsStub = makeBroadcastsStub()
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.BROADCASTS) return broadcastsStub as any
			throw new Error('Unexpected binding')
		})
	})

	it('rejects template create when tag name contains invalid characters', async () => {
		const app = createApp(makeUser())
		const response = await app.request(
			'/api/broadcasts/templates',
			{
				method: 'POST',
				body: JSON.stringify({
					name: 'Bad Template',
					targetType: 'discord_channel',
					targetId: 'target-1',
					fieldSchema: [],
					messageTemplate: '{{bad tag}}',
				}),
			},
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual(
			expect.objectContaining({
				error: expect.stringContaining('Invalid template tag name'),
			})
		)
		expect(broadcastsStub.createTemplate).not.toHaveBeenCalled()
	})

	it('normalizes fieldSchema from messageTemplate tags on create', async () => {
		const app = createApp(makeUser())
		broadcastsStub.createTemplate.mockImplementation(async (data: any) => ({
			...makeTemplate(),
			name: data.name,
			targetId: data.targetId,
			targetType: data.targetType,
			messageTemplate: data.messageTemplate,
			fieldSchema: data.fieldSchema,
		}))

		const response = await app.request(
			'/api/broadcasts/templates',
			{
				method: 'POST',
				body: JSON.stringify({
					name: 'Test Inputs',
					targetType: 'discord_channel',
					targetId: 'target-1',
					fieldSchema: [{ name: 'message', label: 'Message', type: 'text', required: true }],
					messageTemplate: '{{message1}}\n\n{{message2}}\n\n{{message3}}',
				}),
			},
			env
		)

		expect(response.status).toBe(201)
		expect(broadcastsStub.createTemplate).toHaveBeenCalledWith(
			expect.objectContaining({
				fieldSchema: [
					{ name: 'message1', label: 'Message1', type: 'text', required: true },
					{ name: 'message2', label: 'Message2', type: 'text', required: true },
					{ name: 'message3', label: 'Message3', type: 'text', required: true },
				],
			}),
			'admin-1'
		)
	})

	it('normalizes stale fieldSchema during template update', async () => {
		const app = createApp(makeUser())
		broadcastsStub.getTemplate.mockResolvedValue(
			makeTemplate({
				fieldSchema: [{ name: 'message', label: 'Message', type: 'textarea', required: true }],
				messageTemplate: '{{message}}',
			})
		)
		broadcastsStub.updateTemplate.mockImplementation(async (_templateId: string, data: any) => ({
			...makeTemplate(),
			fieldSchema: data.fieldSchema,
			messageTemplate: data.messageTemplate,
		}))

		const response = await app.request(
			'/api/broadcasts/templates/template-1',
			{
				method: 'PATCH',
				body: JSON.stringify({
					name: 'Test Inputs',
					fieldSchema: [{ name: 'message', label: 'Message', type: 'text', required: true }],
					messageTemplate: '{{message1}}\n{{message2}}',
				}),
			},
			env
		)

		expect(response.status).toBe(200)
		expect(broadcastsStub.updateTemplate).toHaveBeenCalledWith(
			'template-1',
			expect.objectContaining({
				fieldSchema: [
					{ name: 'message1', label: 'Message1', type: 'text', required: true },
					{ name: 'message2', label: 'Message2', type: 'text', required: true },
				],
			}),
			'admin-1'
		)
	})
})
