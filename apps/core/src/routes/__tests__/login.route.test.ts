import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

import loginRoutes from '../login'

import type { SessionUser } from '../../context'

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: '00000000-0000-0000-0000-000000000001',
		mainCharacterId: '7001',
		sessionId: 'session-1',
		sessionCreatedAt: '2026-06-01T00:00:00.000Z',
		characters: [],
		is_admin: false,
		roles: [],
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

	app.route('/login', loginRoutes)
	return app
}

describe('login route', () => {
	it('redirects authenticated users to the requested redirect target by default', async () => {
		const app = createApp(makeUser())
		const response = await app.request('https://pleaseignore.app/login?redirect=%2Fdashboard', {}, {} as any)

		expect(response.status).toBe(302)
		expect(response.headers.get('location')).toBe('/dashboard')
	})

	it('forces a fresh login flow when reauth is requested', async () => {
		const app = createApp(makeUser())
		const response = await app.request(
			'https://pleaseignore.app/login?redirect=%2Foauth%2Fauthorize%3FrequestUrl%3Dabc&reauth=1',
			{},
			{} as any
		)

		expect(response.status).toBe(302)
		expect(response.headers.get('location')).toBe(
			'/api/auth/login?redirect=%2Foauth%2Fauthorize%3FrequestUrl%3Dabc'
		)
	})
})
