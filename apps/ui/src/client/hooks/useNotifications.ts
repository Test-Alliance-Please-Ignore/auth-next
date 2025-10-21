import { useEffect, useRef, useState, useCallback } from 'react'
import type { Notification, ServerMessage, ClientMessage } from '@repo/notifications'

import { useAuth } from './useAuth'

interface UseNotificationsOptions {
	/**
	 * WebSocket URL for notifications
	 * Defaults to /ws/notifications (relative to current host)
	 */
	url?: string

	/**
	 * Auto-connect on mount if authenticated
	 * @default true
	 */
	autoConnect?: boolean

	/**
	 * Callback when a notification is received
	 */
	onNotification?: (notification: Notification) => void

	/**
	 * Callback when connection state changes
	 */
	onConnectionChange?: (connected: boolean) => void

	/**
	 * Callback when an error occurs
	 */
	onError?: (error: Error) => void
}

interface UseNotificationsReturn {
	/** Current connection status */
	isConnected: boolean

	/** Recent notifications (last 50) */
	notifications: Notification[]

	/** Manually connect to WebSocket */
	connect: () => void

	/** Manually disconnect from WebSocket */
	disconnect: () => void

	/** Clear all notifications */
	clearNotifications: () => void

	/** Mark a notification as read (removes from list) */
	dismissNotification: (notificationId: string) => void
}

/**
 * React hook for WebSocket-based real-time notifications
 *
 * Features:
 * - Auto-connect on authentication
 * - Auto-reconnect with exponential backoff
 * - Automatic acknowledgment of notifications
 * - Ping/pong keepalive
 *
 * @example
 * ```tsx
 * const { notifications, isConnected } = useNotifications({
 *   onNotification: (notif) => {
 *     if (notif.type === 'group.invitation.received') {
 *       toast.success(`Invited to ${notif.data.groupName}!`)
 *     }
 *   }
 * })
 * ```
 */
export function useNotifications(options: UseNotificationsOptions = {}): UseNotificationsReturn {
	const { url = '/ws/notifications', autoConnect = true, onNotification, onConnectionChange, onError } = options

	const { user, isAuthenticated } = useAuth()
	const [isConnected, setIsConnected] = useState(false)
	const [notifications, setNotifications] = useState<Notification[]>([])

	const wsRef = useRef<WebSocket | null>(null)
	const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const reconnectAttempts = useRef(0)
	const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
	const shouldReconnectRef = useRef(true)

	const MAX_RECONNECT_DELAY = 30000 // 30 seconds
	const INITIAL_RECONNECT_DELAY = 1000 // 1 second
	const PING_INTERVAL = 30000 // 30 seconds

	/**
	 * Send a message to the server
	 */
	const sendMessage = useCallback((message: ClientMessage) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify(message))
		}
	}, [])

	/**
	 * Send acknowledgment for a notification
	 */
	const acknowledgeNotification = useCallback(
		(notificationId: string) => {
			sendMessage({ type: 'ack', notificationId })
		},
		[sendMessage]
	)

	/**
	 * Handle incoming WebSocket messages
	 */
	const handleMessage = useCallback(
		(event: MessageEvent) => {
			try {
				const message: ServerMessage = JSON.parse(event.data)

				if (message.type === 'pong') {
					// Pong received, connection is alive
					return
				}

				if (message.type === 'error') {
					console.error('WebSocket error from server:', message.message)
					onError?.(new Error(message.message))
					return
				}

				// It's a notification
				const notification = message as Notification

				// Add to notifications list (keep last 50)
				setNotifications((prev) => [notification, ...prev].slice(0, 50))

				// Send acknowledgment if required
				if (notification.requiresAck) {
					acknowledgeNotification(notification.id)
				}

				// Trigger callback
				onNotification?.(notification)
			} catch (error) {
				console.error('Failed to parse WebSocket message:', error)
				onError?.(error instanceof Error ? error : new Error('Failed to parse message'))
			}
		},
		[onNotification, onError, acknowledgeNotification]
	)

	/**
	 * Start ping interval
	 */
	const startPingInterval = useCallback(() => {
		if (pingIntervalRef.current) {
			clearInterval(pingIntervalRef.current)
		}

		pingIntervalRef.current = setInterval(() => {
			sendMessage({ type: 'ping' })
		}, PING_INTERVAL)
	}, [sendMessage])

	/**
	 * Stop ping interval
	 */
	const stopPingInterval = useCallback(() => {
		if (pingIntervalRef.current) {
			clearInterval(pingIntervalRef.current)
			pingIntervalRef.current = null
		}
	}, [])

	/**
	 * Connect to WebSocket
	 */
	const connect = useCallback(() => {
		// Don't connect if already connected or connecting
		if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
			return
		}

		// Don't connect if not authenticated
		if (!isAuthenticated || !user) {
			return
		}

		try {
			// Build WebSocket URL
			const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
			const wsUrl = `${protocol}//${window.location.host}${url}?userId=${user.id}`

			const ws = new WebSocket(wsUrl)
			wsRef.current = ws

			ws.addEventListener('open', () => {
				console.log('WebSocket connected')
				setIsConnected(true)
				reconnectAttempts.current = 0
				onConnectionChange?.(true)
				startPingInterval()
			})

			ws.addEventListener('message', handleMessage)

			ws.addEventListener('close', (event) => {
				console.log('WebSocket closed:', event.code, event.reason)
				setIsConnected(false)
				onConnectionChange?.(false)
				stopPingInterval()

				// Auto-reconnect with exponential backoff if we should reconnect
				if (shouldReconnectRef.current && isAuthenticated) {
					const delay = Math.min(
						INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts.current),
						MAX_RECONNECT_DELAY
					)
					reconnectAttempts.current++

					console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`)

					reconnectTimeoutRef.current = setTimeout(() => {
						connect()
					}, delay)
				}
			})

			ws.addEventListener('error', (event) => {
				console.error('WebSocket error:', event)
				onError?.(new Error('WebSocket connection error'))
			})
		} catch (error) {
			console.error('Failed to create WebSocket:', error)
			onError?.(error instanceof Error ? error : new Error('Failed to create WebSocket'))
		}
	}, [isAuthenticated, user, url, handleMessage, onConnectionChange, onError, startPingInterval, stopPingInterval])

	/**
	 * Disconnect from WebSocket
	 */
	const disconnect = useCallback(() => {
		shouldReconnectRef.current = false

		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current)
			reconnectTimeoutRef.current = null
		}

		stopPingInterval()

		if (wsRef.current) {
			wsRef.current.close(1000, 'Client disconnect')
			wsRef.current = null
		}

		setIsConnected(false)
		onConnectionChange?.(false)
	}, [stopPingInterval, onConnectionChange])

	/**
	 * Clear all notifications
	 */
	const clearNotifications = useCallback(() => {
		setNotifications([])
	}, [])

	/**
	 * Dismiss a specific notification
	 */
	const dismissNotification = useCallback((notificationId: string) => {
		setNotifications((prev) => prev.filter((n) => n.id !== notificationId))
	}, [])

	// Auto-connect on mount if authenticated and autoConnect is enabled
	useEffect(() => {
		if (autoConnect && isAuthenticated && user) {
			shouldReconnectRef.current = true
			connect()
		}

		return () => {
			disconnect()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [autoConnect, isAuthenticated, user?.id])

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			shouldReconnectRef.current = false
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current)
			}
			stopPingInterval()
		}
	}, [stopPingInterval])

	return {
		isConnected,
		notifications,
		connect,
		disconnect,
		clearNotifications,
		dismissNotification,
	}
}
