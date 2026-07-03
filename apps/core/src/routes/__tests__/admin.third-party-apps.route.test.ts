import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'

import adminRoutes from '../admin'

import type { SessionUser } from '../../context'

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

describe('admin third-party apps rpc routes', () => {
	const thirdPartyAppsStub = {
		listClients: vi.fn(),
		createClient: vi.fn(),
		updateClient: vi.fn(),
		deleteClient: vi.fn(),
		regenerateClientSecret: vi.fn(),
	}

	const env = {
		THIRD_PARTY_APPS: thirdPartyAppsStub,
	} as any

	beforeEach(() => {
		vi.clearAllMocks()
		thirdPartyAppsStub.listClients.mockResolvedValue({
			items: [],
			cursor: undefined,
		})
		thirdPartyAppsStub.createClient.mockResolvedValue({
			clientId: 'client-1',
			clientName: 'Client One',
			redirectUris: ['https://example.app/callback'],
			scopes: ['profile'],
		})
		thirdPartyAppsStub.updateClient.mockResolvedValue({
			clientId: 'client-1',
			clientName: 'Client One Updated',
			redirectUris: ['https://example.app/callback'],
			scopes: ['profile'],
		})
		thirdPartyAppsStub.deleteClient.mockResolvedValue(undefined)
		thirdPartyAppsStub.regenerateClientSecret.mockResolvedValue({
			clientId: 'client-1',
			clientSecret: 'new-secret',
		})
	})

	it('lists clients via rpc', async () => {
		const app = createApp(makeUser())
		const response = await app.request('/api/admin/third-party-apps/clients?limit=10', {}, env)
		expect(response.status).toBe(200)
		expect(thirdPartyAppsStub.listClients).toHaveBeenCalledWith({ limit: 10, cursor: undefined })
	})

	it('creates clients via rpc', async () => {
		const app = createApp(makeUser())
		const response = await app.request(
			'/api/admin/third-party-apps/clients',
			{
				method: 'POST',
				body: JSON.stringify({
					clientName: 'Client One',
					redirectUris: ['https://example.app/callback'],
					scopes: ['profile'],
					tokenEndpointAuthMethod: 'client_secret_basic',
					grantTypes: ['authorization_code'],
					responseTypes: ['code'],
				}),
			},
			env
		)
		expect(response.status).toBe(201)
		expect(thirdPartyAppsStub.createClient).toHaveBeenCalledWith(
			expect.objectContaining({
				clientName: 'Client One',
				redirectUris: ['https://example.app/callback'],
			})
		)
	})

	it('updates clients via rpc', async () => {
		const app = createApp(makeUser())
		const response = await app.request(
			'/api/admin/third-party-apps/clients/client-1',
			{
				method: 'PATCH',
				body: JSON.stringify({
					clientName: 'Client One Updated',
				}),
			},
			env
		)
		expect(response.status).toBe(200)
		expect(thirdPartyAppsStub.updateClient).toHaveBeenCalledWith(
			'client-1',
			expect.objectContaining({
				clientName: 'Client One Updated',
			})
		)
	})

	it('deletes clients via rpc', async () => {
		const app = createApp(makeUser())
		const response = await app.request('/api/admin/third-party-apps/clients/client-1', { method: 'DELETE' }, env)
		expect(response.status).toBe(204)
		expect(thirdPartyAppsStub.deleteClient).toHaveBeenCalledWith('client-1')
	})

	it('regenerates secrets via rpc', async () => {
		const app = createApp(makeUser())
		const response = await app.request(
			'/api/admin/third-party-apps/clients/client-1/regenerate-secret',
			{ method: 'POST' },
			env
		)
		expect(response.status).toBe(200)
		expect(thirdPartyAppsStub.regenerateClientSecret).toHaveBeenCalledWith('client-1')
	})
})
