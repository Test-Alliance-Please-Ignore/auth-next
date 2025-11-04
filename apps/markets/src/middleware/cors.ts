import type { Context, Next } from 'hono'

import type { App } from '../context'

/**
 * CORS middleware for public API access
 * Allows all origins to access the API (read-only public data)
 */
export async function withCors(c: Context<App>, next: Next) {
	// Handle preflight requests
	if (c.req.method === 'OPTIONS') {
		return c.body(null, 204, {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
			'Access-Control-Max-Age': '86400', // 24 hours
		})
	}

	// Add CORS headers to all responses
	c.header('Access-Control-Allow-Origin', '*')
	c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
	c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

	await next()
}
