import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getRequestLogData, logger, withNotFound, withOnError } from '@repo/hono-helpers'

import { adminRouter } from './admin'
import { ALL_ESI_SCOPES } from './consts'
import type { App } from './context'
import type { TokenStoreRequest, TokenStoreResponse } from './user-token-store'

const app = new Hono<App>()
	.basePath('/esi')
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

	// Mount admin router (must be before catch-all proxy)
	.route('/', adminRouter)

	// OAuth login endpoint
	.get('/auth/login', (c) => {
		const state = crypto.randomUUID()
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
				state,
				request: getRequestLogData(c, Date.now()),
			})

		return c.redirect(authUrl.toString())
	})

	// OAuth callback endpoint
	.get('/auth/callback', async (c) => {
		const code = c.req.query('code')
		const state = c.req.query('state')

		if (!code) {
			return c.json({ error: 'Missing authorization code' }, 400)
		}

		logger
			.withTags({
				type: 'oauth_callback',
			})
			.info('OAuth callback received', {
				state,
				request: getRequestLogData(c, Date.now()),
			})

		try {
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

			// Store tokens in Durable Object
			const id = c.env.USER_TOKEN_STORE.idFromName(String(characterInfo.CharacterID))
			const stub = c.env.USER_TOKEN_STORE.get(id)

			const storeRequest: TokenStoreRequest = {
				action: 'storeTokens',
				characterId: characterInfo.CharacterID,
				characterName: characterInfo.CharacterName,
				accessToken: tokenData.access_token,
				refreshToken: tokenData.refresh_token,
				expiresIn: tokenData.expires_in,
				scopes: characterInfo.Scopes,
			}

			const storeResponse = await stub.fetch('http://do/store', {
				method: 'POST',
				body: JSON.stringify(storeRequest),
			})

			const storeData = (await storeResponse.json()) as TokenStoreResponse

			if (!storeData.success) {
				return c.json({ error: 'Failed to store tokens' }, 500)
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

			return c.html(`
				<!DOCTYPE html>
				<html>
					<head>
						<meta charset="utf-8">
						<meta name="viewport" content="width=device-width, initial-scale=1">
						<title>Authentication Successful</title>
						<style>
							body {
								font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
								display: flex;
								justify-content: center;
								align-items: center;
								min-height: 100vh;
								margin: 0;
								background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
							}
							.container {
								background: white;
								padding: 3rem;
								border-radius: 1rem;
								box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
								text-align: center;
								max-width: 500px;
							}
							h1 {
								color: #333;
								margin: 0 0 1rem 0;
								font-size: 2rem;
							}
							p {
								color: #666;
								margin: 0.5rem 0;
								font-size: 1.1rem;
							}
							.character-name {
								color: #667eea;
								font-weight: bold;
							}
							.success-icon {
								font-size: 4rem;
								margin-bottom: 1rem;
							}
						</style>
					</head>
					<body>
						<div class="container">
							<div class="success-icon">✓</div>
							<h1>Authentication Successful</h1>
							<p>Thank you for logging in, <span class="character-name">${characterInfo.CharacterName}</span>!</p>
							<p>You can now close this window.</p>
						</div>
					</body>
				</html>
			`)
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

	// Logout endpoint
	.post('/auth/logout', async (c) => {
		const authorization = c.req.header('Authorization')
		if (!authorization || !authorization.startsWith('Bearer ')) {
			return c.json({ error: 'Missing or invalid Authorization header' }, 401)
		}

		const proxyToken = authorization.substring(7)

		// Find the token in DO
		const id = c.env.USER_TOKEN_STORE.idFromName('proxy_lookup')
		const stub = c.env.USER_TOKEN_STORE.get(id)

		const findRequest: TokenStoreRequest = {
			action: 'findByProxyToken',
			proxyToken,
		}

		const findResponse = await stub.fetch('http://do/find', {
			method: 'POST',
			body: JSON.stringify(findRequest),
		})

		const findData = (await findResponse.json()) as TokenStoreResponse

		if (!findData.success || !findData.data) {
			return c.json({ error: 'Invalid token' }, 401)
		}

		// Revoke the token
		const revokeId = c.env.USER_TOKEN_STORE.idFromName(String(findData.data.characterId))
		const revokeStub = c.env.USER_TOKEN_STORE.get(revokeId)

		const revokeRequest: TokenStoreRequest = {
			action: 'revokeToken',
			characterId: findData.data.characterId,
		}

		await revokeStub.fetch('http://do/revoke', {
			method: 'POST',
			body: JSON.stringify(revokeRequest),
		})

		logger
			.withTags({
				type: 'logout',
				character_id: findData.data.characterId,
			})
			.info('User logged out', {
				characterId: findData.data.characterId,
				request: getRequestLogData(c, Date.now()),
			})

		return c.json({ success: true })
	})

	// ESI proxy (catch-all)
	.all('*', async (c) => {
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

		// Generate cache key
		const acceptLanguage = c.req.header('Accept-Language') || 'en'
		const cacheKey = `esi:${method}:${path}:${querystring}:${acceptLanguage}`

		// Try cache for cacheable requests
		if (cacheable) {
			const cached = await c.env.ESI_CACHE.get(cacheKey, { type: 'json' })
			if (cached) {
				logger
					.withTags({
						type: 'esi_cache_hit',
						path,
					})
					.info('ESI cache hit', {
						cacheKey,
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
				})
				.info('ESI cache miss', {
					cacheKey,
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

		// Handle authorization - check if it's a proxy token
		const authorization = c.req.header('Authorization')
		if (authorization && authorization.startsWith('Bearer ')) {
			const token = authorization.substring(7)

			// Check if this looks like a proxy token (64 hex chars)
			if (token.length === 64 && /^[0-9a-f]+$/i.test(token)) {
				// This is a proxy token, look up the real access token
				try {
					const id = c.env.USER_TOKEN_STORE.idFromName('proxy_lookup')
					const stub = c.env.USER_TOKEN_STORE.get(id)

					const lookupRequest: TokenStoreRequest = {
						action: 'findByProxyToken',
						proxyToken: token,
					}

					const lookupResponse = await stub.fetch('http://do/lookup', {
						method: 'POST',
						body: JSON.stringify(lookupRequest),
					})

					const lookupData = (await lookupResponse.json()) as TokenStoreResponse

					if (lookupData.success && lookupData.data) {
						// Use the real access token
						esiHeaders.set('Authorization', `Bearer ${lookupData.data.accessToken}`)

						logger
							.withTags({
								type: 'proxy_token_used',
								character_id: lookupData.data.characterId,
							})
							.info('Using proxy token for authenticated request', {
								characterId: lookupData.data.characterId,
								characterName: lookupData.data.characterName,
								path,
								request: getRequestLogData(c, Date.now()),
							})
					} else {
						// Invalid proxy token
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
				} catch (error) {
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
			} else {
				// This is a regular bearer token, pass it through
				esiHeaders.set('Authorization', authorization)
			}
		}

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

export default app

// Export Durable Object
export { UserTokenStore } from './user-token-store'
