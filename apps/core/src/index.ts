import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
import type { EveSSO } from '@repo/evesso'
import {
	getRequestLogData,
	logger,
	withNotFound,
	withOnError,
} from '@repo/hono-helpers'
import type { SessionStore } from '@repo/session-store'
import { withStaticAuth } from '@repo/static-auth'
import type { TagStore } from '@repo/tag-store'

import { OIDCClient } from './oidc-client'
import dashboardHtml from './templates/dashboard.html?raw'
import landingHtml from './templates/landing.html?raw'

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

	.get('/', async (c) => {
		return c.html(landingHtml)
	})

	// Dashboard page
	.get('/dashboard', async (c) => {
		return c.html(dashboardHtml)
	})

	// Verify session and get user info
	.post('/api/session/verify', async (c) => {
		const sessionId = getCookie(c, 'session_id')

		if (!sessionId) {
			return c.json({ error: 'Not authenticated' }, 401)
		}

		try {
			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			const sessionInfo = await stub.getSession(sessionId)

			// Get social user to check admin status
			const socialUser = await stub.getSocialUser(sessionInfo.socialUserId)

			return c.json({
				success: true,
				session: {
					socialUserId: sessionInfo.socialUserId,
					provider: sessionInfo.provider,
					email: sessionInfo.email,
					name: sessionInfo.name,
					expiresAt: sessionInfo.expiresAt,
					isAdmin: socialUser?.isAdmin ?? false,
				},
			})
		} catch (error) {
			logger.error('Session verify error', { error: String(error) })
			return c.json(
				{ error: String(error) },
				error instanceof Error && error.message === 'Session not found' ? 404 : 500
			)
		}
	})

	// Refresh session token
	.post('/api/session/refresh', async (c) => {
		const sessionId = getCookie(c, 'session_id')

		if (!sessionId) {
			return c.json({ error: 'Not authenticated' }, 401)
		}

		try {
			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			const sessionInfo = await stub.refreshSession(sessionId)

			return c.json({
				success: true,
				session: {
					provider: sessionInfo.provider,
					email: sessionInfo.email,
					name: sessionInfo.name,
					accessToken: sessionInfo.accessToken,
					expiresAt: sessionInfo.expiresAt,
				},
			})
		} catch (error) {
			logger.error('Session refresh error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Delete session (logout)
	.delete('/api/session', async (c) => {
		const sessionId = getCookie(c, 'session_id')

		if (!sessionId) {
			return c.json({ error: 'Not authenticated' }, 401)
		}

		try {
			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			await stub.deleteSession(sessionId)

			// Delete the session cookie
			deleteCookie(c, 'session_id')

			return c.json({ success: true })
		} catch (error) {
			logger.error('Session delete error', { error: String(error) })
			return c.json(
				{ error: String(error) },
				error instanceof Error && error.message === 'Session not found' ? 404 : 500
			)
		}
	})

	// ========== Account Claiming Endpoints ==========

	// Initiate account claim flow
	.post('/claim/initiate', async (c) => {
		const sessionId = getCookie(c, 'session_id')

		if (!sessionId) {
			return c.json({ error: 'Not authenticated' }, 401)
		}

		try {
			// Verify environment variables are set
			if (
				!c.env.TEST_AUTH_OIDC_ISSUER ||
				!c.env.TEST_AUTH_CLIENT_ID ||
				!c.env.TEST_AUTH_CLIENT_SECRET ||
				!c.env.TEST_AUTH_CALLBACK_URL
			) {
				logger.error('Missing OIDC configuration', {
					hasIssuer: !!c.env.TEST_AUTH_OIDC_ISSUER,
					hasClientId: !!c.env.TEST_AUTH_CLIENT_ID,
					hasClientSecret: !!c.env.TEST_AUTH_CLIENT_SECRET,
					hasCallbackUrl: !!c.env.TEST_AUTH_CALLBACK_URL,
				})
				return c.json({ error: 'OIDC configuration not set. Please contact administrator.' }, 500)
			}

			// Verify session exists
			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			await stub.getSession(sessionId)

			// Create OIDC state linked to this session
			const state = await stub.createOIDCState(sessionId)

			// Create OIDC client
			const oidcClient = new OIDCClient(
				c.env.TEST_AUTH_OIDC_ISSUER,
				c.env.TEST_AUTH_CLIENT_ID,
				c.env.TEST_AUTH_CLIENT_SECRET,
				c.env.TEST_AUTH_CALLBACK_URL
			)

			// Generate authorization URL
			const authUrl = await oidcClient.generateAuthorizationUrl(state)

			logger
				.withTags({
					type: 'claim_initiate',
				})
				.info('Initiating account claim flow', {
					sessionId: sessionId.substring(0, 8) + '...',
					state: state.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
				authUrl,
			})
		} catch (error) {
			logger.error('Claim initiate error', { error: String(error) })
			return c.json(
				{ error: String(error) },
				error instanceof Error && error.message === 'Session not found' ? 404 : 500
			)
		}
	})

	// Handle account claim callback
	.get('/claim/callback', async (c) => {
		const code = c.req.query('code')
		const state = c.req.query('state')
		const error = c.req.query('error')

		if (error) {
			logger
				.withTags({
					type: 'claim_callback_error',
				})
				.error('OIDC callback error', {
					error,
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: `OIDC error: ${error}` }, 400)
		}

		if (!code || !state) {
			return c.json({ error: 'Missing code or state' }, 400)
		}

		try {
			// Verify environment variables are set
			if (
				!c.env.TEST_AUTH_OIDC_ISSUER ||
				!c.env.TEST_AUTH_CLIENT_ID ||
				!c.env.TEST_AUTH_CLIENT_SECRET ||
				!c.env.TEST_AUTH_CALLBACK_URL
			) {
				logger.error('Missing OIDC configuration in callback', {
					hasIssuer: !!c.env.TEST_AUTH_OIDC_ISSUER,
					hasClientId: !!c.env.TEST_AUTH_CLIENT_ID,
					hasClientSecret: !!c.env.TEST_AUTH_CLIENT_SECRET,
					hasCallbackUrl: !!c.env.TEST_AUTH_CALLBACK_URL,
				})
				return c.json({ error: 'OIDC configuration not set. Please contact administrator.' }, 500)
			}

			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Validate state and get session ID
			const sessionId = await stub.validateOIDCState(state)

			// Get session info to link the account
			const session = await stub.getSession(sessionId)

			// Create OIDC client
			const oidcClient = new OIDCClient(
				c.env.TEST_AUTH_OIDC_ISSUER,
				c.env.TEST_AUTH_CLIENT_ID,
				c.env.TEST_AUTH_CLIENT_SECRET,
				c.env.TEST_AUTH_CALLBACK_URL
			)

			// Exchange code for tokens
			const tokens = await oidcClient.exchangeCodeForTokens(code)

			// Get user info from test auth
			const userInfo = await oidcClient.getUserInfo(tokens.access_token)

			// Extract legacy account claims
			const legacyUsername =
				userInfo.auth_username || userInfo.preferred_username || userInfo.email || userInfo.sub
			const superuser = userInfo.superuser ?? false
			const staff = userInfo.staff ?? false
			const active = userInfo.active ?? false
			const primaryCharacter = userInfo.primary_character || ''
			const primaryCharacterId = String(userInfo.primary_character_id || '')
			const groups = userInfo.groups || []

			// Create account link
			const link = await stub.createAccountLink(
				session.socialUserId,
				'test-auth',
				userInfo.sub,
				legacyUsername,
				superuser,
				staff,
				active,
				primaryCharacter,
				primaryCharacterId,
				groups
			)

			logger
				.withTags({
					type: 'claim_success',
				})
				.info('Account claim completed', {
					linkId: link.linkId,
					socialUserId: link.socialUserId.substring(0, 8) + '...',
					legacySystem: link.legacySystem,
					legacyUserId: link.legacyUserId,
					request: getRequestLogData(c, Date.now()),
				})

			return c.html(`
				<!DOCTYPE html>
				<html>
					<head>
						<meta charset="utf-8">
						<meta name="viewport" content="width=device-width, initial-scale=1">
						<title>Account Claimed Successfully</title>
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
								max-width: 600px;
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
							.legacy-username {
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
							<h1>Account Linked Successfully</h1>
							<p>Your legacy account <span class="legacy-username" id="legacyUsername"></span> has been linked!</p>
							<p>Redirecting to your dashboard...</p>
						</div>
						<script>
							// Mask username by default
							function maskUsername(username) {
								if (username.length <= 3) return '***';
								return username.substring(0, 2) + '***' + username[username.length - 1];
							}

							const username = '${link.legacyUsername}';
							const maskingEnabled = localStorage.getItem('maskingEnabled') !== 'false';
							document.getElementById('legacyUsername').textContent = maskingEnabled ? maskUsername(username) : username;

							setTimeout(() => {
								window.location.href = '/dashboard';
							}, 1500);
						</script>
					</body>
				</html>
			`)
		} catch (error) {
			logger
				.withTags({
					type: 'claim_exception',
				})
				.error('Claim callback exception', {
					error: String(error),
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: String(error) }, 500)
		}
	})

	// Get account links for current session
	.post('/api/account/links', async (c) => {
		const sessionId = getCookie(c, 'session_id')

		if (!sessionId) {
			return c.json({ error: 'Not authenticated' }, 401)
		}

		try {
			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Get session info
			const session = await stub.getSession(sessionId)

			// Get all account links for this social user
			const links = await stub.getAccountLinksBySocialUser(session.socialUserId)

			return c.json({
				success: true,
				links: links.map((link) => ({
					linkId: link.linkId,
					legacySystem: link.legacySystem,
					legacyUserId: link.legacyUserId,
					legacyUsername: link.legacyUsername,
					superuser: link.superuser,
					staff: link.staff,
					active: link.active,
					primaryCharacter: link.primaryCharacter,
					primaryCharacterId: link.primaryCharacterId,
					groups: link.groups,
					linkedAt: link.linkedAt,
					updatedAt: link.updatedAt,
				})),
			})
		} catch (error) {
			logger.error('Get account links error', { error: String(error) })
			return c.json(
				{ error: String(error) },
				error instanceof Error && error.message === 'Session not found' ? 404 : 500
			)
		}
	})

	// Check if a specific character is linked (internal API for ESI worker)
	.get('/api/characters/:characterId/link', async (c) => {
		const characterId = Number(c.req.param('characterId'))

		if (Number.isNaN(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}

		try {
			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			const link = await stub.getCharacterLinkByCharacterId(characterId)

			if (!link) {
				return c.json({ error: 'Character not linked' }, 404)
			}

			return c.json({
				socialUserId: link.socialUserId,
				linkId: link.linkId,
			})
		} catch (error) {
			logger.error('Get character link error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Create character link (internal API for ESI worker)
	.post('/api/characters/link', async (c) => {
		const sessionId = getCookie(c, 'session_id')

		if (!sessionId) {
			return c.json({ error: 'Not authenticated' }, 401)
		}

		try {
			const body = (await c.req.json()) as {
				characterId: number
				characterName: string
				corporationId?: number
				corporationName?: string
				allianceId?: number | null
				allianceName?: string | null
			}

			if (!body.characterId || !body.characterName) {
				return c.json({ error: 'Missing characterId or characterName' }, 400)
			}

			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Get session to get social user ID
			const session = await stub.getSession(sessionId)

			// Create character link
			const link = await stub.createCharacterLink(
				session.socialUserId,
				body.characterId,
				body.characterName
			)

			// Notify tags service if corporation/alliance info is provided
			if (body.corporationId && body.corporationName) {
				try {
					const tagStoreStub = getStub<TagStore>(c.env.TAG_STORE, 'global')

					// Create/update corporation tag
					const corpUrn = `urn:eve:corporation:${body.corporationId}`
					await tagStoreStub.upsertTag(
						corpUrn,
						'corporation',
						body.corporationName,
						body.corporationId,
						{
							corporationId: body.corporationId,
						}
					)

					// Assign corporation tag to user
					await tagStoreStub.assignTagToUser(session.socialUserId, corpUrn, body.characterId)

					// Create/update alliance tag if applicable
					if (body.allianceId && body.allianceName) {
						const allianceUrn = `urn:eve:alliance:${body.allianceId}`
						await tagStoreStub.upsertTag(
							allianceUrn,
							'alliance',
							body.allianceName,
							body.allianceId,
							{
								allianceId: body.allianceId,
							}
						)

						// Assign alliance tag to user
						await tagStoreStub.assignTagToUser(session.socialUserId, allianceUrn, body.characterId)
					}

					// Schedule first evaluation in 1 hour
					await tagStoreStub.scheduleUserEvaluation(session.socialUserId)

					logger.info('Notified tags service of character onboarding', {
						characterId: body.characterId,
						socialUserId: session.socialUserId.substring(0, 8) + '...',
					})
				} catch (tagsError) {
					// Don't fail the character link if tags notification fails
					logger.error('Failed to notify tags service', {
						error: String(tagsError),
						characterId: body.characterId,
					})
				}
			}

			return c.json({
				success: true,
				link: {
					linkId: link.linkId,
					characterId: link.characterId,
					characterName: link.characterName,
					linkedAt: link.linkedAt,
				},
			})
		} catch (error) {
			logger.error('Create character link error', { error: String(error) })
			return c.json(
				{ error: String(error) },
				error instanceof Error && error.message.includes('already linked') ? 409 : 500
			)
		}
	})

	// Search characters by name
	.get('/api/characters/search', async (c) => {
		const sessionId = getCookie(c, 'session_id')

		if (!sessionId) {
			return c.json({ error: 'Not authenticated' }, 401)
		}

		const query = c.req.query('q')

		if (!query || query.trim().length < 2) {
			return c.json({ error: 'Search query must be at least 2 characters' }, 400)
		}

		try {
			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Search character links by name (case-insensitive)
			const characters = await stub.searchCharactersByName(query.trim())

			// Fetch corporation info for each character
			const cache = caches.default
			const enrichedCharacters = await Promise.all(
				characters.map(async (char: any) => {
					let corporationId: number | undefined
					let corporationName: string | undefined

					try {
						// Fetch character info with cache
						const charUrl = `https://esi.evetech.net/latest/characters/${char.characterId}/?datasource=tranquility`
						const charCacheKey = new Request(charUrl)

						let charResponse = await cache.match(charCacheKey)
						if (!charResponse) {
							charResponse = await fetch(charUrl)
							if (charResponse.ok) {
								const clonedResponse = charResponse.clone()
								const headers = new Headers(clonedResponse.headers)
								headers.set('Cache-Control', 'public, max-age=3600')
								const cachedCharResponse = new Response(clonedResponse.body, {
									status: clonedResponse.status,
									statusText: clonedResponse.statusText,
									headers,
								})
								c.executionCtx.waitUntil(cache.put(charCacheKey, cachedCharResponse))
							}
						}

						if (charResponse.ok) {
							const charData = (await charResponse.json()) as { corporation_id: number }
							corporationId = charData.corporation_id

							// Fetch corporation name with cache
							const corpUrl = `https://esi.evetech.net/latest/corporations/${corporationId}/?datasource=tranquility`
							const corpCacheKey = new Request(corpUrl)

							let corpResponse = await cache.match(corpCacheKey)
							if (!corpResponse) {
								corpResponse = await fetch(corpUrl)
								if (corpResponse.ok) {
									const clonedResponse = corpResponse.clone()
									const headers = new Headers(clonedResponse.headers)
									headers.set('Cache-Control', 'public, max-age=3600')
									const cachedCorpResponse = new Response(clonedResponse.body, {
										status: clonedResponse.status,
										statusText: clonedResponse.statusText,
										headers,
									})
									c.executionCtx.waitUntil(cache.put(corpCacheKey, cachedCorpResponse))
								}
							}

							if (corpResponse.ok) {
								const corpData = (await corpResponse.json()) as { name: string }
								corporationName = corpData.name
							}
						}
					} catch (error) {
						logger.warn('Failed to fetch corporation info for search result', {
							error: String(error),
							characterId: char.characterId,
						})
					}

					return {
						socialUserId: char.socialUserId,
						characterId: char.characterId,
						characterName: char.characterName,
						corporationId,
						corporationName,
					}
				})
			)

			return c.json({
				success: true,
				characters: enrichedCharacters,
			})
		} catch (error) {
			logger.error('Character search error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Get character links for current session
	.get('/api/characters', async (c) => {
		const sessionId = getCookie(c, 'session_id')

		if (!sessionId) {
			return c.json({ error: 'Not authenticated' }, 401)
		}

		try {
			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Get session info
			const session = await stub.getSession(sessionId)

			// Get all character links for this social user
			const characters = await stub.getCharacterLinksBySocialUser(session.socialUserId)

			return c.json({
				success: true,
				characters: characters.map((char) => ({
					linkId: char.linkId,
					characterId: char.characterId,
					characterName: char.characterName,
					isPrimary: char.isPrimary,
					linkedAt: char.linkedAt,
					updatedAt: char.updatedAt,
				})),
			})
		} catch (error) {
			logger.error('Get character links error', { error: String(error) })
			return c.json(
				{ error: String(error) },
				error instanceof Error && error.message === 'Session not found' ? 404 : 500
			)
		}
	})

	// Set primary character
	.put('/api/characters/:characterId/primary', async (c) => {
		const sessionId = getCookie(c, 'session_id')

		if (!sessionId) {
			return c.json({ error: 'Not authenticated' }, 401)
		}

		const characterId = Number(c.req.param('characterId'))

		if (Number.isNaN(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}

		try {
			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Get session info
			const session = await stub.getSession(sessionId)

			// Set primary character
			await stub.setPrimaryCharacter(session.socialUserId, characterId)

			// Invalidate cache for this user's primary character
			const cacheKey = new Request(
				`http://internal/api/users/${session.socialUserId}/primary-character`,
				c.req.raw
			)
			const cache = caches.default
			c.executionCtx.waitUntil(cache.delete(cacheKey))

			logger
				.withTags({
					type: 'primary_character_cache_invalidated',
				})
				.info('Invalidated primary character cache', {
					socialUserId: session.socialUserId.substring(0, 8) + '...',
					characterId,
				})

			return c.json({
				success: true,
			})
		} catch (error) {
			logger.error('Set primary character error', { error: String(error) })
			return c.json(
				{ error: String(error) },
				error instanceof Error && error.message === 'Session not found' ? 404 : 500
			)
		}
	})

	// Refresh character data
	.post('/api/characters/:characterId/refresh', async (c) => {
		const sessionId = getCookie(c, 'session_id')

		if (!sessionId) {
			return c.json({ error: 'Not authenticated' }, 401)
		}

		const characterId = Number(c.req.param('characterId'))

		if (Number.isNaN(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}

		try {
			const sessionStoreStub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Get session info
			const session = await sessionStoreStub.getSession(sessionId)

			// Verify the character belongs to this user
			const characterLink = await sessionStoreStub.getCharacterLinkByCharacterId(characterId)

			if (!characterLink || characterLink.socialUserId !== session.socialUserId) {
				return c.json({ error: 'Character not found or does not belong to you' }, 403)
			}

			// Call the UserTokenStore Durable Object directly to refresh the character's access token
			// This will automatically trigger a refresh if the token is expired
			const tokenStoreStub = getStub<EveSSO>(c.env.EVESSO_STORE, 'global')

			const tokenInfo = await tokenStoreStub.getAccessToken(characterId)

			logger
				.withTags({
					type: 'character_refresh_requested',
				})
				.info('Character refresh requested', {
					characterId,
					characterName: tokenInfo.characterName,
					socialUserId: session.socialUserId.substring(0, 8) + '...',
					tokenExpiresAt: new Date(tokenInfo.expiresAt).toISOString(),
				})

			return c.json({
				success: true,
				message: 'Character data refresh initiated',
				characterName: tokenInfo.characterName,
				tokenExpiresAt: tokenInfo.expiresAt,
			})
		} catch (error) {
			logger.error('Character refresh error', { error: String(error), characterId })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Get primary character name for a social user ID (privacy-limited endpoint)
	.get('/api/users/:socialUserId/primary-character', async (c) => {
		const socialUserId = c.req.param('socialUserId')

		if (!socialUserId) {
			return c.json({ error: 'Invalid social user ID' }, 400)
		}

		try {
			// Check cache first (keyed by socialUserId)
			const cacheKey = new Request(
				`http://internal/api/users/${socialUserId}/primary-character`,
				c.req.raw
			)
			const cache = caches.default
			const cachedResponse = await cache.match(cacheKey)

			if (cachedResponse) {
				return cachedResponse
			}

			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Get all character links for this social user
			const characters = await stub.getCharacterLinksBySocialUser(socialUserId)

			// Find the primary character
			const primaryCharacter = characters.find((char) => char.isPrimary)

			if (!primaryCharacter) {
				return c.json({ error: 'No primary character found' }, 404)
			}

			// Fetch corporation information from ESI (with caching)
			let corporationId: number | undefined
			let corporationName: string | undefined

			try {
				// Fetch character info with cache
				const charUrl = `https://esi.evetech.net/latest/characters/${primaryCharacter.characterId}/?datasource=tranquility`
				const charCacheKey = new Request(charUrl)
				const cache = caches.default

				let charResponse = await cache.match(charCacheKey)
				if (!charResponse) {
					charResponse = await fetch(charUrl)
					if (charResponse.ok) {
						// Cache for 1 hour
						const clonedResponse = charResponse.clone()
						const headers = new Headers(clonedResponse.headers)
						headers.set('Cache-Control', 'public, max-age=3600')
						const cachedCharResponse = new Response(clonedResponse.body, {
							status: clonedResponse.status,
							statusText: clonedResponse.statusText,
							headers,
						})
						c.executionCtx.waitUntil(cache.put(charCacheKey, cachedCharResponse))
					}
				}

				if (charResponse.ok) {
					const charData = (await charResponse.json()) as { corporation_id: number }
					corporationId = charData.corporation_id

					// Fetch corporation name with cache
					const corpUrl = `https://esi.evetech.net/latest/corporations/${corporationId}/?datasource=tranquility`
					const corpCacheKey = new Request(corpUrl)

					let corpResponse = await cache.match(corpCacheKey)
					if (!corpResponse) {
						corpResponse = await fetch(corpUrl)
						if (corpResponse.ok) {
							// Cache for 1 hour
							const clonedResponse = corpResponse.clone()
							const headers = new Headers(clonedResponse.headers)
							headers.set('Cache-Control', 'public, max-age=3600')
							const cachedCorpResponse = new Response(clonedResponse.body, {
								status: clonedResponse.status,
								statusText: clonedResponse.statusText,
								headers,
							})
							c.executionCtx.waitUntil(cache.put(corpCacheKey, cachedCorpResponse))
						}
					}

					if (corpResponse.ok) {
						const corpData = (await corpResponse.json()) as { name: string }
						corporationName = corpData.name
					}
				}
			} catch (error) {
				logger.warn('Failed to fetch corporation info', {
					error: String(error),
					characterId: primaryCharacter.characterId,
				})
			}

			// Create response with cache headers
			const response = c.json({
				success: true,
				characterName: primaryCharacter.characterName,
				characterId: primaryCharacter.characterId,
				corporationId,
				corporationName,
			})

			// Clone response for caching
			const responseToCache = response.clone()

			// Add cache headers
			const headers = new Headers(responseToCache.headers)
			headers.set('Cache-Control', 'public, max-age=3600') // Cache for 1 hour
			headers.set('CDN-Cache-Control', 'public, max-age=86400') // Cache on CDN for 24 hours

			const cachedResponseToStore = new Response(responseToCache.body, {
				status: responseToCache.status,
				statusText: responseToCache.statusText,
				headers,
			})

			// Put in cache (don't await to avoid blocking the response)
			c.executionCtx.waitUntil(cache.put(cacheKey, cachedResponseToStore))

			return response
		} catch (error) {
			logger.error('Get primary character error', { error: String(error), socialUserId })
			return c.json({ error: 'Failed to get primary character' }, 500)
		}
	})

	// Proxy character portrait images with caching
	.get('/api/characters/:characterId/portrait', async (c) => {
		const characterId = c.req.param('characterId')

		if (!characterId || !/^\d+$/.test(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}

		try {
			const portraitUrl = `https://images.evetech.net/characters/${characterId}/portrait`
			const cacheKey = new Request(portraitUrl, c.req.raw)

			// Check Cloudflare cache first
			const cache = caches.default
			let response = await cache.match(cacheKey)

			if (!response) {
				// Fetch from EVE Tech if not in cache
				response = await fetch(portraitUrl)

				if (response.ok) {
					// Clone the response to cache it
					const responseToCache = response.clone()

					// Add cache headers and cache the response
					const headers = new Headers(responseToCache.headers)
					headers.set('Cache-Control', 'public, max-age=86400') // Cache for 24 hours
					headers.set('CDN-Cache-Control', 'public, max-age=2592000') // Cache on CDN for 30 days

					const cachedResponse = new Response(responseToCache.body, {
						status: responseToCache.status,
						statusText: responseToCache.statusText,
						headers,
					})

					// Put in cache (don't await to avoid blocking the response)
					c.executionCtx.waitUntil(cache.put(cacheKey, cachedResponse.clone()))

					return cachedResponse
				}

				return response
			}

			return response
		} catch (error) {
			logger.error('Character portrait proxy error', { error: String(error), characterId })
			return c.json({ error: 'Failed to fetch portrait' }, 502)
		}
	})

	// ========== Provider Linking Endpoints ==========

	// Get provider links for current session
	.get('/api/provider/links', async (c) => {
		const sessionId = getCookie(c, 'session_id')

		if (!sessionId) {
			return c.json({ error: 'Not authenticated' }, 401)
		}

		try {
			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Get session info
			const session = await stub.getSession(sessionId)

			// Get all provider links for this social user
			const providerLinks = await stub.getProviderLinksBySocialUser(session.socialUserId)

			return c.json({
				success: true,
				providerLinks: providerLinks.map((link) => ({
					linkId: link.linkId,
					provider: link.provider,
					providerUserId: link.providerUserId,
					providerUsername: link.providerUsername,
					linkedAt: link.linkedAt,
					updatedAt: link.updatedAt,
				})),
			})
		} catch (error) {
			logger.error('Get provider links error', { error: String(error) })
			return c.json(
				{ error: String(error) },
				error instanceof Error && error.message === 'Session not found' ? 404 : 500
			)
		}
	})

	// ========== Admin Endpoints (Protected) ==========
	.use('/admin/*', (c, next) =>
		withStaticAuth({
			tokens: c.env.ADMIN_API_TOKENS,
			logTag: 'admin_auth',
		})(c, next)
	)

	// Admin endpoint to revoke account link
	.delete('/admin/account/links/:linkId', async (c) => {
		const linkId = c.req.param('linkId')

		try {
			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Delete the account link
			await stub.deleteAccountLink(linkId)

			logger
				.withTags({
					type: 'account_link_revoked',
				})
				.info('Account link revoked by admin', {
					linkId,
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({ success: true })
		} catch (error) {
			logger.error('Delete account link error', { error: String(error) })
			return c.json(
				{ error: String(error) },
				error instanceof Error && error.message === 'Account link not found' ? 404 : 500
			)
		}
	})

	// Admin endpoint to revoke character link
	.delete('/admin/characters/:characterId', async (c) => {
		const characterId = Number(c.req.param('characterId'))

		if (Number.isNaN(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}

		try {
			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Delete the character link
			await stub.deleteCharacterLink(characterId)

			logger
				.withTags({
					type: 'character_link_revoked',
				})
				.info('Character link revoked by admin', {
					characterId,
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({ success: true })
		} catch (error) {
			logger.error('Delete character link error', { error: String(error) })
			return c.json(
				{ error: String(error) },
				error instanceof Error && error.message === 'Character link not found' ? 404 : 500
			)
		}
	})

	// Admin endpoint to list all characters for a social user ID
	.get('/admin/characters', async (c) => {
		const socialUserId = c.req.query('socialUserId')

		if (!socialUserId) {
			return c.json({ error: 'socialUserId query parameter is required' }, 400)
		}

		try {
			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Get all character links for this social user
			const characters = await stub.getCharacterLinksBySocialUser(socialUserId)

			logger
				.withTags({
					type: 'admin_characters_list',
				})
				.info('Admin listed characters for social user', {
					socialUserId: socialUserId.substring(0, 8) + '...',
					characterCount: characters.length,
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
				socialUserId,
				characters: characters.map((char) => ({
					linkId: char.linkId,
					characterId: char.characterId,
					characterName: char.characterName,
					linkedAt: char.linkedAt,
					updatedAt: char.updatedAt,
				})),
			})
		} catch (error) {
			logger.error('List characters for social user error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Admin endpoint to list all sessions
	.get('/admin/sessions', async (c) => {
		const limit = Number(c.req.query('limit')) || 50
		const offset = Number(c.req.query('offset')) || 0

		try {
			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			const result = await stub.listSessions(limit, offset)

			return c.json({
				success: true,
				total: result.total,
				limit: result.limit,
				offset: result.offset,
				sessions: result.results,
			})
		} catch (error) {
			logger.error('List sessions error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Admin endpoint to get stats
	.get('/admin/stats', async (c) => {
		try {
			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			const stats = await stub.getStats()

			return c.json({
				success: true,
				stats,
			})
		} catch (error) {
			logger.error('Get stats error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

export default app
