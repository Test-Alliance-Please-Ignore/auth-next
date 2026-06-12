import type { MiddlewareHandler } from 'hono'

import type { App, SessionUser } from '../context'

function parseRolesHeader(value: string | null | undefined): string[] {
	if (!value) return []

	try {
		const parsed = JSON.parse(value)
		if (!Array.isArray(parsed)) return []
		return parsed.filter((item): item is string => typeof item === 'string')
	} catch {
		return []
	}
}

export const proxyAuthMiddleware = (): MiddlewareHandler<App> => {
	return async (c, next) => {
		const userId = c.req.header('x-core-user-id')
		if (!userId) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const user: SessionUser = {
			id: userId,
			is_admin: c.req.header('x-core-user-is-admin') === 'true',
			roles: parseRolesHeader(c.req.header('x-core-user-roles')),
		}

		c.set('user', user)
		await next()
	}
}

export const requireProxyAdmin = (): MiddlewareHandler<App> => {
	return async (c, next) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}
		if (!user.is_admin) {
			return c.json({ error: 'Forbidden' }, 403)
		}
		return next()
	}
}
