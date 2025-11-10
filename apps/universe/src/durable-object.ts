import { DurableObject } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'
import {
	EsiGetStructureMarketDataResponseSchema,
	EsiGetStructureResponseSchema,
} from '@repo/universe'

import type {
	EsiGetStructureMarketDataResponse,
	EsiGetStructureMarketDataResponseObject,
	EsiGetStructureResponse,
	EveCharacterId,
	EveStructureId,
	Universe,
} from '@repo/universe'
import type { EsiResponse, EveTokenStore } from '@repo/eve-token-store'
import type { Env } from './context'

/**
 * Universe Durable Object
 *
 * This Durable Object uses SQLite storage and implements:
 * - RPC methods for remote calls
 * - WebSocket hibernation API
 * - Alarm handler for scheduled tasks
 * - SQLite storage via sql.exec()
 */
export class UniverseDO extends DurableObject<Env, {}> implements Universe {
	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
	}

	// ========================================================================
	// STRUCTURE METHODS
	// ========================================================================

	/**
	 * Get structure information from ESI
	 * Requires authentication via authorized character
	 * @param structureId - The structure ID
	 * @param authorizedCharacterId - Character ID with access to the structure
	 * @returns Structure info or null if not found/no access
	 */
	async getStructureInfo(
		structureId: EveStructureId,
		authorizedCharacterId: EveCharacterId
	): Promise<EsiGetStructureResponse | null> {
		try {
			using tokenStoreStub = getStub<EveTokenStore>(
				this.env.EVE_TOKEN_STORE,
				structureId ? String(structureId) : 'default'
			)
			const response: EsiResponse<EsiGetStructureResponse> = await tokenStoreStub.fetchEsi(
				`/universe/structures/${String(structureId)}`,
				String(authorizedCharacterId)
			)

			// Validate the response using the schema
			const validatedData = EsiGetStructureResponseSchema.parse(response.data)

			return validatedData
		} catch (error) {
			// If the structure doesn't exist, the character doesn't have access, or token is invalid, return null
			console.error(
				`Failed to fetch structure info for structure ${structureId} with character ${authorizedCharacterId}:`,
				error
			)

			// Return null for 404 or 403 errors (structure not found or no access)
			if (error instanceof Error) {
				const errorMessage = error.message.toLowerCase()
				if (errorMessage.includes('404') || errorMessage.includes('403')) {
					return null
				}
			}

			// Re-throw other errors
			throw error
		}
	}

	/**
	 * Get structure market data from ESI
	 * Requires authentication via authorized character
	 * Note: This endpoint is paginated, so we fetch all pages
	 * @param structureId - The structure ID
	 * @param authorizedCharacterId - Character ID with access to the structure
	 * @returns Market orders or null if not found/no access
	 */
	async getStructureMarketData(
		structureId: EveStructureId,
		authorizedCharacterId: EveCharacterId
	): Promise<EsiGetStructureMarketDataResponse | null> {
		try {
			using tokenStoreStub = getStub<EveTokenStore>(
				this.env.EVE_TOKEN_STORE,
				structureId ? String(structureId) : 'default'
			)
			// fetchEsiAllPages expects the element type, not the array type
			const result = await tokenStoreStub.fetchEsiAllPages<EsiGetStructureMarketDataResponseObject>(
				`/markets/structures/${String(structureId)}`,
				String(authorizedCharacterId)
			)

			// Validate the combined data using the schema (array of orders)
			const validatedData = EsiGetStructureMarketDataResponseSchema.parse(result.data)

			return validatedData
		} catch (error) {
			// If the structure doesn't exist, the character doesn't have access, or token is invalid, return null
			console.error(
				`Failed to fetch structure market data for structure ${structureId} with character ${authorizedCharacterId}:`,
				error
			)

			// Return null for 404 or 403 errors (structure not found or no access)
			if (error instanceof Error) {
				const errorMessage = error.message.toLowerCase()
				if (errorMessage.includes('404') || errorMessage.includes('403')) {
					return null
				}
			}

			// Re-throw other errors
			throw error
		}
	}

	// ========================================================================
	// WEBSOCKET HANDLERS
	// ========================================================================

	/**
	 * WebSocket message handler (Hibernation API)
	 * Called when a WebSocket message is received
	 */
	async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
		// TODO: Implement WebSocket message handling
	}

	/**
	 * WebSocket close handler (Hibernation API)
	 * Called when a WebSocket connection is closed
	 */
	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
		// TODO: Implement cleanup logic
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
		// TODO: Implement alarm logic
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

		return new Response('Universe Durable Object', { status: 200 })
	}
}
