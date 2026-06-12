import { Hono } from 'hono'

import type { App } from '../../context'

const app = new Hono<App>()

function buildProxyRequest(
	request: Request,
	rewrittenPath: string,
	headers: Headers,
	body?: BodyInit,
): Request {
	const targetUrl = new URL(request.url)
	targetUrl.pathname = rewrittenPath

	const method = request.method.toUpperCase()
	return new Request(targetUrl.toString(), {
		method,
		headers,
		body,
	})
}

app.all('*', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const prefix = '/api/admin/structures'
	const targetPath = new URL(c.req.url).pathname.slice(prefix.length) || '/'
	const headers = new Headers(c.req.raw.headers)
	headers.set('x-core-user-id', user.id)
	headers.set('x-core-user-is-admin', String(user.is_admin))
	headers.set('x-core-user-roles', JSON.stringify(user.roles ?? []))
	headers.delete('host')

	const body = c.req.raw.method === 'GET' || c.req.raw.method === 'HEAD' ? undefined : await c.req.arrayBuffer()
	const rewrittenPath =
		targetPath === '/' ? '/admin' : targetPath.startsWith('/admin') ? targetPath : `/admin${targetPath}`
	const request = buildProxyRequest(c.req.raw, rewrittenPath, headers, body)
	return c.env.STRUCTURES.fetch(request)
})

export default app
