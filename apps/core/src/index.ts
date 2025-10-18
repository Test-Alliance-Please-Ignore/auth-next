import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
import { getRequestLogData, logger, withNotFound, withOnError } from '@repo/hono-helpers'
import { withStaticAuth } from '@repo/static-auth'

import { OIDCClient } from './oidc-client'
import characterProfileHtml from './templates/character-profile.html?raw'
import dashboardHtml from './templates/dashboard.html?raw'
import landingHtml from './templates/landing.html?raw'

import type { CharacterDataStore } from '@repo/character-data-store'
import type { EveUniverse } from '@repo/eve-universe'
import type { EveSSO } from '@repo/evesso'
import type { SessionStore } from '@repo/session-store'
import type { TagStore } from '@repo/tag-store'
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

	// Character profile page
	.get('/character', async (c) => {
		return c.html(characterProfileHtml)
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

			// Get root user to check admin status
			const rootUser = await stub.getRootUser(sessionInfo.rootUserId)

			return c.json({
				success: true,
				session: {
					rootUserId: sessionInfo.rootUserId,
					provider: sessionInfo.provider,
					email: sessionInfo.email,
					name: sessionInfo.name,
					expiresAt: sessionInfo.expiresAt,
					isAdmin: rootUser?.isAdmin ?? false,
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
				session.rootUserId,
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
					rootUserId: link.rootUserId.substring(0, 8) + '...',
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
							const username = '${link.legacyUsername}';
							document.getElementById('legacyUsername').textContent = username;

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

			// Get all account links for this root user
			const links = await stub.getAccountLinksByRootUser(session.rootUserId)

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
				rootUserId: link.rootUserId,
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
				corporationTicker?: string
				allianceId?: number | null
				allianceName?: string | null
				allianceTicker?: string | null
			}

			if (!body.characterId || !body.characterName) {
				return c.json({ error: 'Missing characterId or characterName' }, 400)
			}

			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Get session to get root user ID
			const session = await stub.getSession(sessionId)

			// Create character link
			const link = await stub.createCharacterLink(
				session.rootUserId,
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
							...(body.corporationTicker && { ticker: body.corporationTicker }),
						}
					)

					// Assign corporation tag to user
					await tagStoreStub.assignTagToUser(session.rootUserId, corpUrn, body.characterId)

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
								...(body.allianceTicker && { ticker: body.allianceTicker }),
							}
						)

						// Assign alliance tag to user
						await tagStoreStub.assignTagToUser(session.rootUserId, allianceUrn, body.characterId)
					}

					// Schedule first evaluation in 1 hour
					await tagStoreStub.scheduleUserEvaluation(session.rootUserId)

					logger.info('Notified tags service of character onboarding', {
						characterId: body.characterId,
						rootUserId: session.rootUserId.substring(0, 8) + '...',
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
						rootUserId: char.rootUserId,
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

			// Get all character links for this root user
			const characters = await stub.getCharacterLinksByRootUser(session.rootUserId)

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
			await stub.setPrimaryCharacter(session.rootUserId, characterId)

			// Invalidate cache for this user's primary character
			const cacheKey = new Request(
				`http://internal/api/users/${session.rootUserId}/primary-character`,
				c.req.raw
			)
			const cache = caches.default
			c.executionCtx.waitUntil(cache.delete(cacheKey))

			logger
				.withTags({
					type: 'primary_character_cache_invalidated',
				})
				.info('Invalidated primary character cache', {
					rootUserId: session.rootUserId.substring(0, 8) + '...',
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

			if (!characterLink || characterLink.rootUserId !== session.rootUserId) {
				return c.json({ error: 'Character not found or does not belong to you' }, 403)
			}

			// Get the access token (this will refresh it if needed)
			const tokenStoreStub = getStub<EveSSO>(c.env.EVESSO_STORE, 'global')
			const tokenInfo = await tokenStoreStub.getAccessToken(characterId)

			// Import ESI client functions
			const { fetchCharacterInfo, fetchCharacterSkills, fetchCharacterSkillQueue } = await import(
				'../../esi/src/esi-client'
			)

			// Fetch character data from ESI
			const charResult = await fetchCharacterInfo(characterId, tokenInfo.accessToken)

			// Update CharacterDataStore with the fetched data (this will trigger tag upserts)
			const dataStoreStub = getStub<CharacterDataStore>(c.env.CHARACTER_DATA_STORE, 'global')
			await dataStoreStub.upsertCharacter(characterId, charResult.data, charResult.expiresAt)

			// Fetch and store character skills
			try {
				const skillsResult = await fetchCharacterSkills(characterId, tokenInfo.accessToken)
				await dataStoreStub.upsertCharacterSkills(
					characterId,
					skillsResult.data,
					skillsResult.expiresAt
				)
			} catch (skillsError) {
				logger.error('Failed to fetch skills during refresh', {
					characterId,
					error: String(skillsError),
				})
			}

			// Fetch and store character skillqueue
			try {
				const skillqueueResult = await fetchCharacterSkillQueue(characterId, tokenInfo.accessToken)
				await dataStoreStub.upsertCharacterSkillQueue(characterId, skillqueueResult.data)
			} catch (skillqueueError) {
				logger.error('Failed to fetch skillqueue during refresh', {
					characterId,
					error: String(skillqueueError),
				})
			}

			logger
				.withTags({
					type: 'character_refresh_requested',
				})
				.info('Character refresh completed', {
					characterId,
					characterName: tokenInfo.characterName,
					rootUserId: session.rootUserId.substring(0, 8) + '...',
					corporationId: charResult.data.corporation_id,
					allianceId: charResult.data.alliance_id,
				})

			return c.json({
				success: true,
				message: 'Character data refreshed successfully',
				characterName: tokenInfo.characterName,
				tokenExpiresAt: tokenInfo.expiresAt,
			})
		} catch (error) {
			logger.error('Character refresh error', { error: String(error), characterId })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Get primary character name for a root user ID (privacy-limited endpoint)
	.get('/api/users/:rootUserId/primary-character', async (c) => {
		const rootUserId = c.req.param('rootUserId')

		if (!rootUserId) {
			return c.json({ error: 'Invalid root user ID' }, 400)
		}

		try {
			// Check cache first (keyed by rootUserId)
			const cacheKey = new Request(
				`http://internal/api/users/${rootUserId}/primary-character`,
				c.req.raw
			)
			const cache = caches.default
			const cachedResponse = await cache.match(cacheKey)

			if (cachedResponse) {
				return cachedResponse
			}

			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Get all character links for this root user
			const characters = await stub.getCharacterLinksByRootUser(rootUserId)

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
			logger.error('Get primary character error', { error: String(error), rootUserId })
			return c.json({ error: 'Failed to get primary character' }, 500)
		}
	})

	// Get detailed character information
	.get('/api/characters/:characterId', async (c) => {
		const sessionId = getCookie(c, 'session_id')
		if (!sessionId) {
			return c.json({ error: 'Not authenticated' }, 401)
		}

		const characterId = Number(c.req.param('characterId'))
		if (Number.isNaN(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}

		try {
			const sessionStub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')
			const session = await sessionStub.getSession(sessionId)

			// Check if user owns this character
			const characterLink = await sessionStub.getCharacterLinkByCharacterId(characterId)
			const isOwner = characterLink && characterLink.rootUserId === session.rootUserId

			// Get character data from CharacterDataStore
			const dataStoreStub = getStub<CharacterDataStore>(c.env.CHARACTER_DATA_STORE, 'global')
			const characterData = await dataStoreStub.getCharacter(characterId)

			if (!characterData) {
				return c.json({ error: 'Character not found' }, 404)
			}

			// Get corporation data
			const corporationData = await dataStoreStub.getCorporation(characterData.corporation_id)

			// Get alliance name if character is in an alliance
			let allianceName: string | null = null
			let allianceTicker: string | null = null

			if (characterData.alliance_id) {
				// First try to get from EveUniverse cache (which might have the name already)
				const eveUniverseStub = c.env.EVE_UNIVERSE
					? getStub<EveUniverse>(c.env.EVE_UNIVERSE, 'global')
					: null
				if (eveUniverseStub) {
					try {
						const names = await eveUniverseStub.getNames([characterData.alliance_id])
						const allianceNameEntry = names.find((n) => n.id === characterData.alliance_id)
						if (allianceNameEntry) {
							allianceName = allianceNameEntry.name
						}
					} catch (error) {
						logger.error('Failed to fetch alliance name from cache', {
							error: String(error),
							allianceId: characterData.alliance_id,
						})
					}
				}

				// If we don't have the full data (ticker), fetch from ESI
				if (!allianceTicker) {
					try {
						// Use edge cache for alliance data
						const cacheKey = new Request(
							`https://cache.internal/alliance/${characterData.alliance_id}`,
							{
								method: 'GET',
							}
						)
						const cache = caches.default

						// Check cache first
						let cachedResponse = await cache.match(cacheKey)
						let allianceData: { name: string; ticker: string } | null = null

						if (cachedResponse && cachedResponse.ok) {
							allianceData = await cachedResponse.json()
						} else {
							// Fetch from ESI
							const allianceUrl = `https://esi.evetech.net/latest/alliances/${characterData.alliance_id}/`
							const allianceResponse = await fetch(allianceUrl, {
								headers: {
									'X-Compatibility-Date': '2025-09-30',
								},
							})

							if (allianceResponse.ok) {
								allianceData = (await allianceResponse.json()) as { name: string; ticker: string }

								// Cache for 24 hours
								const cacheResponse = new Response(JSON.stringify(allianceData), {
									headers: {
										'Content-Type': 'application/json',
										'Cache-Control': 'public, max-age=86400',
									},
								})
								c.executionCtx.waitUntil(cache.put(cacheKey, cacheResponse))
							}
						}

						if (allianceData) {
							allianceName = allianceData.name
							allianceTicker = allianceData.ticker
						}
					} catch (error) {
						logger.error('Failed to fetch alliance info', {
							error: String(error),
							allianceId: characterData.alliance_id,
						})
					}
				}
			}

			// Build response based on ownership
			const response: any = {
				success: true,
				isOwner,
				character: {
					characterId: characterData.character_id,
					name: characterData.name,
					birthday: characterData.birthday,
					gender: characterData.gender,
					raceId: characterData.race_id,
					bloodlineId: characterData.bloodline_id,
					ancestryId: characterData.ancestry_id,
					description: characterData.description,
					securityStatus: characterData.security_status,
					corporation: corporationData
						? {
								corporationId: corporationData.corporation_id,
								name: corporationData.name,
								ticker: corporationData.ticker,
								memberCount: corporationData.member_count,
								allianceId: corporationData.alliance_id,
							}
						: null,
					allianceId: characterData.alliance_id,
					allianceName: allianceName,
					allianceTicker: allianceTicker,
					lastUpdated: characterData.last_updated,
				},
			}

			// Add sensitive info if owner
			if (isOwner && characterLink) {
				response.character.isPrimary = characterLink.isPrimary
				response.character.linkedAt = characterLink.linkedAt
			}

			return c.json(response)
		} catch (error) {
			logger.error('Get character info error', { error: String(error), characterId })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Get character skills
	.get('/api/characters/:characterId/skills', async (c) => {
		const sessionId = getCookie(c, 'session_id')
		if (!sessionId) {
			return c.json({ error: 'Not authenticated' }, 401)
		}

		const characterId = Number(c.req.param('characterId'))
		if (Number.isNaN(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}

		try {
			// Get character skills from CharacterDataStore
			const dataStoreStub = getStub<CharacterDataStore>(c.env.CHARACTER_DATA_STORE, 'global')
			const skillsData = await dataStoreStub.getCharacterSkills(characterId)

			if (!skillsData) {
				return c.json({ error: 'Skills data not found' }, 404)
			}

			// Get individual skills
			const skills = await dataStoreStub.getSkills(characterId)

			// Get skill queue
			const skillQueue = await dataStoreStub.getSkillQueue(characterId)

			// Get skill names from EveUniverse
			const universeStub = getStub<EveUniverse>(c.env.EVE_UNIVERSE, 'global')
			const allSkillIds = [...skills.map((s) => s.skill_id), ...skillQueue.map((q) => q.skill_id)]
			const uniqueSkillIds = [...new Set(allSkillIds)]
			const skillNames = await universeStub.getNames(uniqueSkillIds)
			const skillNameMap = new Map(skillNames.map((n) => [n.id, n.name]))

			return c.json({
				success: true,
				skills: {
					totalSP: skillsData.total_sp,
					unallocatedSP: skillsData.unallocated_sp,
					lastUpdated: skillsData.last_updated,
					skills: skills.map((s) => ({
						skillId: s.skill_id,
						skillName: skillNameMap.get(s.skill_id) || `Unknown Skill (${s.skill_id})`,
						skillpoints: s.skillpoints_in_skill,
						trainedLevel: s.trained_skill_level,
						activeLevel: s.active_skill_level,
					})),
					skillQueue: skillQueue.map((q) => ({
						skillId: q.skill_id,
						skillName: skillNameMap.get(q.skill_id) || `Unknown Skill (${q.skill_id})`,
						finishedLevel: q.finished_level,
						queuePosition: q.queue_position,
						startDate: q.start_date,
						finishDate: q.finish_date,
						trainingStartSP: q.training_start_sp,
						levelStartSP: q.level_start_sp,
						levelEndSP: q.level_end_sp,
					})),
				},
			})
		} catch (error) {
			logger.error('Get character skills error', { error: String(error), characterId })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Get character history
	.get('/api/characters/:characterId/history', async (c) => {
		const sessionId = getCookie(c, 'session_id')
		if (!sessionId) {
			return c.json({ error: 'Not authenticated' }, 401)
		}

		const characterId = Number(c.req.param('characterId'))
		if (Number.isNaN(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}

		try {
			// Get character corporation history from CharacterDataStore
			const dataStoreStub = getStub<CharacterDataStore>(c.env.CHARACTER_DATA_STORE, 'global')

			// Fetch and store the latest corporation history from ESI
			const corporationHistory = await dataStoreStub.fetchAndStoreCorporationHistory(characterId)

			// Get the universe names for corporations and alliances if available
			const eveUniverseStub = c.env.EVE_UNIVERSE
				? getStub<EveUniverse>(c.env.EVE_UNIVERSE, 'global')
				: null

			// Collect unique IDs that need names
			const corpIds = new Set<number>()
			const allianceIds = new Set<number>()
			corporationHistory.forEach((entry) => {
				if (!entry.is_deleted) {
					corpIds.add(entry.corporation_id)
					if (entry.alliance_id) {
						allianceIds.add(entry.alliance_id)
					}
				}
			})

			// Get names if universe service is available
			let corpNames: Map<number, string> = new Map()
			let allianceNames: Map<number, string> = new Map()
			if (eveUniverseStub && (corpIds.size > 0 || allianceIds.size > 0)) {
				try {
					const allIds = [...corpIds, ...allianceIds]
					const names = await eveUniverseStub.getNames(allIds)
					names.forEach((name) => {
						if (name.category === 'corporation') {
							corpNames.set(name.id, name.name)
						} else if (name.category === 'alliance') {
							allianceNames.set(name.id, name.name)
						}
					})
				} catch (error) {
					logger.error('Failed to fetch names for history', { error: String(error) })
				}
			}

			// Format the history for the UI
			const formattedHistory = corporationHistory.map((entry) => ({
				recordId: entry.record_id,
				corporationId: entry.corporation_id,
				corporationName:
					entry.corporation_name ||
					corpNames.get(entry.corporation_id) ||
					`Corporation ${entry.corporation_id}`,
				corporationTicker: entry.corporation_ticker,
				allianceId: entry.alliance_id,
				allianceName:
					entry.alliance_name ||
					(entry.alliance_id
						? allianceNames.get(entry.alliance_id) || `Alliance ${entry.alliance_id}`
						: null),
				allianceTicker: entry.alliance_ticker,
				startDate: entry.start_date,
				endDate: entry.end_date,
				isDeleted: entry.is_deleted,
			}))

			return c.json({
				success: true,
				history: formattedHistory,
			})
		} catch (error) {
			logger.error('Get character history error', { error: String(error), characterId })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Get character wallet (owner only)
	.get('/api/characters/:characterId/wallet', async (c) => {
		const sessionId = getCookie(c, 'session_id')
		if (!sessionId) {
			return c.json({ error: 'Not authenticated' }, 401)
		}

		const characterId = Number(c.req.param('characterId'))
		if (Number.isNaN(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}

		try {
			const sessionStub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')
			const session = await sessionStub.getSession(sessionId)

			// Check if user owns this character
			const characterLink = await sessionStub.getCharacterLinkByCharacterId(characterId)
			if (!characterLink || characterLink.rootUserId !== session.rootUserId) {
				return c.json({ error: 'Access denied: You do not own this character' }, 403)
			}

			// Get access token for ESI
			const tokenStoreStub = getStub<EveSSO>(c.env.EVESSO_STORE, 'global')
			const tokenInfo = await tokenStoreStub.getAccessToken(characterId)

			// Fetch wallet from ESI
			const walletUrl = `https://esi.evetech.net/latest/characters/${characterId}/wallet/`
			const response = await fetch(walletUrl, {
				headers: {
					Authorization: `Bearer ${tokenInfo.accessToken}`,
					'X-Compatibility-Date': '2025-09-30',
				},
			})

			if (!response.ok) {
				throw new Error(`ESI returned ${response.status}: ${response.statusText}`)
			}

			const balance = (await response.json()) as number

			return c.json({
				success: true,
				wallet: {
					balance,
					currency: 'ISK',
				},
			})
		} catch (error) {
			logger.error('Get character wallet error', { error: String(error), characterId })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Get character location (owner only)
	.get('/api/characters/:characterId/location', async (c) => {
		const sessionId = getCookie(c, 'session_id')
		if (!sessionId) {
			return c.json({ error: 'Not authenticated' }, 401)
		}

		const characterId = Number(c.req.param('characterId'))
		if (Number.isNaN(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}

		try {
			const sessionStub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')
			const session = await sessionStub.getSession(sessionId)

			// Check if user owns this character
			const characterLink = await sessionStub.getCharacterLinkByCharacterId(characterId)
			if (!characterLink || characterLink.rootUserId !== session.rootUserId) {
				return c.json({ error: 'Access denied: You do not own this character' }, 403)
			}

			// Get access token for ESI
			const tokenStoreStub = getStub<EveSSO>(c.env.EVESSO_STORE, 'global')
			const tokenInfo = await tokenStoreStub.getAccessToken(characterId)

			// Fetch location from ESI
			const locationUrl = `https://esi.evetech.net/latest/characters/${characterId}/location/`
			const response = await fetch(locationUrl, {
				headers: {
					Authorization: `Bearer ${tokenInfo.accessToken}`,
					'X-Compatibility-Date': '2025-09-30',
				},
			})

			if (!response.ok) {
				throw new Error(`ESI returned ${response.status}: ${response.statusText}`)
			}

			const location = (await response.json()) as {
				solar_system_id: number
				station_id?: number
				structure_id?: number
			}

			// Fetch online status
			const onlineUrl = `https://esi.evetech.net/latest/characters/${characterId}/online/`
			const onlineResponse = await fetch(onlineUrl, {
				headers: {
					Authorization: `Bearer ${tokenInfo.accessToken}`,
					'X-Compatibility-Date': '2025-09-30',
				},
			})

			let online = null
			if (onlineResponse.ok) {
				online = (await onlineResponse.json()) as {
					online: boolean
					last_login?: string
					last_logout?: string
					logins?: number
				}
			}

			// Fetch ship type
			const shipUrl = `https://esi.evetech.net/latest/characters/${characterId}/ship/`
			const shipResponse = await fetch(shipUrl, {
				headers: {
					Authorization: `Bearer ${tokenInfo.accessToken}`,
					'X-Compatibility-Date': '2025-09-30',
				},
			})

			let ship = null
			if (shipResponse.ok) {
				ship = (await shipResponse.json()) as {
					ship_type_id: number
					ship_item_id: number
					ship_name: string
				}
			}

			// Get names for locations and ship
			const universeStub = getStub<EveUniverse>(c.env.EVE_UNIVERSE, 'global')
			const idsToResolve: number[] = [location.solar_system_id]
			if (location.station_id) idsToResolve.push(location.station_id)
			if (location.structure_id) idsToResolve.push(location.structure_id)
			if (ship?.ship_type_id) idsToResolve.push(ship.ship_type_id)

			const names = await universeStub.getNames(idsToResolve)
			const nameMap = new Map(names.map((n) => [n.id, n.name]))

			return c.json({
				success: true,
				location: {
					solarSystemId: location.solar_system_id,
					solarSystemName:
						nameMap.get(location.solar_system_id) || `Unknown System (${location.solar_system_id})`,
					stationId: location.station_id,
					stationName: location.station_id
						? nameMap.get(location.station_id) || `Unknown Station (${location.station_id})`
						: null,
					structureId: location.structure_id,
					structureName: location.structure_id
						? nameMap.get(location.structure_id) || `Unknown Structure (${location.structure_id})`
						: null,
					online: online?.online,
					lastLogin: online?.last_login,
					lastLogout: online?.last_logout,
					ship: ship
						? {
								typeId: ship.ship_type_id,
								typeName: nameMap.get(ship.ship_type_id) || `Unknown Ship (${ship.ship_type_id})`,
								itemId: ship.ship_item_id,
								name: ship.ship_name,
							}
						: null,
				},
			})
		} catch (error) {
			logger.error('Get character location error', { error: String(error), characterId })
			return c.json({ error: String(error) }, 500)
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

			// Get all provider links for this root user
			const providerLinks = await stub.getProviderLinksByRootUser(session.rootUserId)

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

	// Admin endpoint to list all characters for a root user ID
	.get('/admin/characters', async (c) => {
		const rootUserId = c.req.query('rootUserId')

		if (!rootUserId) {
			return c.json({ error: 'rootUserId query parameter is required' }, 400)
		}

		try {
			const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Get all character links for this root user
			const characters = await stub.getCharacterLinksByRootUser(rootUserId)

			logger
				.withTags({
					type: 'admin_characters_list',
				})
				.info('Admin listed characters for root user', {
					rootUserId: rootUserId.substring(0, 8) + '...',
					characterCount: characters.length,
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
				rootUserId,
				characters: characters.map((char) => ({
					linkId: char.linkId,
					characterId: char.characterId,
					characterName: char.characterName,
					linkedAt: char.linkedAt,
					updatedAt: char.updatedAt,
				})),
			})
		} catch (error) {
			logger.error('List characters for root user error', { error: String(error) })
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

// Export Durable Object
export { SessionStore } from './session-store'
