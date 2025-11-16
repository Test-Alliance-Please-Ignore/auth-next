import { DurableObject } from 'cloudflare:workers'

import { eq } from '@repo/db-utils'

import { createDb } from './db'
import { notificationLog, userSessions } from './db/schema'

import type {
	ClientMessage,
	ConnectionMetadata,
	Notification,
	Notifications,
	NotificationTransportExecutor,
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
	private transportExecutor: NotificationTransportExecutor | null = null

	// Storage keys
	private static readonly CONNECTIONS_KEY = 'connections'
	private static readonly PENDING_ACKS_KEY = 'pending_acks'

	// Re-validation settings
	private static readonly REVALIDATION_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
	private static readonly REVALIDATION_MESSAGE_COUNT = 10 // Every 10 messages

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
	}

	/**
	 * Get or create transport executor (lazy initialization)
	 */
	private getTransportExecutor(): NotificationTransportExecutor | null {
		if (!this.transportExecutor && this.env.transportExecutor) {
			this.transportExecutor = this.env.transportExecutor
		}
		return this.transportExecutor
	}

	/**
	 * Extract session token from request headers
	 */
	private extractSessionToken(request: Request): string | null {
		// Try Authorization header first (Bearer token)
		const authHeader = request.headers.get('Authorization')
		if (authHeader && authHeader.startsWith('Bearer ')) {
			return authHeader.substring(7)
		}

		// Try Cookie header (session cookie)
		const cookieHeader = request.headers.get('Cookie')
		if (cookieHeader) {
			const cookies = cookieHeader.split(';').map((c) => c.trim())
			const sessionCookie = cookies.find((c) => c.startsWith('session='))
			if (sessionCookie) {
				return sessionCookie.substring(8) // 'session='.length
			}
		}

		// Try X-Session-Token header (passed from core worker)
		const customHeader = request.headers.get('X-Session-Token')
		if (customHeader) {
			return customHeader
		}

		return null
	}

	/**
	 * Validate session token and return userId if valid
	 */
	private async validateSessionToken(sessionToken: string): Promise<string | null> {
		try {
			const session = await this.db.query.userSessions.findFirst({
				where: eq(userSessions.sessionToken, sessionToken),
			})

			if (!session) {
				return null
			}

			// Check if session is expired
			if (session.expiresAt < new Date()) {
				// Delete expired session
				await this.db.delete(userSessions).where(eq(userSessions.id, session.id))
				return null
			}

			// Update last activity timestamp
			await this.db
				.update(userSessions)
				.set({ lastActivityAt: new Date() })
				.where(eq(userSessions.id, session.id))

			return session.userId
		} catch (error) {
			console.error('Error validating session token:', error)
			return null
		}
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

		// Extract and validate session token
		const sessionToken = this.extractSessionToken(request)
		if (!sessionToken) {
			return new Response('Missing session token', { status: 401 })
		}

		// Validate session token
		const validatedUserId = await this.validateSessionToken(sessionToken)
		if (!validatedUserId) {
			return new Response('Invalid or expired session', { status: 401 })
		}

		// Ensure validated userId matches the userId parameter
		if (validatedUserId !== userId) {
			return new Response('User ID mismatch', { status: 403 })
		}

		// Create WebSocket pair
		const webSocketPair = new WebSocketPair()
		const [client, server] = Object.values(webSocketPair)

		// Accept the WebSocket connection using Hibernation API
		this.ctx.acceptWebSocket(server)

		// Store connection metadata with session token for re-validation
		const metadata: ConnectionMetadata = {
			connectedAt: Date.now(),
			userAgent: request.headers.get('User-Agent') || undefined,
		}

		// Tag the WebSocket with user ID, session token, and metadata
		server.serializeAttachment({
			userId: validatedUserId,
			sessionToken,
			metadata,
			messageCount: 0,
			lastValidatedAt: Date.now(),
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

		// Send to all connected clients (WebSocket transport)
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

		// Execute other transports (Discord, email, etc.) in parallel
		const executor = this.getTransportExecutor()
		if (executor) {
			try {
				const results = await executor.send(userId, fullNotification)
				// Log transport results but don't fail notification if transports fail
				for (const result of results) {
					if (!result.result.success) {
						console.error(
							`Transport '${result.transportType}' failed for notification ${id}:`,
							result.result.error
						)
					}
				}
			} catch (error) {
				// Log but don't fail notification delivery
				console.error(`Failed to execute transports for notification ${id}:`, error)
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
			const attachment = ws.deserializeAttachment() as {
				userId?: string
				sessionToken?: string
				metadata?: ConnectionMetadata
				messageCount?: number
				lastValidatedAt?: number
			}

			if (!attachment?.userId) {
				ws.close(1008, 'Missing user ID')
				return
			}

			// Increment message count
			attachment.messageCount = (attachment.messageCount || 0) + 1

			// Periodically re-validate session (every N messages or every N minutes)
			const now = Date.now()
			const shouldRevalidate =
				!attachment.lastValidatedAt ||
				attachment.messageCount % NotificationsDO.REVALIDATION_MESSAGE_COUNT === 0 ||
				now - attachment.lastValidatedAt > NotificationsDO.REVALIDATION_INTERVAL_MS

			if (shouldRevalidate && attachment.sessionToken) {
				const validatedUserId = await this.validateSessionToken(attachment.sessionToken)
				if (!validatedUserId || validatedUserId !== attachment.userId) {
					ws.close(1008, 'Session expired or invalid')
					return
				}
				attachment.lastValidatedAt = now
			}

			// Parse message
			const data = typeof message === 'string' ? message : new TextDecoder().decode(message)
			const clientMessage: ClientMessage = JSON.parse(data)

			if (clientMessage.type === 'ping') {
				// Update last ping time
				if (attachment.metadata) {
					attachment.metadata.lastPingAt = Date.now()
				}
				ws.serializeAttachment(attachment)

				// Send pong response
				const response: ServerMessage = { type: 'pong' }
				ws.send(JSON.stringify(response))
			} else if (clientMessage.type === 'ack') {
				// Handle acknowledgment
				await this.handleAcknowledgment(attachment.userId, clientMessage.notificationId)
				ws.serializeAttachment(attachment)
			} else {
				// Update attachment for other message types
				ws.serializeAttachment(attachment)
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
