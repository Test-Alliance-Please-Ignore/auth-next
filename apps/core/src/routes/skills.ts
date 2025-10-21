import { Hono } from 'hono'

import { requireAuth } from '../middleware/session'

import type { App } from '../context'

/**
 * Skills routes
 *
 * Proxies requests to the eve-static-data service
 */
const skills = new Hono<App>()

// Require authentication for all skills endpoints
skills.use('*', requireAuth())

/**
 * GET /skills
 *
 * Proxy to eve-static-data service to get skill metadata
 * Supports filtering by skill IDs via query parameter
 */
skills.get('/', async (c) => {
	const queryParams = c.req.url.split('?')[1] || ''
	const url = `/skills${queryParams ? `?${queryParams}` : ''}`

	const response = await c.env.EVE_STATIC_DATA.fetch(new Request(`http://internal${url}`))

	return new Response(response.body, {
		status: response.status,
		headers: response.headers,
	})
})

/**
 * GET /skills/categories
 *
 * Proxy to get all skill categories
 */
skills.get('/categories', async (c) => {
	const response = await c.env.EVE_STATIC_DATA.fetch(
		new Request('http://internal/skills/categories')
	)

	return new Response(response.body, {
		status: response.status,
		headers: response.headers,
	})
})

/**
 * GET /skills/:skillId
 *
 * Proxy to get a specific skill by ID
 */
skills.get('/:skillId', async (c) => {
	const skillId = c.req.param('skillId')

	const response = await c.env.EVE_STATIC_DATA.fetch(
		new Request(`http://internal/skills/${skillId}`)
	)

	return new Response(response.body, {
		status: response.status,
		headers: response.headers,
	})
})

export default skills
