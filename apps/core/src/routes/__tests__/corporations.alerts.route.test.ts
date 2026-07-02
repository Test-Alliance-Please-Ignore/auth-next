import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import corporationsRoutes from '../corporations'

import type { SessionUser } from '../../context'

const serviceMocks = vi.hoisted(() => ({
	listCorporationAlertTypes: vi.fn(),
	listCorporationAlertDestinations: vi.fn(),
	createCorporationAlertDestination: vi.fn(),
	updateCorporationAlertDestination: vi.fn(),
	deleteCorporationAlertDestination: vi.fn(),
}))

vi.mock('../../services/corporation-alerts.service', () => serviceMocks)

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

function makeDb() {
	return {
		query: {
			alertDestinations: {
				findFirst: vi.fn(),
			},
			managedCorporations: {
				findFirst: vi.fn(),
			},
		},
	}
}

function createApp(user?: SessionUser, db?: ReturnType<typeof makeDb>) {
	const app = new Hono<{ Bindings: any; Variables: { user?: SessionUser; db?: any } }>()

	if (user || db) {
		app.use('*', async (c, next) => {
			if (user) {
				c.set('user', user)
			}
			if (db) {
				c.set('db', db)
			}
			await next()
		})
	}

	app.route('/api/corporations', corporationsRoutes)
	return app
}

describe('corporation alerts routes', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		serviceMocks.listCorporationAlertTypes.mockReturnValue([
			{
				type: 'corp_application_submitted',
				label: 'Corporation Application Submitted',
				description: 'Sent when a new HR application is submitted to this corporation.',
				supportedDestinationTypes: ['discord_channel', 'discord_user', 'discord_webhook'],
			},
		])
		serviceMocks.listCorporationAlertDestinations.mockResolvedValue([])
		serviceMocks.createCorporationAlertDestination.mockResolvedValue({ id: 'dest-1' })
		serviceMocks.updateCorporationAlertDestination.mockResolvedValue({ id: 'dest-1' })
		serviceMocks.deleteCorporationAlertDestination.mockResolvedValue(undefined)
	})

	it('returns the supported alert types', async () => {
		const app = createApp(makeUser(), makeDb())
		const response = await app.request('/api/corporations/alerts/types', {}, {} as any)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([
			expect.objectContaining({
				type: 'corp_application_submitted',
			}),
		])
	})

	it('lists alert destinations for a corporation', async () => {
		const db = makeDb()
		db.query.managedCorporations.findFirst.mockResolvedValue({ corporationId: 'corp-1' })
		serviceMocks.listCorporationAlertDestinations.mockResolvedValue([
			{ id: 'dest-1', corporationId: 'corp-1' },
		])

		const app = createApp(makeUser(), db)
		const response = await app.request('/api/corporations/corp-1/alerts', {}, {} as any)

		expect(response.status).toBe(200)
		expect(serviceMocks.listCorporationAlertDestinations).toHaveBeenCalledWith(db, 'corp-1')
	})

	it('creates a discord channel alert destination', async () => {
		const db = makeDb()
		db.query.managedCorporations.findFirst.mockResolvedValue({ corporationId: 'corp-1' })
		const app = createApp(makeUser({ id: 'user-9' }), db)

		const response = await app.request('/api/corporations/corp-1/alerts', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				alertType: 'corp_application_submitted',
				destinationType: 'discord_channel',
				discordServerId: 'server-1',
				channelId: 'channel-1',
				isEnabled: true,
			}),
		}, {} as any)

		expect(response.status).toBe(201)
		expect(serviceMocks.createCorporationAlertDestination).toHaveBeenCalledWith(
			db,
			expect.objectContaining({
				corporationId: 'corp-1',
				alertType: 'corp_application_submitted',
				destinationType: 'discord_channel',
				discordServerId: 'server-1',
				channelId: 'channel-1',
				createdBy: 'user-9',
				updatedBy: 'user-9',
			})
		)
	})

	it('creates a discord webhook alert destination', async () => {
		const db = makeDb()
		db.query.managedCorporations.findFirst.mockResolvedValue({ corporationId: 'corp-1' })
		const app = createApp(makeUser({ id: 'user-9' }), db)

		const response = await app.request(
			'/api/corporations/corp-1/alerts',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					alertType: 'corp_application_submitted',
					destinationType: 'discord_webhook',
					destinationConfig: {
						webhookUrl: 'https://discord.com/api/webhooks/123/abc',
					},
					isEnabled: true,
				}),
			},
			{} as any
		)

		expect(response.status).toBe(201)
		expect(serviceMocks.createCorporationAlertDestination).toHaveBeenCalledWith(
			db,
			expect.objectContaining({
				corporationId: 'corp-1',
				alertType: 'corp_application_submitted',
				destinationType: 'discord_webhook',
				destinationConfig: {
					webhookUrl: 'https://discord.com/api/webhooks/123/abc',
				},
				createdBy: 'user-9',
				updatedBy: 'user-9',
			})
		)
	})

	it('rejects incomplete discord channel destinations before service calls', async () => {
		const db = makeDb()
		db.query.managedCorporations.findFirst.mockResolvedValue({ corporationId: 'corp-1' })
		const app = createApp(makeUser(), db)

		const response = await app.request('/api/corporations/corp-1/alerts', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				alertType: 'corp_application_submitted',
				destinationType: 'discord_channel',
				discordServerId: 'server-1',
			}),
		}, {} as any)

		expect(response.status).toBe(400)
		expect(serviceMocks.createCorporationAlertDestination).not.toHaveBeenCalled()
	})

	it('rejects incomplete discord webhook destinations before service calls', async () => {
		const db = makeDb()
		db.query.managedCorporations.findFirst.mockResolvedValue({ corporationId: 'corp-1' })
		const app = createApp(makeUser(), db)

		const response = await app.request(
			'/api/corporations/corp-1/alerts',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					alertType: 'corp_application_submitted',
					destinationType: 'discord_webhook',
				}),
			},
			{} as any
		)

		expect(response.status).toBe(400)
		expect(serviceMocks.createCorporationAlertDestination).not.toHaveBeenCalled()
	})

	it('rejects invalid discord webhook urls before service calls', async () => {
		const db = makeDb()
		db.query.managedCorporations.findFirst.mockResolvedValue({ corporationId: 'corp-1' })
		const app = createApp(makeUser(), db)

		const response = await app.request(
			'/api/corporations/corp-1/alerts',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					alertType: 'corp_application_submitted',
					destinationType: 'discord_webhook',
					destinationConfig: {
						webhookUrl: 'https://example.com/not-a-discord-webhook',
					},
				}),
			},
			{} as any
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual(
			expect.objectContaining({
				error: 'webhookUrl must be a valid Discord webhook URL for discord_webhook destinations',
			})
		)
		expect(serviceMocks.createCorporationAlertDestination).not.toHaveBeenCalled()
	})

	it('updates an alert destination', async () => {
		const db = makeDb()
		db.query.managedCorporations.findFirst.mockResolvedValue({ corporationId: 'corp-1' })
		db.query.alertDestinations.findFirst.mockResolvedValue({
			id: 'dest-1',
			scopeType: 'corporation',
			scopeId: 'corp-1',
			destinationType: 'discord_channel',
			discordServerId: 'server-1',
			channelId: 'channel-1',
			coreUserId: null,
			groupId: null,
			destinationConfig: {},
		})
		const app = createApp(makeUser({ id: 'user-2' }), db)

		const response = await app.request('/api/corporations/corp-1/alerts/dest-1', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				isEnabled: false,
			}),
		}, {} as any)

		expect(response.status).toBe(200)
		expect(serviceMocks.updateCorporationAlertDestination).toHaveBeenCalledWith(
			db,
			'corp-1',
			'dest-1',
			expect.objectContaining({
				isEnabled: false,
				updatedBy: 'user-2',
			})
		)
	})

	it('deletes an alert destination', async () => {
		const db = makeDb()
		db.query.managedCorporations.findFirst.mockResolvedValue({ corporationId: 'corp-1' })
		const app = createApp(makeUser(), db)

		const response = await app.request('/api/corporations/corp-1/alerts/dest-1', {
			method: 'DELETE',
		}, {} as any)

		expect(response.status).toBe(200)
		expect(serviceMocks.deleteCorporationAlertDestination).toHaveBeenCalledWith(db, 'corp-1', 'dest-1')
	})
})
