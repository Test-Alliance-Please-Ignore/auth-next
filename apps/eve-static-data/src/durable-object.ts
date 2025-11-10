import { DurableObject } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'
import {
	EsiGetStructureMarketDataResponseSchema,
	EsiGetStructureResponseSchema,
	EveStructureInstance,
} from '@repo/eve-universe'

import type { EsiResponse, EveTokenStore } from '@repo/eve-token-store'
import type { EveCharacterId, EveStructureId } from '@repo/eve-types'
import type {
	EsiGetStructureMarketDataResponse,
	EsiGetStructureMarketDataResponseObject,
	EsiGetStructureResponse,
	EveStructure,
} from '@repo/eve-universe'
import type { Env } from './context'

/**
 * EveStructure Durable Object
 *
 * This Durable Object provides access to EVE Online structure information
 * and market data via ESI API. Uses eve-token-store for authenticated ESI requests.
 *
 * Instance ID pattern: `{structureId}`
 * Example: `1234567890`
 */
export class EveStructureDO extends DurableObject<Env> implements EveStructure {
	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		env: Env
	) {
		super(state, env)
	}

	/**
	 * Fetch structure information from ESI
	 * Requires authentication via authorized character
	 */
	async fetchStructureInfo(
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
	 * Fetch structure market data from ESI
	 * Requires authentication via authorized character
	 * Note: This endpoint is paginated, so we fetch all pages
	 */
	async fetchStructureMarketData(
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

	/**
	 * Get an instance wrapper for this structure
	 */
	async getInstance(
		structureId: EveStructureId,
		authorizedCharacterId: EveCharacterId
	): Promise<EveStructureInstance> {
		return new EveStructureInstance(this, structureId, authorizedCharacterId)
	}

	/**
	 * Fetch handler for HTTP requests (minimal implementation)
	 */
	override async fetch(_request: Request): Promise<Response> {
		return new Response('EveStructure Durable Object', { status: 200 })
	}
}
