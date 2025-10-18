import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
// Wrap with Sentry for error tracking
import {
	getRequestLogData,
	logger,
	withNotFound,
	withOnError,
	withSentry,
} from '@repo/hono-helpers'

import type { CharacterDataStore } from '@repo/character-data-store'
import type { EveSSO } from '@repo/evesso'
import type { App } from './context'

const app = new Hono<App>()
	.use(
		'*',
		// middleware
		(c, next) =>
			useWorkersLogger(c.env.NAME, {
				environment: c.env.ENVIRONMENT,
				release: c.env.SENTRY_RELEASE,
			})(c, next)
	)

	.onError(withOnError())
	.notFound(withNotFound())

	// Character lookup endpoint
	.get('/esi/characters/:characterId', async (c) => {
		const characterIdParam = c.req.param('characterId')
		const characterId = parseInt(characterIdParam, 10)

		if (isNaN(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}

		try {
			const dataStoreStub = getStub<CharacterDataStore>(c.env.CHARACTER_DATA_STORE, 'global')
			const character = await dataStoreStub.getCharacter(characterId)

			if (!character) {
				return c.json({ error: 'Character not found' }, 404)
			}

			logger
				.withTags({
					type: 'character_lookup',
					character_id: characterId,
				})
				.info('Character lookup', {
					characterId,
					characterName: character.name,
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				characterId: character.character_id,
				name: character.name,
				corporationId: character.corporation_id,
				allianceId: character.alliance_id,
				securityStatus: character.security_status,
				birthday: character.birthday,
				gender: character.gender,
				raceId: character.race_id,
				bloodlineId: character.bloodline_id,
				ancestryId: character.ancestry_id,
				description: character.description,
				lastUpdated: new Date(character.last_updated).toISOString(),
				nextUpdateAt: new Date(character.next_update_at).toISOString(),
				updateCount: character.update_count,
			})
		} catch (error) {
			logger
				.withTags({
					type: 'character_lookup_error',
					character_id: characterId,
				})
				.error('Character lookup error', {
					error: String(error),
					characterId,
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: 'Failed to lookup character' }, 500)
		}
	})

	// Corporation lookup endpoint
	.get('/esi/corporations/:corporationId', async (c) => {
		const corporationIdParam = c.req.param('corporationId')
		const corporationId = parseInt(corporationIdParam, 10)

		if (isNaN(corporationId)) {
			return c.json({ error: 'Invalid corporation ID' }, 400)
		}

		try {
			const dataStoreStub = getStub<CharacterDataStore>(c.env.CHARACTER_DATA_STORE, 'global')
			const corporation = await dataStoreStub.getCorporation(corporationId)

			if (!corporation) {
				return c.json({ error: 'Corporation not found' }, 404)
			}

			logger
				.withTags({
					type: 'corporation_lookup',
					corporation_id: corporationId,
				})
				.info('Corporation lookup', {
					corporationId,
					corporationName: corporation.name,
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				corporationId: corporation.corporation_id,
				name: corporation.name,
				ticker: corporation.ticker,
				memberCount: corporation.member_count,
				ceoId: corporation.ceo_id,
				creatorId: corporation.creator_id,
				dateFounded: corporation.date_founded,
				taxRate: corporation.tax_rate,
				url: corporation.url,
				description: corporation.description,
				allianceId: corporation.alliance_id,
				lastUpdated: new Date(corporation.last_updated).toISOString(),
				nextUpdateAt: new Date(corporation.next_update_at).toISOString(),
				updateCount: corporation.update_count,
			})
		} catch (error) {
			logger
				.withTags({
					type: 'corporation_lookup_error',
					corporation_id: corporationId,
				})
				.error('Corporation lookup error', {
					error: String(error),
					corporationId,
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: 'Failed to lookup corporation' }, 500)
		}
	})

// ESI proxy router with /esi basePath
const esiProxyRouter = new Hono<App>().basePath('/esi').all('*', async (c) => {
	const url = new URL(c.req.url)
	const method = c.req.method.toUpperCase()
	// Strip /esi prefix from path for proxying to ESI
	const fullPath = url.pathname
	const path = fullPath.startsWith('/esi') ? fullPath.slice(4) : fullPath
	const querystring = url.search

	// Check for cache bypass
	const nocache = url.searchParams.has('nocache')

	// Only cache GET requests
	const cacheable = method === 'GET' && !nocache

	// Extract and validate proxy token - REQUIRED for all requests
	const authorization = c.req.header('Authorization')
	if (!authorization || !authorization.startsWith('Bearer ')) {
		logger
			.withTags({
				type: 'missing_authorization',
			})
			.warn('Request without authorization header', {
				path,
				request: getRequestLogData(c, Date.now()),
			})
		return c.json({ error: 'Authorization required' }, 401)
	}

	const token = authorization.substring(7)

	// Check if this looks like a proxy token (64 hex chars)
	if (token.length !== 64 || !/^[0-9a-f]+$/i.test(token)) {
		logger
			.withTags({
				type: 'invalid_token_format',
			})
			.warn('Invalid proxy token format', {
				path,
				request: getRequestLogData(c, Date.now()),
			})
		return c.json({ error: 'Invalid proxy token format' }, 401)
	}

	const proxyToken = token

	// Look up the real access token
	let accessToken: string
	let characterId: number
	let characterName: string

	try {
		const stub = getStub<EveSSO>(c.env.EVESSO_STORE, 'global')

		const lookupData = await stub.findByProxyToken(proxyToken)

		accessToken = lookupData.accessToken
		characterId = lookupData.characterId
		characterName = lookupData.characterName
	} catch (error) {
		// Check if it's a "Token not found" error
		if (error instanceof Error && error.message === 'Token not found') {
			logger
				.withTags({
					type: 'invalid_proxy_token',
				})
				.warn('Invalid proxy token provided', {
					path,
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: 'Invalid proxy token' }, 401)
		}

		logger
			.withTags({
				type: 'proxy_token_lookup_error',
			})
			.error('Error looking up proxy token', {
				error: String(error),
				path,
				request: getRequestLogData(c, Date.now()),
			})
		return c.json({ error: 'Error verifying proxy token' }, 500)
	}

	// Generate cache key - always includes proxy token for security
	const acceptLanguage = c.req.header('Accept-Language') || 'en'
	const cacheKey = `esi:${method}:${path}:${querystring}:${acceptLanguage}:${proxyToken}`

	// Try cache for cacheable requests
	if (cacheable) {
		const cached = await c.env.ESI_CACHE.get(cacheKey, { type: 'json' })
		if (cached) {
			logger
				.withTags({
					type: 'esi_cache_hit',
					path,
					character_id: characterId,
				})
				.info('ESI cache hit', {
					cacheKey: cacheKey.replace(proxyToken, proxyToken.substring(0, 8) + '...'),
					characterId,
					characterName,
					request: getRequestLogData(c, Date.now()),
				})

			const {
				body,
				headers: cachedHeaders,
				status,
			} = cached as {
				body: string
				headers: Record<string, string>
				status: number
			}

			// Reconstruct response from cache
			const response = new Response(body, {
				status,
				headers: new Headers(cachedHeaders),
			})
			response.headers.set('X-Cache', 'HIT')
			return response
		}

		logger
			.withTags({
				type: 'esi_cache_miss',
				path,
				character_id: characterId,
			})
			.info('ESI cache miss', {
				cacheKey: cacheKey.replace(proxyToken, proxyToken.substring(0, 8) + '...'),
				characterId,
				characterName,
				request: getRequestLogData(c, Date.now()),
			})
	}

	// Build ESI request
	const esiUrl = `https://esi.evetech.net${path}${querystring}`
	const esiHeaders = new Headers()

	// Add required ESI headers
	esiHeaders.set('X-Compatibility-Date', '2025-09-30')

	// Forward Accept-Language if present
	if (acceptLanguage) {
		esiHeaders.set('Accept-Language', acceptLanguage)
	}

	// Forward conditional request headers
	const ifNoneMatch = c.req.header('If-None-Match')
	if (ifNoneMatch) {
		esiHeaders.set('If-None-Match', ifNoneMatch)
	}

	const ifModifiedSince = c.req.header('If-Modified-Since')
	if (ifModifiedSince) {
		esiHeaders.set('If-Modified-Since', ifModifiedSince)
	}

	// Use the real access token for ESI
	esiHeaders.set('Authorization', `Bearer ${accessToken}`)

	logger
		.withTags({
			type: 'proxy_token_used',
			character_id: characterId,
		})
		.info('Using proxy token for authenticated request', {
			characterId,
			characterName,
			path,
			request: getRequestLogData(c, Date.now()),
		})

	// Forward User-Agent
	const userAgent = c.req.header('User-Agent')
	if (userAgent) {
		esiHeaders.set('User-Agent', userAgent)
	}

	// Proxy request to ESI
	let esiResponse: Response
	try {
		esiResponse = await fetch(esiUrl, {
			method,
			headers: esiHeaders,
			body: method !== 'GET' && method !== 'HEAD' ? await c.req.raw.clone().text() : undefined,
		})
	} catch (error) {
		logger
			.withTags({
				type: 'esi_proxy_error',
				path,
			})
			.error('ESI proxy error', {
				error: String(error),
				esiUrl,
				request: getRequestLogData(c, Date.now()),
			})
		return c.json({ error: 'Failed to proxy request to ESI' }, 502)
	}

	// Log ESI response
	logger
		.withTags({
			type: 'esi_response',
			path,
			status: esiResponse.status,
		})
		.info('ESI response', {
			status: esiResponse.status,
			esiUrl,
			request: getRequestLogData(c, Date.now()),
		})

	// Cache successful GET responses
	if (cacheable && esiResponse.ok) {
		const responseBody = await esiResponse.text()

		// Calculate TTL from Cache-Control header
		let ttl = 300 // Default 5 minutes
		const cacheControl = esiResponse.headers.get('Cache-Control')
		if (cacheControl) {
			const maxAgeMatch = cacheControl.match(/max-age=(\d+)/)
			if (maxAgeMatch) {
				ttl = parseInt(maxAgeMatch[1], 10)
			}
		}

		// Store in KV with TTL
		const cacheData = {
			body: responseBody,
			headers: Object.fromEntries(esiResponse.headers.entries()),
			status: esiResponse.status,
		}

		try {
			await c.env.ESI_CACHE.put(cacheKey, JSON.stringify(cacheData), {
				expirationTtl: ttl,
			})

			logger
				.withTags({
					type: 'esi_cache_write',
					path,
				})
				.info('ESI cache write', {
					cacheKey,
					ttl,
					request: getRequestLogData(c, Date.now()),
				})
		} catch (error) {
			logger
				.withTags({
					type: 'esi_cache_write_error',
					path,
				})
				.error('ESI cache write error', {
					error: String(error),
					cacheKey,
					request: getRequestLogData(c, Date.now()),
				})
		}

		// Return response with cache miss header
		const response = new Response(responseBody, {
			status: esiResponse.status,
			headers: esiResponse.headers,
		})
		response.headers.set('X-Cache', 'MISS')
		return response
	}

	// For non-cacheable requests or errors, just return the response
	const response = new Response(esiResponse.body, {
		status: esiResponse.status,
		headers: esiResponse.headers,
	})
	response.headers.set('X-Cache', 'BYPASS')
	return response
})

// Mount ESI proxy router (must be last to avoid catching other routes)
app.route('/', esiProxyRouter)

export default withSentry(app)

// Export Durable Objects
export { CharacterDataStore } from './character-data-store'
export { EveUniverse } from './eve-universe'
