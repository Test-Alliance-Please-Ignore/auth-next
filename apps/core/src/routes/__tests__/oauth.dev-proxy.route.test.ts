import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleOAuthDevProxyRequest, isOAuthDevProxyPath } from '../oauth-dev-proxy'
import type { App } from '../../context'

function createApp() {
	const app = new Hono<App>()
	app.use('*', async (c, next) => {
		if (c.env.ENVIRONMENT === 'development' && isOAuthDevProxyPath(new URL(c.req.url).pathname)) {
			return await handleOAuthDevProxyRequest(c)
		}
		return await next()
	})
	return app
}

describe('oauth dev proxy routes', () => {
	const bindingFetchMock = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		bindingFetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
	})

	it('forwards oauth discovery requests to the third-party apps binding in development', async () => {
		const app = createApp()
		const res = await app.request(
			'http://127.0.0.1:8787/.well-known/oauth-authorization-server',
			{},
			{
				ENVIRONMENT: 'development',
				THIRD_PARTY_APPS: {
					fetch: bindingFetchMock,
				},
			} as any
		)

		expect(res.status).toBe(200)
		expect(bindingFetchMock).toHaveBeenCalledTimes(1)
		expect(new URL(bindingFetchMock.mock.calls[0]?.[0].url ?? '').pathname).toBe(
			'/.well-known/oauth-authorization-server'
		)
	})

	it('forwards oauth token requests to the third-party apps binding in development', async () => {
		const app = createApp()
		const res = await app.request(
			'http://127.0.0.1:8787/oauth/token',
			{},
			{
				ENVIRONMENT: 'development',
				THIRD_PARTY_APPS: {
					fetch: bindingFetchMock,
				},
			} as any
		)

		expect(res.status).toBe(200)
		expect(bindingFetchMock).toHaveBeenCalledTimes(1)
		expect(new URL(bindingFetchMock.mock.calls[0]?.[0].url ?? '').pathname).toBe('/oauth/token')
	})

	it('returns not found outside development', async () => {
		const app = createApp()
		const res = await app.request(
			'http://pleaseignore.app/.well-known/oauth-authorization-server',
			{},
			{
				ENVIRONMENT: 'production',
			} as any
		)

		expect(res.status).toBe(404)
	})
})
