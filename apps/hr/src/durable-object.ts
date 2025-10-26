import { DurableObject } from 'cloudflare:workers'

import type { Hr, HrState, HrMessage } from '@repo/hr'

/**
 * Hr Durable Object
 *
 * This Durable Object uses SQLite storage and implements:
 * - RPC methods for remote calls
 * - WebSocket hibernation API
 * - Alarm handler for scheduled tasks
 * - SQLite storage via sql.exec()
 */
export class HrDO extends DurableObject implements Hr {
	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Record<string, unknown>
	) {
		super(state, env)
	}

	/**
	 * Example RPC method
	 * @param message - A message to process
	 * @returns A response message
	 */
	async exampleMethod(message: string): Promise<string> {
		console.log('HrDO.exampleMethod called with:', message)

		// Example: Use SQLite storage
		const counter = await this.incrementCounter()

		return `Received: ${message} (counter: ${counter})`
	}

	/**
	 * Get current state from SQLite storage
	 */
	async getState(): Promise<HrState> {
		// Initialize the table if it doesn't exist
		await this.state.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS state (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			)
		`)

		// Get counter value
		const counterResult = await this.state.storage.sql.exec<{ value: string }>(`
			SELECT value FROM state WHERE key = 'counter'
		`)
		const counter = counterResult.length > 0 ? parseInt(counterResult[0].value, 10) : 0

		// Get last updated timestamp
		const timestampResult = await this.state.storage.sql.exec<{ value: string }>(`
			SELECT value FROM state WHERE key = 'lastUpdated'
		`)
		const lastUpdated =
			timestampResult.length > 0 ? parseInt(timestampResult[0].value, 10) : Date.now()

		return {
			counter,
			lastUpdated,
		}
	}

	/**
	 * Increment counter in SQLite storage
	 */
	async incrementCounter(): Promise<number> {
		// Initialize the table if it doesn't exist
		await this.state.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS state (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			)
		`)

		// Get current counter
		const result = await this.state.storage.sql.exec<{ value: string }>(`
			SELECT value FROM state WHERE key = 'counter'
		`)
		const currentCounter = result.length > 0 ? parseInt(result[0].value, 10) : 0
		const newCounter = currentCounter + 1

		// Update counter and timestamp
		await this.state.storage.sql.exec(
			`
			INSERT INTO state (key, value) VALUES (?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value
		`,
			'counter',
			newCounter.toString()
		)
		await this.state.storage.sql.exec(
			`
			INSERT INTO state (key, value) VALUES (?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value
		`,
			'lastUpdated',
			Date.now().toString()
		)

		return newCounter
	}

	/**
	 * WebSocket message handler (Hibernation API)
	 * Called when a WebSocket message is received
	 */
	async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
		try {
			const data: HrMessage =
				typeof message === 'string' ? JSON.parse(message) : JSON.parse(new TextDecoder().decode(message))

			console.log('WebSocket message received:', data)

			switch (data.type) {
				case 'ping':
					ws.send(JSON.stringify({ type: 'pong', payload: Date.now() }))
					break

				case 'subscribe':
					// Handle subscription logic
					ws.send(JSON.stringify({ type: 'subscribed' }))
					break

				case 'unsubscribe':
					// Handle unsubscribe logic
					ws.send(JSON.stringify({ type: 'unsubscribed' }))
					break

				case 'update':
					// Handle update logic
					const counter = await this.incrementCounter()
					ws.send(JSON.stringify({ type: 'updated', payload: { counter } }))
					break

				default:
					ws.send(JSON.stringify({ type: 'error', payload: 'Unknown message type' }))
			}
		} catch (error) {
			console.error('Error processing WebSocket message:', error)
			ws.send(JSON.stringify({ type: 'error', payload: 'Invalid message format' }))
		}
	}

	/**
	 * WebSocket close handler (Hibernation API)
	 * Called when a WebSocket connection is closed
	 */
	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
		console.log('WebSocket closed:', { code, reason, wasClean })
		// Cleanup logic here
	}

	/**
	 * WebSocket error handler (Hibernation API)
	 * Called when a WebSocket error occurs
	 */
	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		console.error('WebSocket error:', error)
	}

	/**
	 * Alarm handler
	 * Called when a scheduled alarm triggers
	 */
	async alarm(): Promise<void> {
		console.log('HrDO alarm triggered at:', new Date().toISOString())

		// Example: Perform periodic cleanup or maintenance
		const state = await this.getState()
		console.log('Current state:', state)

		// Schedule next alarm (optional)
		// await this.state.storage.setAlarm(Date.now() + 60000) // 1 minute
	}

	/**
	 * Fetch handler for HTTP requests to the Durable Object
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		// WebSocket upgrade handling
		if (request.headers.get('Upgrade') === 'websocket') {
			const pair = new WebSocketPair()
			const [client, server] = Object.values(pair)

			// Accept the WebSocket connection using hibernation API
			this.ctx.acceptWebSocket(server)

			return new Response(null, {
				status: 101,
				webSocket: client,
			})
		}

		// HTTP endpoint examples
		if (url.pathname === '/state') {
			const state = await this.getState()
			return Response.json(state)
		}

		if (url.pathname === '/increment') {
			const counter = await this.incrementCounter()
			return Response.json({ counter })
		}

		return new Response('Hr Durable Object', { status: 200 })
	}
}
