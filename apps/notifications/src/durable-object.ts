import { DurableObject } from 'cloudflare:workers'

import { eq } from '@repo/db-utils'

import { createDb } from './db'
import { notificationLog } from './db/schema'

import type {
	ClientMessage,
	ConnectionMetadata,
	Notification,
	Notifications,
	ServerMessage,
} from '@repo/notifications'
import type { Env } from './context'

/**
 * Notifications Durable Object
 *
 * Manages WebSocket connections for real-time notifications.
 * Uses Cloudflare's WebSocket Hibernation API for efficient connection management.
 *
 * Features:
 * - Multiple connections per user (multi-tab/device support)
 * - Acknowledgment tracking with retry logic
 * - Automatic cleanup of stale connections
 * - Audit logging of all sent notifications
 */
export class NotificationsDO extends DurableObject<Env> implements Notifications {
	private db: ReturnType<typeof createDb>

	// Storage keys
	private static readonly CONNECTIONS_KEY = 'connections'
	private static readonly PENDING_ACKS_KEY = 'pending_acks'

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
	}

	/**
	 * Upgrade HTTP request to WebSocket connection
	 */
	async connect(request: Request, userId: string): Promise<Response> {
		// Validate WebSocket upgrade request
		const upgradeHeader = request.headers.get('Upgrade')
		if (upgradeHeader !== 'websocket') {
			return new Response('Expected WebSocket upgrade', { status: 426 })
		}

		// Create WebSocket pair
		const webSocketPair = new WebSocketPair()
		const [client, server] = Object.values(webSocketPair)

		// Accept the WebSocket connection using Hibernation API
		this.ctx.acceptWebSocket(server)

		// Store connection metadata
		const metadata: ConnectionMetadata = {
			connectedAt: Date.now(),
			userAgent: request.headers.get('User-Agent') || undefined,
		}

		// Tag the WebSocket with user ID and metadata
		server.serializeAttachment({
			userId,
			metadata,
		})

		// Return the client WebSocket to the caller
		return new Response(null, {
			status: 101,
			webSocket: client,
		})
	}

	/**
	 * Publish a notification to a specific user
	 */
	async publishNotification(
		userId: string,
		notification: Omit<Notification, 'id' | 'timestamp'>
	): Promise<void> {
		// Generate unique notification ID
		const id = crypto.randomUUID()
		const timestamp = Date.now()

		const fullNotification: Notification = {
			...notification,
			id,
			timestamp,
		} as Notification

		// Log the notification to database for audit trail
		await this.logNotification(userId, fullNotification)

		// Get all WebSocket connections for this user
		const connections = this.ctx.getWebSockets()
		const userConnections = connections.filter((ws) => {
			const attachment = ws.deserializeAttachment()
			return attachment?.userId === userId
		})

		// Send to all connected clients
		const message: ServerMessage = fullNotification
		const messageStr = JSON.stringify(message)

		for (const ws of userConnections) {
			try {
				ws.send(messageStr)

				// If notification requires acknowledgment, track it
				if (notification.requiresAck) {
					await this.trackPendingAck(userId, id)
				}
			} catch (error) {
				console.error(`Failed to send notification to WebSocket:`, error)
			}
		}
	}

	/**
	 * Broadcast a notification to multiple users
	 */
	async broadcastNotification(
		userIds: string[],
		notification: Omit<Notification, 'id' | 'timestamp'>
	): Promise<void> {
		// Send to each user individually (each gets unique notification ID)
		await Promise.all(userIds.map((userId) => this.publishNotification(userId, notification)))
	}

	/**
	 * Get connection count for a user
	 */
	async getConnectionCount(userId: string): Promise<number> {
		const connections = this.ctx.getWebSockets()
		return connections.filter((ws) => {
			const attachment = ws.deserializeAttachment()
			return attachment?.userId === userId
		}).length
	}

	/**
	 * WebSocket message handler (Hibernation API)
	 * Called when a message is received from a client
	 */
	async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
		try {
			const attachment = ws.deserializeAttachment()
			if (!attachment?.userId) {
				ws.close(1008, 'Missing user ID')
				return
			}

			// Parse message
			const data = typeof message === 'string' ? message : new TextDecoder().decode(message)
			const clientMessage: ClientMessage = JSON.parse(data)

			if (clientMessage.type === 'ping') {
				// Update last ping time
				attachment.metadata.lastPingAt = Date.now()
				ws.serializeAttachment(attachment)

				// Send pong response
				const response: ServerMessage = { type: 'pong' }
				ws.send(JSON.stringify(response))
			} else if (clientMessage.type === 'ack') {
				// Handle acknowledgment
				await this.handleAcknowledgment(attachment.userId, clientMessage.notificationId)
			}
		} catch (error) {
			console.error('Error handling WebSocket message:', error)
			const errorResponse: ServerMessage = {
				type: 'error',
				message: 'Failed to process message',
			}
			ws.send(JSON.stringify(errorResponse))
		}
	}

	/**
	 * WebSocket close handler (Hibernation API)
	 * Called when a WebSocket connection is closed
	 */
	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
		wasClean: boolean
	): Promise<void> {
		const attachment = ws.deserializeAttachment()
		console.log(`WebSocket closed for user ${attachment?.userId}:`, { code, reason, wasClean })

		// Connection is automatically removed from getWebSockets() after this handler
		// No manual cleanup needed
	}

	/**
	 * WebSocket error handler (Hibernation API)
	 * Called when a WebSocket error occurs
	 */
	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		const attachment = ws.deserializeAttachment()
		console.error(`WebSocket error for user ${attachment?.userId}:`, error)
	}

	/**
	 * Log notification to database for audit trail
	 */
	private async logNotification(userId: string, notification: Notification): Promise<void> {
		try {
			await this.db.insert(notificationLog).values({
				id: notification.id,
				userId,
				eventType: notification.type,
				payload: JSON.stringify(notification),
				sentAt: new Date(notification.timestamp),
				acknowledged: false,
				retryCount: 0,
			})
		} catch (error) {
			// Log but don't fail notification delivery if database is unavailable
			console.error('Failed to log notification:', error)
		}
	}

	/**
	 * Track pending acknowledgment
	 */
	private async trackPendingAck(userId: string, notificationId: string): Promise<void> {
		const pendingAcks =
			(await this.state.storage.get<Record<string, number>>(NotificationsDO.PENDING_ACKS_KEY)) || {}

		pendingAcks[notificationId] = Date.now()
		await this.state.storage.put(NotificationsDO.PENDING_ACKS_KEY, pendingAcks)

		// Schedule retry check after 5 seconds
		await this.state.storage.setAlarm(Date.now() + 5000)
	}

	/**
	 * Handle acknowledgment from client
	 */
	private async handleAcknowledgment(userId: string, notificationId: string): Promise<void> {
		// Remove from pending acks
		const pendingAcks =
			(await this.state.storage.get<Record<string, number>>(NotificationsDO.PENDING_ACKS_KEY)) || {}

		if (pendingAcks[notificationId]) {
			delete pendingAcks[notificationId]
			await this.state.storage.put(NotificationsDO.PENDING_ACKS_KEY, pendingAcks)
		}

		// Update database log
		try {
			await this.db
				.update(notificationLog)
				.set({
					acknowledged: true,
					acknowledgedAt: new Date(),
				})
				.where(eq(notificationLog.id, notificationId))
		} catch (error) {
			console.error('Failed to update acknowledgment in database:', error)
		}
	}

	/**
	 * Alarm handler for retry logic
	 */
	async alarm(): Promise<void> {
		const pendingAcks =
			(await this.state.storage.get<Record<string, number>>(NotificationsDO.PENDING_ACKS_KEY)) || {}

		const now = Date.now()
		const retryThreshold = 5000 // 5 seconds
		const maxRetries = 3

		for (const [notificationId, sentAt] of Object.entries(pendingAcks)) {
			if (now - sentAt > retryThreshold) {
				// Get retry count from database
				const logEntry = await this.db.query.notificationLog.findFirst({
					where: (t, { eq }) => eq(t.id, notificationId),
				})

				if (!logEntry) {
					// Notification not found, remove from pending
					delete pendingAcks[notificationId]
					continue
				}

				if (logEntry.retryCount >= maxRetries) {
					// Max retries reached, give up
					console.warn(`Max retries reached for notification ${notificationId}`)
					delete pendingAcks[notificationId]
					continue
				}

				// Retry sending the notification
				try {
					const notification: Notification = JSON.parse(logEntry.payload)
					const message = JSON.stringify(notification)

					const connections = this.ctx.getWebSockets()
					const userConnections = connections.filter((ws) => {
						const attachment = ws.deserializeAttachment()
						return attachment?.userId === logEntry.userId
					})

					for (const ws of userConnections) {
						ws.send(message)
					}

					// Update retry count
					await this.db
						.update(notificationLog)
						.set({
							retryCount: logEntry.retryCount + 1,
							lastRetryAt: new Date(),
						})
						.where(eq(notificationLog.id, notificationId))

					// Update pending ack timestamp
					pendingAcks[notificationId] = now
				} catch (error) {
					console.error(`Failed to retry notification ${notificationId}:`, error)
					delete pendingAcks[notificationId]
				}
			}
		}

		// Save updated pending acks
		await this.state.storage.put(NotificationsDO.PENDING_ACKS_KEY, pendingAcks)

		// Schedule next alarm if there are still pending acks
		if (Object.keys(pendingAcks).length > 0) {
			await this.state.storage.setAlarm(Date.now() + 5000)
		}
	}
}
