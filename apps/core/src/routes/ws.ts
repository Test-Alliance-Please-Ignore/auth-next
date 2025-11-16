import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'

import { getStub } from '@repo/do-utils'

import type { Notifications } from '@repo/notifications'
import type { App } from '../context'

const ws = new Hono<App>()

/**
 * WebSocket upgrade endpoint for real-time notifications
 *
 * Requires authentication (session middleware runs before this route)
 * Upgrades HTTP connection to WebSocket and forwards to NotificationsDO
 *
 * @route GET /api/ws/notifications
 */
ws.get('/notifications', async (c) => {
	// Ensure user is authenticated
	const user = c.var.user
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	// Extract session token from request (Authorization header or cookie)
	// This matches the session middleware logic
	const authHeader = c.req.header('Authorization')
	const cookieToken = getCookie(c, 'session')

	let sessionToken: string | undefined

	if (authHeader && authHeader.startsWith('Bearer ')) {
		sessionToken = authHeader.substring(7)
	} else if (cookieToken) {
		sessionToken = cookieToken
	}

	// Create a new request with session token in header for DO validation
	const originalRequest = c.req.raw
	const headers = new Headers(originalRequest.headers)

	// Pass session token via custom header if available
	if (sessionToken) {
		headers.set('X-Session-Token', sessionToken)
	}

	const requestWithToken = new Request(originalRequest.url, {
		method: originalRequest.method,
		headers,
		body: originalRequest.body,
	})

	// Get the NotificationsDO stub for this user
	// Each user gets their own DO instance for isolation
	using notificationsStub = getStub<Notifications>(c.env.NOTIFICATIONS, user.id)

	// Forward the request to the Durable Object for WebSocket upgrade
	// The DO will handle the WebSocket protocol from here
	return notificationsStub.connect(requestWithToken, user.id)
})

export default ws
