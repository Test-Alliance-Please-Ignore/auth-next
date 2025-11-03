import { DurableObject } from 'cloudflare:workers'

import type {
	CreateFreightRouteInput,
	Freight,
	FreightRoute,
	FreightRouteStatus,
	UpdateFreightRouteInput,
} from '@repo/freight'
import { createDb } from './db'
import type { FreightDb } from './db'
import { RouteService } from './services/route.service'
import type { Env } from './context'

/**
 * Freight Durable Object
 *
 * Manages freight routes through RPC methods.
 * Uses a singleton pattern with 'default' ID.
 */
export class FreightDO extends DurableObject<Env, {}> implements Freight {
	private db: FreightDb
	private routeService: RouteService

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)

		// Initialize database client
		this.db = createDb(env.DATABASE_URL)

		// Initialize services
		this.routeService = new RouteService(this.db)
	}

	/**
	 * RPC Methods - delegate to service layer
	 */

	async createRoute(adminId: string, data: CreateFreightRouteInput): Promise<FreightRoute> {
		return this.routeService.createRoute(adminId, data)
	}

	async getRoute(routeId: string): Promise<FreightRoute | null> {
		return this.routeService.getRoute(routeId)
	}

	async listRoutes(filters?: { status?: FreightRouteStatus }): Promise<FreightRoute[]> {
		return this.routeService.listRoutes(filters)
	}

	async updateRoute(adminId: string, routeId: string, data: UpdateFreightRouteInput): Promise<FreightRoute> {
		return this.routeService.updateRoute(adminId, routeId, data)
	}

	async activateRoute(adminId: string, routeId: string): Promise<FreightRoute> {
		return this.routeService.activateRoute(adminId, routeId)
	}

	async deactivateRoute(adminId: string, routeId: string): Promise<FreightRoute> {
		return this.routeService.deactivateRoute(adminId, routeId)
	}

	/**
	 * Fetch handler for HTTP requests to the Durable Object
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		if (url.pathname === '/health') {
			return Response.json({ status: 'ok' })
		}

		return new Response('Freight Durable Object - Use RPC methods', { status: 200 })
	}
}
