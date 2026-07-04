import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import oauthRoutes from '../oauth'

import type { SessionUser } from '../../context'

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: '00000000-0000-0000-0000-000000000001',
		mainCharacterId: '7001',
		sessionId: 'session-1',
		sessionCreatedAt: '2026-06-01T00:00:00.000Z',
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
		fetch: vi.fn(),
	}

	const env = {
		THIRD_PARTY_APPS: thirdPartyAppsStub,
	} as any

	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-06-01T00:10:00.000Z'))
		vi.clearAllMocks()
		thirdPartyAppsStub.fetch.mockImplementation(async (request: Request) => {
			const url = new URL(request.url)
			if (url.pathname === '/__internal/oauth/authorize/preview') {
				return Response.json({
					clientId: 'client-1',
					clientName: 'Client One',
					scope: ['profile', 'esi:esi-mail.read_mail.v1'],
					state: 'state-1',
				})
			}
			if (url.pathname === '/__internal/oauth/authorize/resolve') {
				return Response.json({
					redirectTo: 'https://example.app/callback?code=abc123',
				})
			}
			return new Response('not found', { status: 404 })
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
		expect(await response.json()).toEqual(
			expect.objectContaining({
				requestUrl: 'https://pleaseignore.app/authorize?client_id=client-1',
				requiresFreshSession: false,
			})
		)
		expect(thirdPartyAppsStub.fetch).toHaveBeenCalledTimes(1)
		expect(thirdPartyAppsStub.fetch.mock.calls[0]?.[0]).toBeInstanceOf(Request)
		expect(new URL(thirdPartyAppsStub.fetch.mock.calls[0]?.[0].url ?? '').pathname).toBe(
			'/__internal/oauth/authorize/preview'
		)
	})

	afterEach(() => {
		vi.useRealTimers()
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
		expect(thirdPartyAppsStub.fetch).toHaveBeenCalledTimes(1)
		expect(thirdPartyAppsStub.fetch.mock.calls[0]?.[0]).toBeInstanceOf(Request)
		expect(new URL(thirdPartyAppsStub.fetch.mock.calls[0]?.[0].url ?? '').pathname).toBe(
			'/__internal/oauth/authorize/resolve'
		)
	})

	it('requires a fresh session before completing authorization', async () => {
		const app = createApp(
			makeUser({
				sessionCreatedAt: '2026-05-01T00:00:00.000Z',
			})
		)
		const previewResponse = await app.request(
			'https://pleaseignore.app/api/oauth/authorize?requestUrl=https%3A%2F%2Fpleaseignore.app%2Fauthorize%3Fclient_id%3Dclient-1',
			{},
			env
		)
		expect(previewResponse.status).toBe(200)
		expect(await previewResponse.json()).toEqual(
			expect.objectContaining({
				requestUrl: 'https://pleaseignore.app/authorize?client_id=client-1',
				requiresFreshSession: true,
			})
		)

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

		expect(response.status).toBe(401)
		expect(await response.json()).toEqual(
			expect.objectContaining({
				error: 'Reauthentication required. Please sign in again to continue.',
				reauthRequired: true,
			})
		)
		expect(thirdPartyAppsStub.fetch).toHaveBeenCalledTimes(1)
	})

	it('returns a clear error when the third-party apps binding is missing', async () => {
		const app = createApp(makeUser())
		const response = await app.request(
			'https://pleaseignore.app/api/oauth/authorize?requestUrl=https%3A%2F%2Fpleaseignore.app%2Fauthorize%3Fclient_id%3Dclient-1',
			{},
			{
				ENVIRONMENT: 'development',
			} as any
		)

		expect(response.status).toBe(503)
		expect(await response.json()).toEqual(
			expect.objectContaining({
				error: 'Third-party apps service binding is not configured',
			})
		)
	})
})
