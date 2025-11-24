import { DurableObject } from 'cloudflare:workers'

import { createDb } from './db'
import { ProviderService } from './services/providers'

import type { Industry } from '@repo/industry'
import type { Env } from './context'

/**
 * Industry Durable Object
 *
 * This Durable Object uses PostgreSQL storage and implements:
 * - RPC methods for remote calls
 * - WebSocket hibernation API
 * - Alarm handler for scheduled tasks
 * - PostgreSQL storage via Drizzle ORM
 */
export class IndustryDO extends DurableObject<Env, {}> implements Industry {
	private db: ReturnType<typeof createDb>
	private providerService: ProviderService

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)

		// Initialize database client
		this.db = createDb(env.DATABASE_URL)

		// Initialize services
		this.providerService = new ProviderService({ db: this.db, env })
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

		return new Response('Industry Durable Object', { status: 200 })
	}
}
