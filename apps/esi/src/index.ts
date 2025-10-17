import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getRequestLogData, logger, withNotFound, withOnError } from '@repo/hono-helpers'
import { getStub } from '@repo/do-utils'
import type { UserTokenStore } from '@repo/user-token-store'
import type { CharacterDataStore } from '@repo/character-data-store'

import { adminRouter } from './admin'
import { ALL_ESI_SCOPES } from './consts'
import callbackHtml from './templates/callback.html'

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

	// Mount admin router
	.route('/', adminRouter)

	// OAuth login endpoint (canonical) - Requires authentication
	.get('/esi/login', async (c) => {
		// Check for session cookie
		const sessionId = getCookie(c, 'session_id')

		if (!sessionId) {
			logger
				.withTags({
					type: 'esi_login_unauthenticated',
				})
				.warn('ESI login attempted without authentication', {
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: 'Authentication required. Please log in with your social account first.' }, 401)
		}

		try {
			// Create ESI OAuth state linked to the session
			const tokenStoreStub = getStub<UserTokenStore>(c.env.USER_TOKEN_STORE, 'global')
			const state = await tokenStoreStub.createESIOAuthState(sessionId)

			const scopes = c.req.query('scopes') || ALL_ESI_SCOPES.join(' ')

			const authUrl = new URL('https://login.eveonline.com/v2/oauth/authorize/')
			authUrl.searchParams.set('response_type', 'code')
			authUrl.searchParams.set('redirect_uri', c.env.ESI_SSO_CALLBACK_URL)
			authUrl.searchParams.set('client_id', c.env.ESI_SSO_CLIENT_ID)
			authUrl.searchParams.set('scope', scopes)
			authUrl.searchParams.set('state', state)

			logger
				.withTags({
					type: 'oauth_login_redirect',
				})
				.info('Redirecting to EVE SSO', {
					scopes,
					state: state.substring(0, 8) + '...',
					sessionId: sessionId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.redirect(authUrl.toString())
		} catch (error) {
			logger
				.withTags({
					type: 'esi_login_error',
				})
				.error('Error initiating ESI login', {
					error: String(error),
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: 'Failed to initiate ESI login' }, 500)
		}
	})

	// OAuth callback endpoint (canonical) - Links character to social account
	.get('/esi/callback', async (c) => {
		const code = c.req.query('code')
		const state = c.req.query('state')

		if (!code || !state) {
			return c.json({ error: 'Missing authorization code or state' }, 400)
		}

		logger
			.withTags({
				type: 'oauth_callback',
			})
			.info('OAuth callback received', {
				state: state.substring(0, 8) + '...',
				request: getRequestLogData(c, Date.now()),
			})

		try {
			// Validate state and get session ID
			const tokenStoreStub = getStub<UserTokenStore>(c.env.USER_TOKEN_STORE, 'global')

			let sessionId: string
			try {
				sessionId = await tokenStoreStub.validateESIOAuthState(state)
			} catch (error) {
				logger
					.withTags({
						type: 'esi_oauth_state_invalid',
					})
					.warn('Invalid or expired ESI OAuth state', {
						state: state.substring(0, 8) + '...',
						error: String(error),
						request: getRequestLogData(c, Date.now()),
					})
				return c.json({ error: 'Invalid or expired state. Please try again.' }, 400)
			}

			// Exchange code for tokens
			const auth = btoa(`${c.env.ESI_SSO_CLIENT_ID}:${c.env.ESI_SSO_CLIENT_SECRET}`)
			const tokenResponse = await fetch('https://login.eveonline.com/v2/oauth/token', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: `Basic ${auth}`,
				},
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					code,
				}),
			})

			if (!tokenResponse.ok) {
				const error = await tokenResponse.text()
				logger
					.withTags({
						type: 'oauth_token_error',
					})
					.error('Failed to exchange code for token', {
						status: tokenResponse.status,
						error,
						request: getRequestLogData(c, Date.now()),
					})
				return c.json({ error: 'Failed to exchange code for token' }, 502)
			}

			const tokenData = (await tokenResponse.json()) as {
				access_token: string
				refresh_token: string
				expires_in: number
			}

			// Verify the token and get character info
			const verifyResponse = await fetch('https://login.eveonline.com/oauth/verify', {
				headers: {
					Authorization: `Bearer ${tokenData.access_token}`,
				},
			})

			if (!verifyResponse.ok) {
				return c.json({ error: 'Failed to verify token' }, 502)
			}

			const characterInfo = (await verifyResponse.json()) as {
				CharacterID: number
				CharacterName: string
				Scopes: string
			}

			// Get session info via internal API call to social-auth worker
			// Service bindings with RPC have serialization issues, so we use HTTP fetch instead
			let socialUserId: string
			try {
				logger.info('Fetching session info from social-auth worker', {
					sessionId: sessionId.substring(0, 8) + '...',
				})

				// Create internal request to social-auth worker's session verify endpoint
				const verifyRequest = new Request('https://pleaseignore.app/api/session/verify', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Cookie': `session_id=${sessionId}`,
					},
				})

				// Use service binding to call social-auth worker via fetch
				const verifyResponse = await c.env.SOCIAL_AUTH.fetch(verifyRequest)

				if (!verifyResponse.ok) {
					throw new Error(`Session verify failed with status ${verifyResponse.status}`)
				}

				const verifyData = await verifyResponse.json() as { success: boolean; session: { socialUserId: string } }
				socialUserId = verifyData.session.socialUserId

				logger.info('Got session info from social-auth worker', {
					socialUserId: socialUserId.substring(0, 8) + '...',
				})
			} catch (sessionError) {
				logger
					.withTags({
						type: 'session_lookup_error',
					})
					.error('Failed to lookup session', {
						error: String(sessionError),
						errorMessage: sessionError instanceof Error ? sessionError.message : 'Unknown',
						sessionId: sessionId.substring(0, 8) + '...',
					})
				return c.json({ error: 'Session not found or expired. Please log in again.' }, 401)
			}

			// Check if character is already linked via internal API call
			let existingLink: { socialUserId: string; linkId: string } | null = null
			try {
				const checkRequest = new Request(`https://pleaseignore.app/api/characters/${characterInfo.CharacterID}/link`, {
					method: 'GET',
				})

				const checkResponse = await c.env.SOCIAL_AUTH.fetch(checkRequest)

				if (checkResponse.ok) {
					const linkData = await checkResponse.json() as { socialUserId: string; linkId: string }
					existingLink = linkData
				}
			} catch (error) {
				// Link doesn't exist, that's fine
				logger.info('No existing character link found', {
					characterId: characterInfo.CharacterID,
				})
			}

			if (existingLink) {
				if (existingLink.socialUserId !== socialUserId) {
					logger
						.withTags({
							type: 'character_already_linked',
							character_id: characterInfo.CharacterID,
						})
						.warn('Character already linked to different social account', {
							characterId: characterInfo.CharacterID,
							characterName: characterInfo.CharacterName,
							request: getRequestLogData(c, Date.now()),
						})
					return c.json(
						{ error: 'This character is already linked to another social account.' },
						409
					)
				}
				// Character already linked to this user, that's fine - update tokens
				logger
					.withTags({
						type: 'character_reauth',
						character_id: characterInfo.CharacterID,
					})
					.info('Character re-authenticated', {
						characterId: characterInfo.CharacterID,
						characterName: characterInfo.CharacterName,
						request: getRequestLogData(c, Date.now()),
					})
			} else {
				// Create new character link via HTTP call
				try {
					const linkRequest = new Request('https://pleaseignore.app/api/characters/link', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'Cookie': `session_id=${sessionId}`,
						},
						body: JSON.stringify({
							characterId: characterInfo.CharacterID,
							characterName: characterInfo.CharacterName,
						}),
					})

					const linkResponse = await c.env.SOCIAL_AUTH.fetch(linkRequest)

					if (!linkResponse.ok) {
						throw new Error(`Failed to create character link: ${linkResponse.status}`)
					}

					logger
						.withTags({
							type: 'character_linked',
							character_id: characterInfo.CharacterID,
						})
						.info('Character linked to social account', {
							characterId: characterInfo.CharacterID,
							characterName: characterInfo.CharacterName,
							socialUserId: socialUserId.substring(0, 8) + '...',
							request: getRequestLogData(c, Date.now()),
						})
				} catch (linkError) {
					logger
						.withTags({
							type: 'character_link_error',
							character_id: characterInfo.CharacterID,
						})
						.error('Failed to create character link', {
							error: String(linkError),
							characterId: characterInfo.CharacterID,
							characterName: characterInfo.CharacterName,
							socialUserId: socialUserId.substring(0, 8) + '...',
							request: getRequestLogData(c, Date.now()),
						})
					// Don't throw - continue with token storage
				}
			}

			// Store tokens in Durable Object
			await tokenStoreStub.storeTokens(
				characterInfo.CharacterID,
				characterInfo.CharacterName,
				tokenData.access_token,
				tokenData.refresh_token,
				tokenData.expires_in,
				characterInfo.Scopes
			)

			// Fetch and store character data
			try {
				const dataStoreStub = getStub<CharacterDataStore>(c.env.CHARACTER_DATA_STORE, 'global')

				// Import ESI client functions
				const { fetchCharacterInfo, fetchCorporationInfo } = await import('./esi-client')

				// Fetch character info from ESI
				const charResult = await fetchCharacterInfo(characterInfo.CharacterID, tokenData.access_token)
				await dataStoreStub.upsertCharacter(
					characterInfo.CharacterID,
					charResult.data,
					charResult.expiresAt
				)

				logger
					.withTags({
						type: 'character_data_stored',
						character_id: characterInfo.CharacterID,
					})
					.info('Character data stored during linking', {
						characterId: characterInfo.CharacterID,
						characterName: characterInfo.CharacterName,
						corporationId: charResult.data.corporation_id,
					})

				// Fetch and store corporation data
				try {
					const corpResult = await fetchCorporationInfo(
						charResult.data.corporation_id,
						tokenData.access_token
					)
					await dataStoreStub.upsertCorporation(
						charResult.data.corporation_id,
						corpResult.data,
						corpResult.expiresAt
					)

					logger
						.withTags({
							type: 'corporation_data_stored',
							corporation_id: charResult.data.corporation_id,
						})
						.info('Corporation data stored during character linking', {
							corporationId: charResult.data.corporation_id,
							corporationName: corpResult.data.name,
						})
				} catch (corpError) {
					logger
						.withTags({
							type: 'corporation_fetch_error',
						})
						.error('Failed to fetch corporation during character linking', {
							error: String(corpError),
							corporationId: charResult.data.corporation_id,
						})
					// Don't fail the entire flow if corporation fetch fails
				}
			} catch (dataError) {
				logger
					.withTags({
						type: 'character_data_error',
						character_id: characterInfo.CharacterID,
					})
					.error('Failed to store character data during linking', {
						error: String(dataError),
						characterId: characterInfo.CharacterID,
					})
				// Don't fail the entire OAuth flow if data storage fails
			}

			logger
				.withTags({
					type: 'oauth_success',
					character_id: characterInfo.CharacterID,
				})
				.info('OAuth flow completed', {
					characterId: characterInfo.CharacterID,
					characterName: characterInfo.CharacterName,
					request: getRequestLogData(c, Date.now()),
				})

			return c.html(callbackHtml.replace('<!-- CHARACTER_NAME -->', characterInfo.CharacterName))
		} catch (error) {
			logger
				.withTags({
					type: 'oauth_exception',
				})
				.error('OAuth exception', {
					error: String(error),
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: String(error) }, 500)
		}
	})

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
		const stub = getStub<UserTokenStore>(c.env.USER_TOKEN_STORE, 'global')

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

// Wrap with Sentry for error tracking
import { withSentry } from '@repo/hono-helpers'
export default withSentry(app)

// Export Durable Objects
export { CharacterDataStore } from './character-data-store'
export { UserTokenStore } from './user-token-store'
