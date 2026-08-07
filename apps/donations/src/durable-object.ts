import { DurableObject } from 'cloudflare:workers'

import { logger } from '@repo/hono-helpers'

import type { Donations } from '@repo/donations'
import type { Env } from './context'

/**
 * Donations Durable Object
 *
 * This Durable Object uses SQLite storage and implements:
 * - RPC methods for remote calls
 * - WebSocket hibernation API
 * - Alarm handler for scheduled tasks
 * - SQLite storage via sql.exec()
 */
export class DonationsDO extends DurableObject<Env, {}> implements Donations {
	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
	}

	/**
	 * WebSocket message handler (Hibernation API)
	 * Called when a WebSocket message is received
	 */
	async webSocketMessage(_ws: WebSocket, _message: ArrayBuffer | string): Promise<void> {
		// TODO: Implement WebSocket message handling
	}

	/**
	 * WebSocket close handler (Hibernation API)
	 * Called when a WebSocket connection is closed
	 */
	async webSocketClose(
		_ws: WebSocket,
		_code: number,
		_reason: string,
		_wasClean: boolean
	): Promise<void> {
		// TODO: Implement cleanup logic
	}

	/**
	 * WebSocket error handler (Hibernation API)
	 * Called when a WebSocket error occurs
	 */
	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		logger.error('WebSocket error:', error)
	}

	/**
	 * Alarm handler
	 * Called when a scheduled alarm triggers
	 */
	async alarm(): Promise<void> {
		// TODO: Implement alarm logic
	}

	/**
	 * Fetch handler for HTTP requests to the Durable Object
	 */
	async fetch(request: Request): Promise<Response> {
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

		return new Response('Donations Durable Object', { status: 200 })
	}
}
