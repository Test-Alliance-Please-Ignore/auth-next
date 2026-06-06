import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import oauthRoutes from '../oauth'

import type { SessionUser } from '../../context'

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: '00000000-0000-0000-0000-000000000001',
		mainCharacterId: '7001',
		sessionId: 'session-1',
		characters: [
			{
				id: 'char-1',
				characterOwnerHash: 'owner-hash-1',
				characterId: '7001',
				characterName: 'Alpha Pilot',
				is_primary: true,
				hasValidToken: true,
			},
		],
		is_admin: false,
		roles: [],
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

	app.route('/api/oauth', oauthRoutes)
	return app
}

describe('oauth authorize routes', () => {
	const thirdPartyAppsStub = {
		previewAuthorization: vi.fn(),
		resolveAuthorization: vi.fn(),
	}

	const env = {
		THIRD_PARTY_APPS: thirdPartyAppsStub,
	} as any

	beforeEach(() => {
		vi.clearAllMocks()
		thirdPartyAppsStub.previewAuthorization.mockResolvedValue({
			clientId: 'client-1',
			clientName: 'Client One',
			scope: ['profile', 'esi:esi-mail.read_mail.v1'],
			state: 'state-1',
		})
		thirdPartyAppsStub.resolveAuthorization.mockResolvedValue({
			redirectTo: 'https://example.app/callback?code=abc123',
		})
	})

	it('loads authorization preview via rpc', async () => {
		const app = createApp(makeUser())
		const response = await app.request(
			'https://pleaseignore.app/api/oauth/authorize?requestUrl=https%3A%2F%2Fpleaseignore.app%2Fauthorize%3Fclient_id%3Dclient-1',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(thirdPartyAppsStub.previewAuthorization).toHaveBeenCalledWith(
			'https://pleaseignore.app/authorize?client_id=client-1',
			'https://pleaseignore.app'
		)
	})

	it('resolves approval via rpc', async () => {
		const app = createApp(makeUser())
		const response = await app.request(
			'https://pleaseignore.app/api/oauth/authorize',
			{
				method: 'POST',
				body: JSON.stringify({
					requestUrl: 'https://pleaseignore.app/authorize?client_id=client-1',
					action: 'approve',
				}),
			},
			env
		)

		expect(response.status).toBe(200)
		expect(thirdPartyAppsStub.resolveAuthorization).toHaveBeenCalledWith(
			'https://pleaseignore.app/authorize?client_id=client-1',
			'https://pleaseignore.app',
			expect.objectContaining({
				id: '00000000-0000-0000-0000-000000000001',
				mainCharacterId: '7001',
				isAdmin: false,
				characters: expect.arrayContaining([
					expect.objectContaining({
						characterId: '7001',
						characterName: 'Alpha Pilot',
						isPrimary: true,
					}),
				]),
			}),
			'approve'
		)
	})
})
