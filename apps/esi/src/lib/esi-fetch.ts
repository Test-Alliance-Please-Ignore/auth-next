/**
 * ESI Fetch Service
 *
 * Contains all ESI fetching logic extracted from the Durable Object.
 * These functions are pure business logic that can be called from workflows or DO methods.
 *
 * This separation allows:
 * - Workflows to orchestrate fetching without coupling to DO
 * - DO to focus on data storage operations
 * - Easy testing of fetch logic
 * - Reusability across different contexts
 */

import { getStub } from '@repo/do-utils'
import { EveCorporationData } from '@repo/eve-corporation-data'
import { logger } from '@repo/hono-helpers'

import { EsiCache } from './cache'

import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../context'
import type { EsiResponse } from './types'

// ========================================================================
// PUBLIC DATA FETCHING
// ========================================================================
export class EsiFetcher {
	private characterId: string | null = null
	private cache: EsiCache

	constructor(
		private state: DurableObjectState,
		private env: Env
	) {
		this.cache = new EsiCache(this.state)
	}

	async clearAuthentication(): Promise<void> {
		this.characterId = null
	}

	async authenticateWithCorporation(corporationId: string): Promise<void> {
		logger.info(`[EsiFetcher] Authenticating with corporation: ${corporationId}`)

		const corporationData = getStub<EveCorporationData>(
			this.env.EVE_CORPORATION_DATA,
			corporationId
		)

		logger.info(`[EsiFetcher] Getting load-balanced director for corporation: ${corporationId}`)
		const directorId = await corporationData.getLoadBalancedDirector(corporationId)
		logger.info(`[EsiFetcher] Load-balanced director: ${directorId}`)

		if (!directorId) {
			throw new Error('No director found for corporation')
		}
		await this.authenticateWithCharacter(directorId)
	}

	async authenticateWithCharacter(characterId: string): Promise<void> {
		logger.info(`[EsiFetcher] Authenticating with character: ${characterId}`)
		if (typeof characterId !== 'string') {
			throw new Error('Character ID must be a string')
		}
		if (!characterId) {
			throw new Error('Character ID is required')
		}
		this.characterId = characterId
	}

	async fetchBearerToken(): Promise<string> {
		if (!this.characterId) {
			throw new Error('No character ID authenticated')
		}
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const token = await tokenStore.getAccessToken(this.characterId)
		if (!token) {
			throw new Error('No token found for character')
		}
		return `Bearer ${token}`
	}

	async _fetchEsi<T>(path: string): Promise<EsiResponse<T>> {
		if (!this.characterId) {
			throw new Error('No character ID authenticated for _fetchEsi')
		}
		const cachedResponse = await this.cache.getCachedResponse<T>(this.characterId, path)
		if (cachedResponse) {
			logger
				.withTags({ characterId: this.characterId, path, operation: 'fetchEsi' })
				.info(`[EsiFetcher] Cache hit for ${path}`)
			return cachedResponse
		}

		logger
			.withTags({ characterId: this.characterId, path, operation: 'fetchEsi' })
			.info(`[EsiFetcher] Cache miss for ${path}`)

		const token = await this.fetchBearerToken()
		const response = await fetch(`https://esi.evetech.net${path}`, {
			headers: {
				Authorization: token,
				'X-Compatibility-Date': '2025-09-30',
				Accept: 'application/json',
			},
		})

		if (!response.ok) {
			throw new Error(`Failed to fetch ESI: ${response.status} ${response.statusText}`)
		}

		const data = (await response.json()) as T
		const expiresAt = new Date(response.headers.get('Expires') || '')
		const etag = response.headers.get('ETag')
		const pages = response.headers.get('X-Pages')
			? parseInt(response.headers.get('X-Pages') || '0')
			: null
		const page = response.headers.get('X-Page')
			? parseInt(response.headers.get('X-Page') || '0')
			: null
		const esiResponse = { data, expiresAt, etag, pages, page }
		await this.cache.setCachedResponse<T>(this.characterId, path, esiResponse)

		logger
			.withTags({ characterId: this.characterId, path, operation: 'fetchEsi' })
			.info(`[EsiFetcher] Set cached response for ${path}`)

		return esiResponse
	}

	async fetchEsi<T>(
		basePath: string,
		options?: { maxConcurrent?: number }
	): Promise<{
		data: T[]
		pages: number
		responses: EsiResponse<T[]>[]
	}> {
		const maxConcurrent = options?.maxConcurrent ?? 5

		// Remove any existing page parameter from basePath
		const cleanPath = basePath.replace(/[?&]page=\d+/, '')
		const separator = cleanPath.includes('?') ? '&' : '?'

		logger
			.withTags({
				basePath: cleanPath,
				characterId: this.characterId,
				operation: 'esi_fetch_all_pages',
			})
			.debug('Starting fetchEsiAllPages', { maxConcurrent })

		// Fetch first page to get total page count
		const firstPagePath = `${cleanPath}${separator}page=1`
		const firstResponse = await this._fetchEsi<T[]>(firstPagePath)

		const totalPages = firstResponse.pages ?? 1
		const responses: EsiResponse<T[]>[] = [firstResponse]

		logger
			.withTags({
				basePath: cleanPath,
				characterId: this.characterId,
				totalPages,
				operation: 'esi_fetch_all_pages',
			})
			.debug('Fetched first page', { totalPages, hasMorePages: totalPages > 1 })

		// If there's only one page, return early
		if (totalPages === 1) {
			return {
				data: firstResponse.data,
				pages: totalPages,
				responses,
			}
		}

		// Fetch remaining pages with concurrency limit
		const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)
		const fetchPage = async (pageNum: number): Promise<EsiResponse<T[]>> => {
			const pagePath = `${cleanPath}${separator}page=${pageNum}`
			return this._fetchEsi<T[]>(pagePath)
		}

		// Fetch with concurrency control
		const remainingResponses: EsiResponse<T[]>[] = []
		for (let i = 0; i < remainingPages.length; i += maxConcurrent) {
			const batch = remainingPages.slice(i, i + maxConcurrent)
			logger
				.withTags({
					basePath: cleanPath,
					characterId: this.characterId,
					operation: 'esi_fetch_all_pages',
				})
				.debug('Fetching batch of pages', {
					batchPages: batch,
					progress: `${i + batch.length}/${remainingPages.length}`,
				})
			const batchResponses = await Promise.all(batch.map(fetchPage))
			remainingResponses.push(...batchResponses)
		}

		responses.push(...remainingResponses)

		// Combine all data from all pages
		const allData: T[] = []
		for (const response of responses) {
			allData.push(...response.data)
		}

		logger
			.withTags({
				basePath: cleanPath,
				characterId: this.characterId,
				operation: 'esi_fetch_all_pages',
			})
			.debug('Completed fetchEsiAllPages', {
				totalPages,
				totalItems: allData.length,
			})

		return {
			data: allData,
			pages: totalPages,
			responses,
		}
	}
}
