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
	it('renders the login page in English by default', async () => {
		const app = createApp()
		const response = await app.request('https://pleaseignore.app/login', {}, {} as any)
		const body = await response.text()

		expect(response.status).toBe(200)
		expect(body).toContain('<html lang="en">')
		expect(body).toContain('Welcome to TEST Auth')
		expect(body).toMatch(/<option value="en" selected>\s*English\s*<\/option>/)
		expect(response.headers.get('cache-control')).toBe('private, no-store')
		expect(response.headers.get('vary')).toBe('Cookie, Accept-Language')
	})

	it('renders an explicitly selected locale and remembers it in a cookie', async () => {
		const app = createApp()
		const response = await app.request(
			'https://pleaseignore.app/login?locale=de&redirect=%2Fdashboard',
			{},
			{} as any
		)
		const body = await response.text()

		expect(response.status).toBe(200)
		expect(body).toContain('<html lang="de">')
		expect(body).toContain('Willkommen bei TEST Auth')
		expect(body).toMatch(/<option value="de" selected>\s*Deutsch\s*<\/option>/)
		expect(body).toContain('name="redirect" value="/dashboard"')
		const localeCookie = response.headers.get('set-cookie')
		expect(localeCookie).toContain('tang.locale=de; Max-Age=31536000; Path=/')
		expect(localeCookie).toContain('SameSite=Lax')
		expect(localeCookie).toContain('Secure')
		expect(localeCookie).not.toContain('HttpOnly')
	})

	it('uses a remembered locale before the browser language', async () => {
		const app = createApp()
		const response = await app.request('https://pleaseignore.app/login', {
			headers: {
				'Accept-Language': 'de-DE,de;q=0.9',
				Cookie: 'tang.locale=ko',
			},
		})
		const body = await response.text()

		expect(body).toContain('<html lang="ko">')
		expect(body).toContain('TEST Auth에 오신 것을 환영합니다')
		expect(body).toMatch(/<option value="ko" selected>\s*한국어\s*<\/option>/)
	})

	it('negotiates a supported browser language and ignores languages with q=0', async () => {
		const app = createApp()
		const response = await app.request('https://pleaseignore.app/login', {
			headers: { 'Accept-Language': 'fr-FR, de-DE;q=0, ko-KR;q=0.8' },
		})
		const body = await response.text()

		expect(body).toContain('<html lang="ko">')
		expect(response.headers.get('set-cookie')).toBeNull()
	})

	it('preserves redirect and reauthentication parameters when changing locale', async () => {
		const app = createApp()
		const response = await app.request(
			'https://pleaseignore.app/login?redirect=%2Foauth%2Fauthorize%3FrequestUrl%3Dabc&reauth=1',
			{},
			{} as any
		)
		const body = await response.text()

		expect(body).toContain('name="redirect" value="/oauth/authorize?requestUrl=abc"')
		expect(body).toContain('name="reauth" value="1"')
	})

	it('submits the locale form as soon as the selection changes', async () => {
		const app = createApp()
		const response = await app.request('https://pleaseignore.app/login', {}, {} as any)
		const body = await response.text()

		expect(body).toContain("loginLocaleSelect.addEventListener('change'")
		expect(body).toContain('localeForm.requestSubmit()')
		expect(body).toContain('<noscript>')
	})

	it('redirects authenticated users to the requested redirect target by default', async () => {
		const app = createApp(makeUser())
		const response = await app.request(
			'https://pleaseignore.app/login?redirect=%2Fdashboard',
			{},
			{} as any
		)

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
