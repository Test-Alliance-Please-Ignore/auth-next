import { DurableObject } from 'cloudflare:workers'

import { and, eq, gt, lte } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import { eveCharacters, eveTokens } from './db/schema'

import type {
	AuthorizationUrlResponse,
	CallbackResult,
	EsiAlliance,
	EsiCorporation,
	EsiResponse,
	EveTokenResponse,
	EveTokenStore,
	EveVerifyResponse,
	TokenInfo,
} from '@repo/eve-token-store'
import type { Env } from './context'

/**
 * EVE SSO OAuth Endpoints
 */
const EVE_SSO_AUTHORIZE_URL = 'https://login.eveonline.com/v2/oauth/authorize'
const EVE_SSO_TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token'
const EVE_SSO_VERIFY_URL = 'https://login.eveonline.com/oauth/verify'

/**
 * EVE SSO Scopes
 */
const EVE_SCOPES_ALL = [
	'publicData',
	'esi-calendar.respond_calendar_events.v1',
	'esi-calendar.read_calendar_events.v1',
	'esi-location.read_location.v1',
	'esi-location.read_ship_type.v1',
	'esi-mail.read_mail.v1',
	'esi-skills.read_skills.v1',
	'esi-skills.read_skillqueue.v1',
	'esi-wallet.read_character_wallet.v1',
	'esi-wallet.read_corporation_wallet.v1',
	'esi-search.search_structures.v1',
	'esi-clones.read_clones.v1',
	'esi-characters.read_contacts.v1',
	'esi-universe.read_structures.v1',
	'esi-killmails.read_killmails.v1',
	'esi-corporations.read_corporation_membership.v1',
	'esi-assets.read_assets.v1',
	'esi-planets.manage_planets.v1',
	'esi-fleets.read_fleet.v1',
	'esi-fleets.write_fleet.v1',
	'esi-ui.open_window.v1',
	'esi-ui.write_waypoint.v1',
	'esi-characters.write_contacts.v1',
	'esi-fittings.read_fittings.v1',
	'esi-fittings.write_fittings.v1',
	'esi-markets.structure_markets.v1',
	'esi-corporations.read_structures.v1',
	'esi-characters.read_loyalty.v1',
	'esi-characters.read_chat_channels.v1',
	'esi-characters.read_medals.v1',
	'esi-characters.read_standings.v1',
	'esi-characters.read_agents_research.v1',
	'esi-industry.read_character_jobs.v1',
	'esi-markets.read_character_orders.v1',
	'esi-characters.read_blueprints.v1',
	'esi-characters.read_corporation_roles.v1',
	'esi-location.read_online.v1',
	'esi-contracts.read_character_contracts.v1',
	'esi-clones.read_implants.v1',
	'esi-characters.read_fatigue.v1',
	'esi-killmails.read_corporation_killmails.v1',
	'esi-corporations.track_members.v1',
	'esi-wallet.read_corporation_wallets.v1',
	'esi-characters.read_notifications.v1',
	'esi-corporations.read_divisions.v1',
	'esi-corporations.read_contacts.v1',
	'esi-assets.read_corporation_assets.v1',
	'esi-corporations.read_titles.v1',
	'esi-corporations.read_blueprints.v1',
	'esi-contracts.read_corporation_contracts.v1',
	'esi-corporations.read_standings.v1',
	'esi-corporations.read_starbases.v1',
	'esi-industry.read_corporation_jobs.v1',
	'esi-markets.read_corporation_orders.v1',
	'esi-corporations.read_container_logs.v1',
	'esi-industry.read_character_mining.v1',
	'esi-industry.read_corporation_mining.v1',
	'esi-planets.read_customs_offices.v1',
	'esi-corporations.read_facilities.v1',
	'esi-corporations.read_medals.v1',
	'esi-characters.read_titles.v1',
	'esi-alliances.read_contacts.v1',
	'esi-characters.read_fw_stats.v1',
	'esi-corporations.read_fw_stats.v1',
	'esi-corporations.read_projects.v1',
]

/**
 * EveTokenStore Durable Object
 *
 * This Durable Object handles:
 * - EVE Online SSO OAuth flow
 * - Token storage and encryption
 * - Automatic token refresh via alarms
 * - RPC methods for remote calls
 */
export class EveTokenStoreDO extends DurableObject<Env> implements EveTokenStore {
	private db: ReturnType<typeof createDb>

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)

		// Initialize SQLite cache table for ESI responses
		void this.initializeEsiCache()

		// Schedule alarm for token refresh (check every 5 minutes)
		void this.state.storage.setAlarm(Date.now() + 5 * 60 * 1000)
	}

	/**
	 * Initialize SQLite cache tables for ESI responses and entity data
	 */
	private async initializeEsiCache(): Promise<void> {
		// ESI response cache (for raw API responses)
		await this.state.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS esi_cache (
				cache_key TEXT PRIMARY KEY,
				response_data TEXT NOT NULL,
				expires_at INTEGER NOT NULL,
				etag TEXT,
				last_modified TEXT,
				pages INTEGER,
				page INTEGER
			)
		`)

		// Migrate existing tables to add pagination fields if they don't exist
		// SQLite doesn't support "IF NOT EXISTS" for ALTER TABLE, so we check first
		const columns = [
			...this.state.storage.sql.exec(`PRAGMA table_info(esi_cache)`)
		]
		const hasPages = columns.some((col: any) => col.name === 'pages')
		const hasPage = columns.some((col: any) => col.name === 'page')

		if (!hasPages) {
			await this.state.storage.sql.exec(`ALTER TABLE esi_cache ADD COLUMN pages INTEGER`)
		}
		if (!hasPage) {
			await this.state.storage.sql.exec(`ALTER TABLE esi_cache ADD COLUMN page INTEGER`)
		}

		// Entity cache (for corporations, alliances, etc.)
		await this.state.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS entity_cache (
				entity_type TEXT NOT NULL,
				entity_id TEXT NOT NULL,
				entity_name TEXT NOT NULL,
				entity_data TEXT NOT NULL,
				expires_at INTEGER NOT NULL,
				PRIMARY KEY (entity_type, entity_id)
			)
		`)

		// Index for name lookups
		await this.state.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_entity_name
			ON entity_cache(entity_type, entity_name)
		`)
	}

	/**
	 * Start OAuth flow for login (all scopes)
	 */
	async startLoginFlow(state?: string): Promise<AuthorizationUrlResponse> {
		return this.generateAuthUrl(EVE_SCOPES_ALL, state)
	}

	/**
	 * Start OAuth flow for character attachment (all scopes)
	 */
	async startCharacterFlow(state?: string): Promise<AuthorizationUrlResponse> {
		return this.generateAuthUrl(EVE_SCOPES_ALL, state)
	}

	/**
	 * Handle OAuth callback - exchange code for tokens and store them
	 */
	async handleCallback(code: string, state?: string): Promise<CallbackResult> {
		try {
			// Exchange authorization code for tokens
			const tokenResponse = await this.exchangeCodeForToken(code)

			// Verify the token and get character information
			const verifyResponse = await this.verifyToken(tokenResponse.access_token)

			// Parse scopes
			const scopes = verifyResponse.Scopes ? verifyResponse.Scopes.split(' ') : []

			// Calculate token expiration
			const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000)

			// Store character and token in database
			await this.storeToken(
				verifyResponse.CharacterID,
				verifyResponse.CharacterName,
				verifyResponse.CharacterOwnerHash,
				scopes,
				tokenResponse.access_token,
				tokenResponse.refresh_token || null,
				expiresAt
			)

			return {
				success: true,
				characterId: verifyResponse.CharacterID,
				characterInfo: {
					characterId: verifyResponse.CharacterID,
					characterName: verifyResponse.CharacterName,
					characterOwnerHash: verifyResponse.CharacterOwnerHash,
					scopes,
				},
			}
		} catch (error) {
			logger.error(error)
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			}
		}
	}

	/**
	 * Manually refresh a token
	 */
	async refreshToken(characterId: string): Promise<boolean> {
		try {
			// Get character from database
			const character = await this.db.query.eveCharacters.findFirst({
				where: eq(eveCharacters.characterId, characterId),
				with: {
					tokens: true,
				},
			})

			if (!character) {
				logger.withTags({ characterId }).error('Character not found')
				return false
			}

			// Get token record
			const tokenRecord = await this.db.query.eveTokens.findFirst({
				where: eq(eveTokens.characterId, character.id),
			})

			if (!tokenRecord || !tokenRecord.refreshToken) {
				logger.error('Token or refresh token not found')
				return false
			}

			// Decrypt refresh token
			const refreshToken = await this.decrypt(tokenRecord.refreshToken)

			// Refresh the token
			const newTokenResponse = await this.refreshAccessToken(refreshToken)

			// Calculate new expiration
			const expiresAt = new Date(Date.now() + newTokenResponse.expires_in * 1000)

			// Encrypt new tokens
			const encryptedAccessToken = await this.encrypt(newTokenResponse.access_token)
			const encryptedRefreshToken = newTokenResponse.refresh_token
				? await this.encrypt(newTokenResponse.refresh_token)
				: tokenRecord.refreshToken

			// Update token in database
			await this.db
				.update(eveTokens)
				.set({
					accessToken: encryptedAccessToken,
					refreshToken: encryptedRefreshToken,
					expiresAt,
					updatedAt: new Date(),
				})
				.where(eq(eveTokens.id, tokenRecord.id))

			return true
		} catch (error) {
			logger.error(error)
			return false
		}
	}

	/**
	 * Get token information (without actual token values)
	 */
	async getTokenInfo(characterId: string): Promise<TokenInfo | null> {
		const character = await this.db.query.eveCharacters.findFirst({
			where: eq(eveCharacters.characterId, characterId),
		})

		if (!character) {
			return null
		}

		const tokenRecord = await this.db.query.eveTokens.findFirst({
			where: eq(eveTokens.characterId, character.id),
		})

		if (!tokenRecord) {
			return null
		}

		const scopes = JSON.parse(character.scopes) as string[]
		const isExpired = tokenRecord.expiresAt < new Date()

		return {
			characterId: character.characterId,
			characterName: character.characterName,
			characterOwnerHash: character.characterOwnerHash,
			expiresAt: tokenRecord.expiresAt,
			scopes,
			isExpired,
		}
	}

	/**
	 * Get access token for use (decrypted)
	 */
	async getAccessToken(characterId: string): Promise<string | null> {
		const character = await this.db.query.eveCharacters.findFirst({
			where: eq(eveCharacters.characterId, characterId),
		})

		if (!character) {
			return null
		}

		const tokenRecord = await this.db.query.eveTokens.findFirst({
			where: eq(eveTokens.characterId, character.id),
		})

		if (!tokenRecord) {
			return null
		}

		// Check if token is expired
		if (tokenRecord.expiresAt < new Date()) {
			// Try to refresh
			const refreshed = await this.refreshToken(characterId)
			if (!refreshed) {
				return null
			}

			// Fetch updated token
			const updatedToken = await this.db.query.eveTokens.findFirst({
				where: eq(eveTokens.characterId, character.id),
			})

			if (!updatedToken) {
				return null
			}

			return this.decrypt(updatedToken.accessToken)
		}

		return this.decrypt(tokenRecord.accessToken)
	}

	/**
	 * Revoke and delete a token
	 */
	async revokeToken(characterId: string): Promise<boolean> {
		try {
			const character = await this.db.query.eveCharacters.findFirst({
				where: eq(eveCharacters.characterId, characterId),
			})

			if (!character) {
				return false
			}

			// Delete the character (cascade will delete tokens)
			await this.db.delete(eveCharacters).where(eq(eveCharacters.id, character.id))

			return true
		} catch (error) {
			logger.error(error)
			return false
		}
	}

	/**
	 * List all tokens stored in the system
	 */
	async listTokens(): Promise<TokenInfo[]> {
		const characters = await this.db.query.eveCharacters.findMany()

		const tokens: TokenInfo[] = []

		for (const character of characters) {
			const tokenRecord = await this.db.query.eveTokens.findFirst({
				where: eq(eveTokens.characterId, character.id),
			})

			if (tokenRecord) {
				const scopes = JSON.parse(character.scopes) as string[]
				const isExpired = tokenRecord.expiresAt < new Date()

				tokens.push({
					characterId: character.characterId,
					characterName: character.characterName,
					characterOwnerHash: character.characterOwnerHash,
					expiresAt: tokenRecord.expiresAt,
					scopes,
					isExpired,
				})
			}
		}

		return tokens
	}

	/**
	 * Extract page number from URL path
	 */
	private extractPageFromPath(path: string): number | undefined {
		const pageMatch = path.match(/[?&]page=(\d+)/)
		return pageMatch ? parseInt(pageMatch[1], 10) : undefined
	}

	/**
	 * Parse X-Pages header from ESI response
	 */
	private parseXPages(headers: Headers): number | undefined {
		const xPages = headers.get('X-Pages')
		return xPages ? parseInt(xPages, 10) : undefined
	}

	/**
	 * Fetch data from ESI (ESI Gateway)
	 * Automatically handles authentication if token is available for the character
	 * Caches responses according to ESI cache headers
	 */
	async fetchEsi<T>(path: string, characterId: string): Promise<EsiResponse<T>> {
		const cacheKey = `${characterId}:${path}`

		// 1. Check SQLite cache
		const cachedCursor = await this.state.storage.sql.exec<{
			response_data: string
			expires_at: number
			etag: string | null
			pages: number | null
			page: number | null
		}>(`SELECT response_data, expires_at, etag, pages, page FROM esi_cache WHERE cache_key = ?`, cacheKey)

		const cached = [...cachedCursor]

		if (cached.length > 0) {
			const now = Date.now()
			if (cached[0].expires_at > now) {
				// Cache hit
				return {
					data: JSON.parse(cached[0].response_data) as T,
					cached: true,
					expiresAt: new Date(cached[0].expires_at),
					etag: cached[0].etag || undefined,
					pages: cached[0].pages ?? undefined,
					page: cached[0].page ?? undefined,
				}
			}
		}

		// 2. Cache miss - fetch from ESI
		// Try to get token for authenticated request
		const character = await this.db.query.eveCharacters.findFirst({
			where: eq(eveCharacters.characterId, characterId),
		})

		let token: string | undefined
		if (character) {
			const accessToken = await this.getAccessToken(character.characterId)
			token = accessToken || undefined
		}

		// 3. Make ESI request
		const headers: Record<string, string> = {
			'X-Compatibility-Date': '2025-09-30',
			Accept: 'application/json',
		}
		if (token) {
			headers['Authorization'] = `Bearer ${token}`
		}
		if (cached.length > 0 && cached[0].etag) {
			headers['If-None-Match'] = cached[0].etag
		}

		let response: Response
		try {
			response = await fetch(`https://esi.evetech.net${path}`, { headers })
		} catch (error) {
			logger
				.withTags({ characterId, path, operation: 'esi_fetch' })
				.error('ESI fetch failed', error)
			throw new Error(
				`ESI fetch failed for ${path}: ${error instanceof Error ? error.message : String(error)}`
			)
		}

		// Handle 304 Not Modified
		if (response.status === 304 && cached.length > 0) {
			const newExpiresAt = this.parseEsiCacheExpiry(response.headers)
			await this.state.storage.sql.exec(
				`UPDATE esi_cache SET expires_at = ? WHERE cache_key = ?`,
				newExpiresAt.getTime(),
				cacheKey
			)
			return {
				data: JSON.parse(cached[0].response_data) as T,
				cached: true,
				expiresAt: newExpiresAt,
				etag: cached[0].etag || undefined,
				pages: cached[0].pages ?? undefined,
				page: cached[0].page ?? undefined,
			}
		}

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(
				`ESI request failed: ${response.status} ${response.statusText} - ${errorText}`
			)
		}

		// 4. Parse and cache response
		const data = (await response.json()) as T
		const expiresAt = this.parseEsiCacheExpiry(response.headers)
		const etag = response.headers.get('ETag')
		const pages = this.parseXPages(response.headers)
		const page = this.extractPageFromPath(path)

		// Log pagination info if present
		if (pages !== undefined || page !== undefined) {
			logger
				.withTags({ path, characterId, page, pages, operation: 'esi_fetch_paginated' })
				.debug('ESI response with pagination metadata', { page, totalPages: pages })
		}

		await this.state.storage.sql.exec(
			`INSERT OR REPLACE INTO esi_cache (cache_key, response_data, expires_at, etag, pages, page)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			cacheKey,
			JSON.stringify(data),
			expiresAt.getTime(),
			etag,
			pages ?? null,
			page ?? null
		)

		return {
			data,
			cached: false,
			expiresAt,
			etag: etag || undefined,
			pages,
			page,
		}
	}

	/**
	 * Fetch public data from ESI (unauthenticated ESI Gateway)
	 * For public endpoints that don't require authentication
	 * Caches responses according to ESI cache headers
	 */
	async fetchPublicEsi<T>(path: string): Promise<EsiResponse<T>> {
		const cacheKey = `public:${path}`

		// 1. Check SQLite cache
		const cachedCursor = await this.state.storage.sql.exec<{
			response_data: string
			expires_at: number
			etag: string | null
			pages: number | null
			page: number | null
		}>(`SELECT response_data, expires_at, etag, pages, page FROM esi_cache WHERE cache_key = ?`, cacheKey)

		const cached = [...cachedCursor]

		if (cached.length > 0) {
			const now = Date.now()
			if (cached[0].expires_at > now) {
				// Cache hit
				return {
					data: JSON.parse(cached[0].response_data) as T,
					cached: true,
					expiresAt: new Date(cached[0].expires_at),
					etag: cached[0].etag || undefined,
					pages: cached[0].pages ?? undefined,
					page: cached[0].page ?? undefined,
				}
			}
		}

		// 2. Cache miss - fetch from ESI (no authentication)
		const headers: Record<string, string> = {
			'X-Compatibility-Date': '2025-09-30',
			Accept: 'application/json',
		}
		if (cached.length > 0 && cached[0].etag) {
			headers['If-None-Match'] = cached[0].etag
		}

		const response = await fetch(`https://esi.evetech.net${path}`, { headers })

		// Handle 304 Not Modified
		if (response.status === 304 && cached.length > 0) {
			const newExpiresAt = this.parseEsiCacheExpiry(response.headers)
			await this.state.storage.sql.exec(
				`UPDATE esi_cache SET expires_at = ? WHERE cache_key = ?`,
				newExpiresAt.getTime(),
				cacheKey
			)
			return {
				data: JSON.parse(cached[0].response_data) as T,
				cached: true,
				expiresAt: newExpiresAt,
				etag: cached[0].etag || undefined,
				pages: cached[0].pages ?? undefined,
				page: cached[0].page ?? undefined,
			}
		}

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(
				`ESI request failed: ${response.status} ${response.statusText} - ${errorText}`
			)
		}

		// 3. Parse and cache response
		const data = (await response.json()) as T
		const expiresAt = this.parseEsiCacheExpiry(response.headers)
		const etag = response.headers.get('ETag')
		const pages = this.parseXPages(response.headers)
		const page = this.extractPageFromPath(path)

		// Log pagination info if present
		if (pages !== undefined || page !== undefined) {
			logger
				.withTags({ path, page, pages, operation: 'esi_fetch_public_paginated' })
				.debug('Public ESI response with pagination metadata', { page, totalPages: pages })
		}

		await this.state.storage.sql.exec(
			`INSERT OR REPLACE INTO esi_cache (cache_key, response_data, expires_at, etag, pages, page)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			cacheKey,
			JSON.stringify(data),
			expiresAt.getTime(),
			etag,
			pages ?? null,
			page ?? null
		)

		return {
			data,
			cached: false,
			expiresAt,
			etag: etag || undefined,
			pages,
			page,
		}
	}

	/**
	 * Clear ESI cache for a specific path
	 * Useful for forcing fresh data on next request or after errors
	 */
	async clearEsiCache(path: string, characterId?: string): Promise<number> {
		// Build cache key based on whether it's authenticated or public
		const cacheKey = characterId ? `${characterId}:${path}` : `public:${path}`

		logger
			.withTags({ path, characterId, cacheKey, operation: 'clear_esi_cache' })
			.debug('Clearing ESI cache', { cacheKey })

		// Delete all cache entries matching this key (including all pages if paginated)
		// Use LIKE to match all pages: /path?page=1, /path?page=2, etc.
		const baseKey = cacheKey.split('?')[0]
		const result = await this.state.storage.sql.exec(
			`DELETE FROM esi_cache WHERE cache_key LIKE ? OR cache_key = ?`,
			`${baseKey}%`,
			cacheKey
		)

		const deletedCount = result.rowsWritten || 0

		logger
			.withTags({ path, characterId, operation: 'clear_esi_cache' })
			.debug('Cleared ESI cache', { deletedCount, cacheKey })

		return deletedCount
	}

	/**
	 * Fetch all pages from a paginated ESI endpoint (authenticated)
	 * Automatically fetches all pages in parallel and returns combined results
	 */
	async fetchEsiAllPages<T>(
		basePath: string,
		characterId: string,
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
			.withTags({ basePath: cleanPath, characterId, operation: 'esi_fetch_all_pages' })
			.debug('Starting fetchEsiAllPages', { maxConcurrent })

		// Fetch first page to get total page count
		const firstPagePath = `${cleanPath}${separator}page=1`
		const firstResponse = await this.fetchEsi<T[]>(firstPagePath, characterId)

		const totalPages = firstResponse.pages ?? 1
		const responses: EsiResponse<T[]>[] = [firstResponse]

		logger
			.withTags({ basePath: cleanPath, characterId, totalPages, operation: 'esi_fetch_all_pages' })
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
			return this.fetchEsi<T[]>(pagePath, characterId)
		}

		// Fetch with concurrency control
		const remainingResponses: EsiResponse<T[]>[] = []
		for (let i = 0; i < remainingPages.length; i += maxConcurrent) {
			const batch = remainingPages.slice(i, i + maxConcurrent)
			logger
				.withTags({
					basePath: cleanPath,
					characterId,
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
			.withTags({ basePath: cleanPath, characterId, operation: 'esi_fetch_all_pages' })
			.debug('Completed fetchEsiAllPages', {
				totalPages,
				totalItems: allData.length,
				cached: responses.filter((r) => r.cached).length,
			})

		return {
			data: allData,
			pages: totalPages,
			responses,
		}
	}

	/**
	 * Fetch all pages from a paginated public ESI endpoint (unauthenticated)
	 * Automatically fetches all pages in parallel and returns combined results
	 */
	async fetchPublicEsiAllPages<T>(
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
			.withTags({ basePath: cleanPath, operation: 'esi_fetch_all_pages_public' })
			.debug('Starting fetchPublicEsiAllPages', { maxConcurrent })

		// Fetch first page to get total page count
		const firstPagePath = `${cleanPath}${separator}page=1`
		const firstResponse = await this.fetchPublicEsi<T[]>(firstPagePath)

		const totalPages = firstResponse.pages ?? 1
		const responses: EsiResponse<T[]>[] = [firstResponse]

		logger
			.withTags({ basePath: cleanPath, totalPages, operation: 'esi_fetch_all_pages_public' })
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
			return this.fetchPublicEsi<T[]>(pagePath)
		}

		// Fetch with concurrency control
		const remainingResponses: EsiResponse<T[]>[] = []
		for (let i = 0; i < remainingPages.length; i += maxConcurrent) {
			const batch = remainingPages.slice(i, i + maxConcurrent)
			logger
				.withTags({
					basePath: cleanPath,
					operation: 'esi_fetch_all_pages_public',
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
			.withTags({ basePath: cleanPath, operation: 'esi_fetch_all_pages_public' })
			.debug('Completed fetchPublicEsiAllPages', {
				totalPages,
				totalItems: allData.length,
				cached: responses.filter((r) => r.cached).length,
			})

		return {
			data: allData,
			pages: totalPages,
			responses,
		}
	}

	/**
	 * Get corporation information by ID
	 * Checks entity cache first, then fetches from ESI if needed
	 */
	async getCorporationById(corporationId: string): Promise<EsiCorporation | null> {
		const cacheKey = 'corporation'
		const now = Date.now()

		// 1. Check entity cache (non-critical, failures should be treated as cache miss)
		try {
			const cachedCursor = await this.state.storage.sql.exec<{
				entity_data: string
				expires_at: number
			}>(
				`SELECT entity_data, expires_at FROM entity_cache WHERE entity_type = ? AND entity_id = ?`,
				cacheKey,
				corporationId
			)

			const cached = [...cachedCursor]

			if (cached.length > 0 && cached[0].expires_at > now) {
				// Cache hit
				return JSON.parse(cached[0].entity_data) as EsiCorporation
			}
		} catch (error) {
			// Cache read failure - log and continue (treat as cache miss)
			logger
				.withTags({ corporationId, operation: 'cache_read' })
				.warn('Entity cache read failed', error)
		}

		// 2. Fetch from ESI
		try {
			// ESI returns numbers for IDs, but we need strings
			const response = await this.fetchPublicEsi<{
				corporation_id: number
				name: string
				ticker: string
				ceo_id: number
				alliance_id?: number
				description?: string
				member_count: number
				tax_rate: number
				date_founded?: string
				creator_id: number
				home_station_id?: number
				shares?: number
				url?: string
				war_eligible?: boolean
			}>(`/latest/corporations/${corporationId}/`)

			// Convert all numeric IDs to strings
			const corp: EsiCorporation = {
				...response.data,
				corporation_id: String(response.data.corporation_id),
				name: response.data.name,
				ticker: response.data.ticker,
				ceo_id: String(response.data.ceo_id),
				alliance_id: response.data.alliance_id ? String(response.data.alliance_id) : undefined,
				creator_id: String(response.data.creator_id),
				home_station_id: response.data.home_station_id
					? String(response.data.home_station_id)
					: undefined,
			}

			// 3. Store in entity cache (non-critical, failures should not prevent returning data)
			try {
				const expiresAt = Date.now() + 60 * 60 * 1000
				await this.state.storage.sql.exec(
					`INSERT OR REPLACE INTO entity_cache (entity_type, entity_id, entity_name, entity_data, expires_at)
					 VALUES (?, ?, ?, ?, ?)`,
					cacheKey,
					corp.corporation_id,
					corp.name,
					JSON.stringify(corp),
					expiresAt
				)
			} catch (error) {
				// Cache write failure - log but don't fail the request
				logger
					.withTags({ corporationId, operation: 'cache_write' })
					.warn('Entity cache write failed', error)
			}

			return corp
		} catch (error) {
			logger.withTags({ corporationId }).error(error)
			return null
		}
	}

	/**
	 * Get alliance information by ID
	 * Checks entity cache first, then fetches from ESI if needed
	 */
	async getAllianceById(allianceId: string): Promise<EsiAlliance | null> {
		const cacheKey = 'alliance'
		const now = Date.now()

		// 1. Check entity cache (non-critical, failures should be treated as cache miss)
		try {
			const cachedCursor = await this.state.storage.sql.exec<{
				entity_data: string
				expires_at: number
			}>(
				`SELECT entity_data, expires_at FROM entity_cache WHERE entity_type = ? AND entity_id = ?`,
				cacheKey,
				allianceId
			)

			const cached = [...cachedCursor]

			if (cached.length > 0 && cached[0].expires_at > now) {
				// Cache hit
				return JSON.parse(cached[0].entity_data) as EsiAlliance
			}
		} catch (error) {
			// Cache read failure - log and continue (treat as cache miss)
			logger
				.withTags({ allianceId, operation: 'cache_read' })
				.warn('Entity cache read failed', error)
		}

		// 2. Fetch from ESI
		try {
			// ESI returns numbers for IDs, but we need strings
			const response = await this.fetchPublicEsi<{
				alliance_id: number
				name: string
				ticker: string
				executor_corporation_id: number
				creator_corporation_id: number
				creator_id: number
				date_founded: string
				faction_id?: number
			}>(`/latest/alliances/${allianceId}/`)

			// Convert all numeric IDs to strings
			const alliance: EsiAlliance = {
				...response.data,
				alliance_id: String(response.data.alliance_id),
				executor_corporation_id: String(response.data.executor_corporation_id),
				creator_corporation_id: String(response.data.creator_corporation_id),
				creator_id: String(response.data.creator_id),
				faction_id: response.data.faction_id ? String(response.data.faction_id) : undefined,
			}

			// 3. Store in entity cache (non-critical, failures should not prevent returning data)
			try {
				const expiresAt = Date.now() + 60 * 60 * 1000
				await this.state.storage.sql.exec(
					`INSERT OR REPLACE INTO entity_cache (entity_type, entity_id, entity_name, entity_data, expires_at)
					 VALUES (?, ?, ?, ?, ?)`,
					cacheKey,
					alliance.alliance_id,
					alliance.name,
					JSON.stringify(alliance),
					expiresAt
				)
			} catch (error) {
				// Cache write failure - log but don't fail the request
				logger
					.withTags({ allianceId, operation: 'cache_write' })
					.warn('Entity cache write failed', error)
			}

			return alliance
		} catch (error) {
			logger.withTags({ allianceId }).error(error)
			return null
		}
	}

	/**
	 * Get corporation information by name
	 * Uses name resolution and then fetches by ID
	 */
	async getCorporationByName(name: string): Promise<EsiCorporation | null> {
		// First check entity cache by name (non-critical, failures treated as cache miss)
		const now = Date.now()
		try {
			const cachedCursor = await this.state.storage.sql.exec<{
				entity_id: string
				entity_data: string
				expires_at: number
			}>(
				`SELECT entity_id, entity_data, expires_at FROM entity_cache WHERE entity_type = ? AND entity_name = ?`,
				'corporation',
				name
			)

			const cached = [...cachedCursor]

			if (cached.length > 0 && cached[0].expires_at > now) {
				// Cache hit
				return JSON.parse(cached[0].entity_data) as EsiCorporation
			}
		} catch (error) {
			// Cache read failure - treat as cache miss
			logger.withTags({ name, operation: 'cache_read' }).warn('Entity cache read failed', error)
		}

		// Resolve name to ID
		const nameMap = await this.resolveNames([name])
		const corporationId = nameMap[name]

		if (!corporationId) {
			return null
		}

		// Fetch by ID (which will cache it)
		return this.getCorporationById(corporationId)
	}

	/**
	 * Get alliance information by name
	 * Uses name resolution and then fetches by ID
	 */
	async getAllianceByName(name: string): Promise<EsiAlliance | null> {
		// First check entity cache by name (non-critical, failures treated as cache miss)
		const now = Date.now()
		try {
			const cachedCursor = await this.state.storage.sql.exec<{
				entity_id: string
				entity_data: string
				expires_at: number
			}>(
				`SELECT entity_id, entity_data, expires_at FROM entity_cache WHERE entity_type = ? AND entity_name = ?`,
				'alliance',
				name
			)

			const cached = [...cachedCursor]

			if (cached.length > 0 && cached[0].expires_at > now) {
				// Cache hit
				return JSON.parse(cached[0].entity_data) as EsiAlliance
			}
		} catch (error) {
			// Cache read failure - treat as cache miss
			logger.withTags({ name, operation: 'cache_read' }).warn('Entity cache read failed', error)
		}

		// Resolve name to ID
		const nameMap = await this.resolveNames([name])
		const allianceId = nameMap[name]

		if (!allianceId) {
			return null
		}

		// Fetch by ID (which will cache it)
		return this.getAllianceById(allianceId)
	}

	/**
	 * Resolve multiple entity names to IDs using ESI bulk endpoint
	 */
	async resolveNames(names: string[]): Promise<Record<string, string>> {
		if (names.length === 0) {
			return {}
		}

		const result: Record<string, string> = {}
		const namesToResolve: string[] = []

		// Check cache for each name (non-critical, failures treated as cache miss)
		for (const name of names) {
			try {
				const cachedCursor = await this.state.storage.sql.exec<{
					entity_id: string
				}>(
					`SELECT entity_id FROM entity_cache WHERE entity_name = ? AND expires_at > ?`,
					name,
					Date.now()
				)

				const cached = [...cachedCursor]

				if (cached.length > 0) {
					result[name] = cached[0].entity_id
				} else {
					namesToResolve.push(name)
				}
			} catch (error) {
				// Cache read failure - treat as cache miss
				logger.withTags({ name, operation: 'cache_read' }).warn('Entity cache read failed', error)
				namesToResolve.push(name)
			}
		}

		// If all names are cached, return early
		if (namesToResolve.length === 0) {
			return result
		}

		// Fetch from ESI for uncached names
		try {
			const response = await fetch('https://esi.evetech.net/latest/universe/ids/', {
				method: 'POST',
				headers: {
					'X-Compatibility-Date': '2025-09-30',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(namesToResolve),
			})

			if (!response.ok) {
				const errorText = await response.text()
				logger.withTags({ status: response.status, errorText }).error('ESI name resolution failed')
				return result
			}

			// ESI returns numbers for IDs, but we need strings
			const data = await response.json<{
				alliances?: Array<{ id: number; name: string }>
				characters?: Array<{ id: number; name: string }>
				corporations?: Array<{ id: number; name: string }>
				systems?: Array<{ id: number; name: string }>
				[key: string]: Array<{ id: number; name: string }> | undefined
			}>()

			// Process all entity types and cache them
			const expiresAt = Date.now() + 60 * 60 * 1000 // 1 hour cache

			for (const [entityType, entities] of Object.entries(data)) {
				if (!entities) continue

				for (const entity of entities) {
					const entityId = String(entity.id)
					result[entity.name] = entityId

					// Cache the name→id mapping (non-critical, failures should not prevent returning data)
					try {
						await this.state.storage.sql.exec(
							`INSERT OR REPLACE INTO entity_cache (entity_type, entity_id, entity_name, entity_data, expires_at)
							 VALUES (?, ?, ?, ?, ?)`,
							entityType === 'systems' ? 'solar_system' : entityType.slice(0, -1), // 'alliances' → 'alliance'
							entityId,
							entity.name,
							JSON.stringify({ id: entityId, name: entity.name }), // Minimal data for name lookups
							expiresAt
						)
					} catch (error) {
						// Cache write failure - log but don't fail the request
						logger
							.withTags({ entityName: entity.name, entityId, operation: 'cache_write' })
							.warn('Entity cache write failed', error)
					}
				}
			}

			return result
		} catch (error) {
			logger.error(error)
			return result
		}
	}

	/**
	 * Resolve multiple entity IDs to names using ESI bulk endpoint
	 */
	async resolveIds(ids: string[]): Promise<Record<string, string>> {
		if (ids.length === 0) {
			return {}
		}

		const result: Record<string, string> = {}
		const idsToResolve: string[] = []

		// Check cache for each ID (non-critical, failures treated as cache miss)
		for (const id of ids) {
			try {
				const cachedCursor = await this.state.storage.sql.exec<{
					entity_name: string
				}>(
					`SELECT entity_name FROM entity_cache WHERE entity_id = ? AND expires_at > ?`,
					id,
					Date.now()
				)

				const cached = [...cachedCursor]

				if (cached.length > 0) {
					result[id] = cached[0].entity_name
				} else {
					idsToResolve.push(id)
				}
			} catch (error) {
				// Cache read failure - treat as cache miss
				logger.withTags({ id, operation: 'cache_read' }).warn('Entity cache read failed', error)
				idsToResolve.push(id)
			}
		}

		// If all IDs are cached, return early
		if (idsToResolve.length === 0) {
			return result
		}

		// Fetch from ESI for uncached IDs
		try {
			// Convert string IDs to integers for ESI API
			const integerIds = idsToResolve.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id))

			// If no valid IDs after conversion, return early
			if (integerIds.length === 0) {
				return result
			}

			const response = await fetch('https://esi.evetech.net/latest/universe/names/', {
				method: 'POST',
				headers: {
					'X-Compatibility-Date': '2025-09-30',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(integerIds),
			})

			if (!response.ok) {
				const errorText = await response.text()
				logger.withTags({ status: response.status, errorText }).error('ESI ID resolution failed')
				return result
			}

			// ESI returns numbers for IDs, but we need strings
			const data = await response.json<Array<{ id: number; name: string; category: string }>>()

			// Cache the results
			const expiresAt = Date.now() + 60 * 60 * 1000 // 1 hour cache

			for (const entity of data) {
				const entityId = String(entity.id)
				result[entityId] = entity.name

				// Cache the id→name mapping (non-critical, failures should not prevent returning data)
				try {
					await this.state.storage.sql.exec(
						`INSERT OR REPLACE INTO entity_cache (entity_type, entity_id, entity_name, entity_data, expires_at)
						 VALUES (?, ?, ?, ?, ?)`,
						entity.category,
						entityId,
						entity.name,
						JSON.stringify({ id: entityId, name: entity.name, category: entity.category }), // Minimal data for ID lookups
						expiresAt
					)
				} catch (error) {
					// Cache write failure - log but don't fail the request
					logger
						.withTags({ entityName: entity.name, entityId, operation: 'cache_write' })
						.warn('Entity cache write failed', error)
				}
			}

			return result
		} catch (error) {
			logger.error(error)
			return result
		}
	}

	/**
	 * Alarm handler - automatically refresh tokens that are expiring soon
	 */
	async alarm(): Promise<void> {
		try {
			const now = new Date()
			const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000)

			// Find tokens expiring within the next 5 minutes
			const expiringTokens = await this.db.query.eveTokens.findMany({
				where: and(
					gt(eveTokens.expiresAt, now), // Not already expired
					lte(eveTokens.expiresAt, fiveMinutesFromNow) // Expires within 5 minutes
				),
			})

			// Refresh each token
			for (const token of expiringTokens) {
				const character = await this.db.query.eveCharacters.findFirst({
					where: eq(eveCharacters.id, token.characterId),
				})

				if (character) {
					await this.refreshToken(character.characterId)
				}
			}
		} catch (error) {
			logger.error(error)
		}

		// Schedule next alarm (5 minutes)
		await this.state.storage.setAlarm(Date.now() + 5 * 60 * 1000)
	}

	/**
	 * Generate authorization URL for EVE SSO
	 */
	private generateAuthUrl(scopes: string[], state?: string): AuthorizationUrlResponse {
		const generatedState = state || crypto.randomUUID()

		const params = new URLSearchParams({
			response_type: 'code',
			redirect_uri: this.env.EVE_SSO_CALLBACK_URL,
			client_id: this.env.EVE_SSO_CLIENT_ID,
			scope: scopes.join(' '),
			state: generatedState,
		})

		return {
			url: `${EVE_SSO_AUTHORIZE_URL}?${params.toString()}`,
			state: generatedState,
		}
	}

	/**
	 * Exchange authorization code for access token
	 */
	private async exchangeCodeForToken(code: string): Promise<EveTokenResponse> {
		const credentials = btoa(`${this.env.EVE_SSO_CLIENT_ID}:${this.env.EVE_SSO_CLIENT_SECRET}`)

		const response = await fetch(EVE_SSO_TOKEN_URL, {
			method: 'POST',
			headers: {
				Authorization: `Basic ${credentials}`,
				'Content-Type': 'application/x-www-form-urlencoded',
				Host: 'login.eveonline.com',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
			}),
		})

		if (!response.ok) {
			const error = await response.text()
			throw new Error(`Token exchange failed: ${error}`)
		}

		return response.json<EveTokenResponse>()
	}

	/**
	 * Refresh access token using refresh token
	 */
	private async refreshAccessToken(refreshToken: string): Promise<EveTokenResponse> {
		const credentials = btoa(`${this.env.EVE_SSO_CLIENT_ID}:${this.env.EVE_SSO_CLIENT_SECRET}`)

		const response = await fetch(EVE_SSO_TOKEN_URL, {
			method: 'POST',
			headers: {
				Authorization: `Basic ${credentials}`,
				'Content-Type': 'application/x-www-form-urlencoded',
				Host: 'login.eveonline.com',
			},
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
			}),
		})

		if (!response.ok) {
			const error = await response.text()
			throw new Error(`Token refresh failed: ${error}`)
		}

		return response.json<EveTokenResponse>()
	}

	/**
	 * Verify access token with EVE SSO
	 */
	private async verifyToken(accessToken: string): Promise<EveVerifyResponse> {
		const response = await fetch(EVE_SSO_VERIFY_URL, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		})

		if (!response.ok) {
			const error = await response.text()
			throw new Error(`Token verification failed: ${error}`)
		}

		return response.json<EveVerifyResponse>()
	}

	/**
	 * Store token in database (upsert)
	 */
	private async storeToken(
		characterId: string,
		characterName: string,
		characterOwnerHash: string,
		scopes: string[],
		accessToken: string,
		refreshToken: string | null,
		expiresAt: Date
	): Promise<void> {
		// Encrypt tokens
		const encryptedAccessToken = await this.encrypt(accessToken)
		const encryptedRefreshToken = refreshToken ? await this.encrypt(refreshToken) : null

		// Check if character exists
		let character = await this.db.query.eveCharacters.findFirst({
			where: eq(eveCharacters.characterId, characterId),
		})

		if (character) {
			// Update existing character (including hash for transfer detection)
			await this.db
				.update(eveCharacters)
				.set({
					characterName,
					characterOwnerHash,
					scopes: JSON.stringify(scopes),
					updatedAt: new Date(),
				})
				.where(eq(eveCharacters.id, character.id))
		} else {
			// Insert new character
			const [newCharacter] = await this.db
				.insert(eveCharacters)
				.values({
					characterId,
					characterName,
					characterOwnerHash,
					scopes: JSON.stringify(scopes),
				})
				.returning()

			character = newCharacter
		}

		if (!character) {
			throw new Error('Failed to create or update character')
		}

		// Check if token exists
		const existingToken = await this.db.query.eveTokens.findFirst({
			where: eq(eveTokens.characterId, character.id),
		})

		if (existingToken) {
			// Update existing token
			await this.db
				.update(eveTokens)
				.set({
					accessToken: encryptedAccessToken,
					refreshToken: encryptedRefreshToken,
					expiresAt,
					updatedAt: new Date(),
				})
				.where(eq(eveTokens.id, existingToken.id))
		} else {
			// Insert new token
			await this.db.insert(eveTokens).values({
				characterId: character.id,
				accessToken: encryptedAccessToken,
				refreshToken: encryptedRefreshToken,
				expiresAt,
			})
		}
	}

	/**
	 * Encrypt data using AES-GCM
	 */
	private async encrypt(data: string): Promise<string> {
		const key = await this.getEncryptionKey()
		const iv = crypto.getRandomValues(new Uint8Array(12))
		const encodedData = new TextEncoder().encode(data)

		const encryptedData = await crypto.subtle.encrypt(
			{
				name: 'AES-GCM',
				iv,
			},
			key,
			encodedData
		)

		// Combine IV and encrypted data
		const combined = new Uint8Array(iv.length + encryptedData.byteLength)
		combined.set(iv)
		combined.set(new Uint8Array(encryptedData), iv.length)

		// Return as base64
		return btoa(String.fromCharCode(...combined))
	}

	/**
	 * Decrypt data using AES-GCM
	 */
	private async decrypt(encryptedData: string): Promise<string> {
		const key = await this.getEncryptionKey()

		// Decode from base64
		const combined = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0))

		// Extract IV and data
		const iv = combined.slice(0, 12)
		const data = combined.slice(12)

		const decryptedData = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv,
			},
			key,
			data
		)

		return new TextDecoder().decode(decryptedData)
	}

	/**
	 * Get or create encryption key from environment
	 */
	private async getEncryptionKey(): Promise<CryptoKey> {
		// Convert hex string to bytes
		const keyData = new Uint8Array(
			this.env.ENCRYPTION_KEY.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
		)

		return crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, [
			'encrypt',
			'decrypt',
		])
	}

	/**
	 * Parse ESI cache expiry from response headers
	 */
	private parseEsiCacheExpiry(headers: Headers): Date {
		// Check Expires header first
		const expires = headers.get('Expires')
		if (expires) {
			return new Date(expires)
		}

		// Check Cache-Control header
		const cacheControl = headers.get('Cache-Control')
		if (cacheControl) {
			const maxAgeMatch = cacheControl.match(/max-age=(\d+)/)
			if (maxAgeMatch) {
				return new Date(Date.now() + parseInt(maxAgeMatch[1], 10) * 1000)
			}
		}

		// Default: 5 minutes
		return new Date(Date.now() + 5 * 60 * 1000)
	}
}
