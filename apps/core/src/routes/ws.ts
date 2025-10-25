import { Hono } from 'hono'

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

	// Get the NotificationsDO stub for this user
	// Each user gets their own DO instance for isolation
	const notificationsStub = getStub<Notifications>(c.env.NOTIFICATIONS, user.id)

	// Forward the request to the Durable Object for WebSocket upgrade
	// The DO will handle the WebSocket protocol from here
	return notificationsStub.connect(c.req.raw, user.id)
})

export default ws
