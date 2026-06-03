import { DurableObject } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'
import { EsiRequestClient } from '@repo/esi'
import { buildEsiUserKey, EsiRateLimitStore } from '@repo/esi-rate-limit'
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
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from './context'
import type { FreightDb } from './db'

class FreightOpenContractError extends Error {
	constructor(
		message: string,
		public readonly status: number
	) {
		super(message)
		this.name = 'FreightOpenContractError'
	}
}

/**
 * Freight Durable Object
 *
 * Manages freight routes through RPC methods.
 * Uses a singleton pattern with 'default' ID.
 */
export class FreightDO extends DurableObject<Env, {}> implements Freight {
	private db: FreightDb
	private routeService: RouteService
	private readonly esiRateLimits: EsiRateLimitStore
	private readonly esiRequestClient: EsiRequestClient

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)

		// Initialize database client
		this.db = createDb(env.DATABASE_URL)

		// Initialize services
		this.routeService = new RouteService(this.db)
		this.esiRateLimits = new EsiRateLimitStore(env.ESI_RATE_LIMITS)
		this.esiRequestClient = new EsiRequestClient({
			rateLimits: this.esiRateLimits,
			debugLogger: logger,
			compatibilityDate: '2025-09-30',
		})
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
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const accessToken = await tokenStore.getAccessToken(characterId)

		if (!accessToken) {
			return {
				success: false,
				error: 'token_unavailable',
				message: `Could not authorize ${characterName}. Please re-link this character.`,
				characterName,
			}
		}

		try {
			const response = await this.esiRequestClient.request<Response>({
				path: `/ui/openwindow/contract/?contract_id=${contractId}`,
				userKey: buildEsiUserKey(this.env.EVE_SSO_CLIENT_ID, characterId),
				cacheMode: 'no-store',
				method: 'POST',
				accessToken,
				parse: async (esiResponse) => esiResponse,
				buildError: ({ response, body, path }) =>
					new FreightOpenContractError(
						`ESI request failed: ${response.status} ${response.statusText || 'Request Failed'} - ${body || 'Unknown ESI error'} | path=${path}`,
						response.status
					),
			})

			if (response.data.status === 204) {
				return {
					success: true,
					characterName,
				}
			}

			logger.warn('ESI openwindow/contract returned non-204', {
				status: response.data.status,
				contractId,
				characterId,
			})
			return {
				success: false,
				error: 'client_unreachable',
				message: 'Could not reach an online EVE client. Make sure the game is running and logged in on your main character.',
				characterName,
			}
		} catch (error) {
			if (error instanceof Error && error.message.includes('ESI rate limit active')) {
				return {
					success: false,
					error: 'esi_rate_limited',
					message: 'ESI is temporarily rate limited. Please retry shortly.',
					characterName,
				}
			}

			if (error instanceof FreightOpenContractError) {
				if (error.status === 403) {
					return {
						success: false,
						error: 'scope_missing',
						message: `${characterName} has not granted the in-game UI permission. Please re-link this character.`,
						characterName,
					}
				}

				if (error.status === 429) {
					return {
						success: false,
						error: 'esi_rate_limited',
						message: 'ESI is temporarily rate limited. Please retry shortly.',
						characterName,
					}
				}

				return {
					success: false,
					error: 'client_unreachable',
					message: 'Could not reach an online EVE client. Make sure the game is running and logged in on your main character.',
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
				message: 'Could not reach an online EVE client. Make sure the game is running and logged in on your main character.',
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
