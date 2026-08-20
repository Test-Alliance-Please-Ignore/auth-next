import { DurableObject } from 'cloudflare:workers'

import { EsiRequestError, getEsiInstanceForCharacter } from '@repo/esi'
import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import { RouteService } from './services/route.service'

import type {
	CreateFreightRouteInput,
	Freight,
	FreightOpenContractResult,
	FreightRoute,
	FreightRouteStatus,
	UpdateFreightRouteInput,
} from '@repo/freight'
import type { Env } from './context'
import type { FreightDb } from './db'

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

	async updateRoute(
		adminId: string,
		routeId: string,
		data: UpdateFreightRouteInput
	): Promise<FreightRoute> {
		return this.routeService.updateRoute(adminId, routeId, data)
	}

	async activateRoute(adminId: string, routeId: string): Promise<FreightRoute> {
		return this.routeService.activateRoute(adminId, routeId)
	}

	async deactivateRoute(adminId: string, routeId: string): Promise<FreightRoute> {
		return this.routeService.deactivateRoute(adminId, routeId)
	}

	async deleteRoute(adminId: string, routeId: string): Promise<void> {
		return this.routeService.deleteRoute(adminId, routeId)
	}

	async openContractInGame(
		characterId: string,
		characterName: string,
		contractId: number
	): Promise<FreightOpenContractResult> {
		try {
			const response = await getEsiInstanceForCharacter(
				this.env.ESI,
				characterId
			).openContractWindow(characterId, String(contractId))

			if (response.meta.status === 204) {
				return {
					success: true,
					characterName,
				}
			}

			logger.warn('ESI openwindow/contract returned non-204', {
				status: response.meta.status,
				contractId,
				characterId,
			})
			return {
				success: false,
				error: 'client_unreachable',
				message:
					'Could not reach an online EVE client. Make sure the game is running and logged in on your main character.',
				characterName,
			}
		} catch (error) {
			if (error instanceof EsiRequestError && error.context.status === 429) {
				return {
					success: false,
					error: 'esi_rate_limited',
					message: 'ESI is temporarily rate limited. Please retry shortly.',
					characterName,
				}
			}

			if (error instanceof EsiRequestError) {
				if (error.context.status === 401) {
					return {
						success: false,
						error: 'token_unavailable',
						message: `Could not authorize ${characterName}. Please re-link this character.`,
						characterName,
					}
				}

				if (error.context.status === 403) {
					return {
						success: false,
						error: 'scope_missing',
						message: `${characterName} has not granted the in-game UI permission. Please re-link this character.`,
						characterName,
					}
				}

				return {
					success: false,
					error: 'client_unreachable',
					message:
						'Could not reach an online EVE client. Make sure the game is running and logged in on your main character.',
					characterName,
				}
			}

			logger.error('Error opening contract in-game in Freight worker:', {
				error: error instanceof Error ? error.message : String(error),
				contractId,
				characterId,
			})

			return {
				success: false,
				error: 'client_unreachable',
				message:
					'Could not reach an online EVE client. Make sure the game is running and logged in on your main character.',
				characterName,
			}
		}
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
