import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
import { getRequestLogData, logger, withNotFound, withOnError } from '@repo/hono-helpers'

import authSuccessHtml from './templates/auth-success.html'
import linkSuccessHtml from './templates/link-success.html'

import type { CharacterDataStore } from '@repo/character-data-store'
import type { EveSSO } from '@repo/evesso'
import type { SessionStore } from '@repo/session-store'
import type { App } from './context'

// Default ESI scopes - can be overridden via query param
const DEFAULT_ESI_SCOPES = [
	'publicData',
	'esi-calendar.respond_calendar_events.v1',
	'esi-calendar.read_calendar_events.v1',
	'esi-location.read_location.v1',
	'esi-location.read_ship_type.v1',
	'esi-mail.organize_mail.v1',
	'esi-mail.read_mail.v1',
	'esi-mail.send_mail.v1',
	'esi-skills.read_skills.v1',
	'esi-skills.read_skillqueue.v1',
	'esi-wallet.read_character_wallet.v1',
	'esi-wallet.read_corporation_wallet.v1',
	'esi-search.search_structures.v1',
	'esi-clones.read_clones.v1',
	'esi-characters.read_contacts.v1',
	'esi-universe.read_structures.v1',
	'esi-bookmarks.read_character_bookmarks.v1',
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
	'esi-characters.read_opportunities.v1',
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
	'esi-bookmarks.read_corporation_bookmarks.v1',
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
	'esi-characterstats.read.v1',
]

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
		return c.text('EVE SSO OAuth Worker')
	})

	// Primary EVE SSO OAuth login endpoint (creates account)
	.get('/evesso/login', async (c) => {
		// For primary login, we DON'T require existing session
		// This allows users to create accounts with EVE SSO

		try {
			// Create temporary session ID for state validation
			const tempSessionId = crypto.randomUUID()

			// Create ESI OAuth state
			const evessoStoreStub = getStub<EveSSO>(c.env.EVESSO_STORE, 'global')
			const state = await evessoStoreStub.createESIOAuthState(tempSessionId)

			const scopes = c.req.query('scopes') || DEFAULT_ESI_SCOPES.join(' ')

			const authUrl = new URL('https://login.eveonline.com/v2/oauth/authorize/')
			authUrl.searchParams.set('response_type', 'code')
			authUrl.searchParams.set('redirect_uri', c.env.ESI_SSO_CALLBACK_URL)
			authUrl.searchParams.set('client_id', c.env.ESI_SSO_CLIENT_ID)
			authUrl.searchParams.set('scope', scopes)
			authUrl.searchParams.set('state', state)

			logger
				.withTags({
					type: 'evesso_oauth_login_redirect',
				})
				.info('Redirecting to EVE SSO (primary)', {
					scopes,
					state: state.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.redirect(authUrl.toString())
		} catch (error) {
			logger
				.withTags({
					type: 'evesso_login_error',
				})
				.error('Error initiating EVE SSO login', {
					error: String(error),
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: 'Failed to initiate EVE SSO login' }, 500)
		}
	})

	// Primary EVE SSO OAuth callback endpoint
	.get('/evesso/callback', async (c) => {
		const code = c.req.query('code')
		const state = c.req.query('state')
		const error = c.req.query('error')

		if (error) {
			logger
				.withTags({
					type: 'evesso_oauth_callback_error',
				})
				.error('EVE SSO OAuth callback error', {
					error,
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: `EVE SSO OAuth error: ${error}` }, 400)
		}

		if (!code || !state) {
			return c.json({ error: 'Missing authorization code or state' }, 400)
		}

		logger
			.withTags({
				type: 'evesso_oauth_callback',
			})
			.info('EVE SSO OAuth callback received (primary)', {
				state: state.substring(0, 8) + '...',
				request: getRequestLogData(c, Date.now()),
			})

		try {
			// Validate state
			const evessoStoreStub = getStub<EveSSO>(c.env.EVESSO_STORE, 'global')

			let _tempSessionId: string
			try {
				_tempSessionId = await evessoStoreStub.validateESIOAuthState(state)
			} catch (error) {
				logger
					.withTags({
						type: 'evesso_oauth_state_invalid',
					})
					.warn('Invalid or expired EVE SSO OAuth state', {
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
						type: 'evesso_oauth_token_error',
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

			// Check if character is already used as a primary login
			const sessionStoreStub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')
			const existingPrimaryUser = await sessionStoreStub.getSocialUserByProvider(
				'evesso',
				String(characterInfo.CharacterID)
			)

			if (existingPrimaryUser) {
				// Character already has a social account, log them in
				logger
					.withTags({
						type: 'evesso_oauth_existing_user',
					})
					.info('Existing EVE SSO user logging in', {
						characterId: characterInfo.CharacterID,
						socialUserId: existingPrimaryUser.socialUserId.substring(0, 8) + '...',
						request: getRequestLogData(c, Date.now()),
					})

				// Create new session for existing user
				const sessionInfo = await sessionStoreStub.createSession(
					'evesso',
					String(characterInfo.CharacterID),
					`${characterInfo.CharacterID}@evesso.user`,
					characterInfo.CharacterName,
					tokenData.access_token,
					tokenData.refresh_token,
					tokenData.expires_in
				)

				// Store tokens in EveSSO DO
				await evessoStoreStub.storeTokens(
					characterInfo.CharacterID,
					characterInfo.CharacterName,
					tokenData.access_token,
					tokenData.refresh_token,
					tokenData.expires_in,
					characterInfo.Scopes
				)

				// Set HTTP-only cookie for session
				const now = Date.now()
				const maxAge = Math.floor((sessionInfo.expiresAt - now) / 1000)
				setCookie(c, 'session_id', sessionInfo.sessionId, {
					httpOnly: true,
					secure: true,
					sameSite: 'Lax',
					path: '/',
					maxAge,
				})

				return c.html(authSuccessHtml.replace('__CHARACTER_NAME__', characterInfo.CharacterName))
			}

			// Check if character is already linked to another social account
			const existingLink = await sessionStoreStub.getCharacterLinkByCharacterId(
				characterInfo.CharacterID
			)

			if (existingLink) {
				logger
					.withTags({
						type: 'evesso_oauth_primary_login_rejected',
					})
					.warn('Character is already linked to another social account', {
						characterId: characterInfo.CharacterID,
						linkedToSocialUserId: existingLink.socialUserId.substring(0, 8) + '...',
						request: getRequestLogData(c, Date.now()),
					})
				return c.json(
					{
						error:
							'This EVE character is already linked to another account. Please log in with your original authentication provider to access your account.',
					},
					400
				)
			}

			// Create new social user with EVE SSO as primary provider
			const sessionInfo = await sessionStoreStub.createSession(
				'evesso',
				String(characterInfo.CharacterID),
				`${characterInfo.CharacterID}@evesso.user`,
				characterInfo.CharacterName,
				tokenData.access_token,
				tokenData.refresh_token,
				tokenData.expires_in
			)

			// Store tokens in EveSSO DO
			await evessoStoreStub.storeTokens(
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
				const { fetchCharacterInfo, fetchCorporationInfo } = await import(
					'../../esi/src/esi-client'
				)

				// Fetch character info from ESI
				const charResult = await fetchCharacterInfo(
					characterInfo.CharacterID,
					tokenData.access_token
				)
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
					.info('Character data stored during primary login', {
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
						.info('Corporation data stored during primary login', {
							corporationId: charResult.data.corporation_id,
							corporationName: corpResult.data.name,
						})
				} catch (corpError) {
					logger
						.withTags({
							type: 'corporation_fetch_error',
						})
						.error('Failed to fetch corporation during primary login', {
							error: String(corpError),
							corporationId: charResult.data.corporation_id,
						})
				}
			} catch (dataError) {
				logger
					.withTags({
						type: 'character_data_error',
						character_id: characterInfo.CharacterID,
					})
					.error('Failed to store character data during primary login', {
						error: String(dataError),
						characterId: characterInfo.CharacterID,
					})
			}

			// Set HTTP-only cookie for session
			const now = Date.now()
			const maxAge = Math.floor((sessionInfo.expiresAt - now) / 1000)
			setCookie(c, 'session_id', sessionInfo.sessionId, {
				httpOnly: true,
				secure: true,
				sameSite: 'Lax',
				path: '/',
				maxAge,
			})

			logger
				.withTags({
					type: 'evesso_oauth_success',
				})
				.info('EVE SSO OAuth flow completed (primary)', {
					characterId: characterInfo.CharacterID,
					characterName: characterInfo.CharacterName,
					sessionId: sessionInfo.sessionId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.html(authSuccessHtml.replace('__CHARACTER_NAME__', characterInfo.CharacterName))
		} catch (error) {
			logger
				.withTags({
					type: 'evesso_oauth_exception',
				})
				.error('EVE SSO OAuth exception (primary)', {
					error: String(error),
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: String(error) }, 500)
		}
	})

	// Initiate EVE character link (secondary, requires existing session)
	.post('/link/evesso/initiate', async (c) => {
		const sessionId = getCookie(c, 'session_id')

		if (!sessionId) {
			return c.json({ error: 'Not authenticated' }, 401)
		}

		try {
			const sessionStoreStub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Verify session exists and get session info
			const _session = await sessionStoreStub.getSession(sessionId)

			// Create OIDC state linked to this session
			const state = await sessionStoreStub.createOIDCState(sessionId)

			const scopes = c.req.query('scopes') || DEFAULT_ESI_SCOPES.join(' ')

			// Build EVE SSO OAuth URL
			const authUrl = new URL('https://login.eveonline.com/v2/oauth/authorize/')
			authUrl.searchParams.set('response_type', 'code')
			authUrl.searchParams.set(
				'redirect_uri',
				c.env.ESI_SSO_CALLBACK_URL.replace('/evesso/callback', '/link/evesso/callback')
			)
			authUrl.searchParams.set('client_id', c.env.ESI_SSO_CLIENT_ID)
			authUrl.searchParams.set('scope', scopes)
			authUrl.searchParams.set('state', state)

			logger
				.withTags({
					type: 'evesso_character_link_initiate',
				})
				.info('Initiating EVE character link', {
					sessionId: sessionId.substring(0, 8) + '...',
					state: state.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
				authUrl: authUrl.toString(),
			})
		} catch (error) {
			logger.error('EVE character link initiate error', { error: String(error) })
			return c.json(
				{ error: String(error) },
				error instanceof Error && error.message === 'Session not found' ? 404 : 500
			)
		}
	})

	// Handle EVE character link callback (secondary)
	.get('/link/evesso/callback', async (c) => {
		const code = c.req.query('code')
		const state = c.req.query('state')
		const error = c.req.query('error')

		if (error) {
			logger
				.withTags({
					type: 'evesso_character_link_callback_error',
				})
				.error('EVE character link callback error', {
					error,
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: `EVE SSO OAuth error: ${error}` }, 400)
		}

		if (!code || !state) {
			return c.json({ error: 'Missing code or state' }, 400)
		}

		try {
			const sessionStoreStub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Validate state and get session ID
			const sessionId = await sessionStoreStub.validateOIDCState(state)

			// Get session info
			const session = await sessionStoreStub.getSession(sessionId)

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
						type: 'evesso_character_link_token_error',
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

			// Check if character is already linked to another social account
			const existingLink = await sessionStoreStub.getCharacterLinkByCharacterId(
				characterInfo.CharacterID
			)

			if (existingLink && existingLink.socialUserId !== session.socialUserId) {
				logger
					.withTags({
						type: 'evesso_character_link_rejected',
					})
					.warn('Character already linked to different social account', {
						characterId: characterInfo.CharacterID,
						linkedToSocialUserId: existingLink.socialUserId.substring(0, 8) + '...',
						currentSocialUserId: session.socialUserId.substring(0, 8) + '...',
						request: getRequestLogData(c, Date.now()),
					})
				return c.json(
					{
						error: 'This EVE character is already linked to another account.',
					},
					400
				)
			}

			// Store tokens in EveSSO DO
			const evessoStoreStub = getStub<EveSSO>(c.env.EVESSO_STORE, 'global')
			await evessoStoreStub.storeTokens(
				characterInfo.CharacterID,
				characterInfo.CharacterName,
				tokenData.access_token,
				tokenData.refresh_token,
				tokenData.expires_in,
				characterInfo.Scopes
			)

			// Create or update character link
			if (!existingLink) {
				await sessionStoreStub.createCharacterLink(
					session.socialUserId,
					characterInfo.CharacterID,
					characterInfo.CharacterName
				)

				logger
					.withTags({
						type: 'evesso_character_linked',
						character_id: characterInfo.CharacterID,
					})
					.info('EVE character linked to social account', {
						characterId: characterInfo.CharacterID,
						characterName: characterInfo.CharacterName,
						socialUserId: session.socialUserId.substring(0, 8) + '...',
						request: getRequestLogData(c, Date.now()),
					})
			} else {
				logger
					.withTags({
						type: 'evesso_character_reauth',
						character_id: characterInfo.CharacterID,
					})
					.info('EVE character re-authenticated', {
						characterId: characterInfo.CharacterID,
						characterName: characterInfo.CharacterName,
						request: getRequestLogData(c, Date.now()),
					})
			}

			// Fetch and store character data
			try {
				const dataStoreStub = getStub<CharacterDataStore>(c.env.CHARACTER_DATA_STORE, 'global')

				// Import ESI client functions
				const { fetchCharacterInfo, fetchCorporationInfo } = await import(
					'../../esi/src/esi-client'
				)

				// Fetch character info from ESI
				const charResult = await fetchCharacterInfo(
					characterInfo.CharacterID,
					tokenData.access_token
				)
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
			}

			logger
				.withTags({
					type: 'evesso_character_link_success',
				})
				.info('EVE character link completed', {
					characterId: characterInfo.CharacterID,
					characterName: characterInfo.CharacterName,
					socialUserId: session.socialUserId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.html(linkSuccessHtml.replace('__CHARACTER_NAME__', characterInfo.CharacterName))
		} catch (error) {
			logger
				.withTags({
					type: 'evesso_character_link_exception',
				})
				.error('EVE character link callback exception', {
					error: String(error),
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: String(error) }, 500)
		}
	})

export default app

// Export Durable Object
export { EveSSO } from './evesso'
