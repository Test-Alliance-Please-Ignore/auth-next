import type { Context } from 'hono'

import { getThirdPartyAppsFetchBinding } from '../lib/third-party-apps'
import type { App } from '../context'

export function isOAuthDevProxyPath(pathname: string): boolean {
	return (
		pathname === '/.well-known/oauth-authorization-server' ||
		pathname === '/oauth/token' ||
		pathname.startsWith('/oauth/api/')
	)
}

export async function handleOAuthDevProxyRequest(c: Context<App>) {
	if (c.env.ENVIRONMENT !== 'development') {
		return c.notFound()
	}

	const binding = getThirdPartyAppsFetchBinding(c.env)
	if (!binding) {
		return c.json({ error: 'Third-party apps service binding is not configured' }, 503)
	}

	return binding.fetch(c.req.raw)
}
