import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import adminStructuresRoutes from '../admin/structures'

import type { SessionUser } from '../../context'

const structuresMocks = vi.hoisted(() => ({
	createStructureAlertDestination: vi.fn(),
}))

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: 'main-1',
		sessionId: 'session-1',
		characters: [],
		is_admin: true,
		roles: [],
		discordUserId: null,
		...overrides,
	}
}

function createApp(user?: SessionUser) {
	const app = new Hono<{ Bindings: any; Variables: { user?: SessionUser } }>()

	if (user) {
		app.use('*', async (c, next) => {
			c.set('user', user)
			await next()
		})
	}

	app.route('/api/admin/structures', adminStructuresRoutes)
	return app
}

describe('admin structures alert routes', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		structuresMocks.createStructureAlertDestination.mockResolvedValue({ id: 'dest-1' })
	})

	it('accepts webhook destinations for structure alert destinations', async () => {
		const app = createApp(makeUser())
		const response = await app.request(
			'/api/admin/structures/groups/group-1/destinations',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					alertType: 'structure_state_changed',
					destinationType: 'discord_webhook',
					destinationConfig: {
						webhookUrl: 'https://discord.com/api/webhooks/123/abc',
					},
					isEnabled: true,
				}),
			},
			{
				STRUCTURES: {
					createStructureAlertDestination: structuresMocks.createStructureAlertDestination,
				},
			} as any
		)

		expect(response.status).toBe(200)
		expect(structuresMocks.createStructureAlertDestination).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'user-1',
				is_admin: true,
			}),
			'group-1',
			expect.objectContaining({
				alertType: 'structure_state_changed',
				destinationType: 'discord_webhook',
				destinationConfig: {
					webhookUrl: 'https://discord.com/api/webhooks/123/abc',
				},
				isEnabled: true,
			})
		)
	})

	it('rejects webhook destinations without a webhook URL', async () => {
		const app = createApp(makeUser())
		const response = await app.request(
			'/api/admin/structures/groups/group-1/destinations',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					alertType: 'structure_state_changed',
					destinationType: 'discord_webhook',
				}),
			},
			{
				STRUCTURES: {
					createStructureAlertDestination: structuresMocks.createStructureAlertDestination,
				},
			} as any
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual(
			expect.objectContaining({
				error: 'webhookUrl is required for discord_webhook destinations',
			})
		)
	})

	it('rejects invalid webhook urls for structure alert destinations', async () => {
		const app = createApp(makeUser())
		const response = await app.request(
			'/api/admin/structures/groups/group-1/destinations',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					alertType: 'structure_state_changed',
					destinationType: 'discord_webhook',
					destinationConfig: {
						webhookUrl: 'https://example.com/not-a-discord-webhook',
					},
				}),
			},
			{
				STRUCTURES: {
					createStructureAlertDestination: structuresMocks.createStructureAlertDestination,
				},
			} as any
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual(
			expect.objectContaining({
				error: 'webhookUrl must be a valid Discord webhook URL for discord_webhook destinations',
			})
		)
	})
})
