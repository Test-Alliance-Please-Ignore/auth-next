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
import type { TagStore } from '@repo/tag-store'
import type { App } from './context'

// Default ESI scopes - can be overridden via query param
const DEFAULT_ESI_SCOPES = [
	'publicData',
	'esi-calendar.respond_calendar_events.v1',
	'esi-calendar.read_calendar_events.v1',
	'esi-location.read_location.v1',
	'esi-mail.organize_mail.v1',
	'esi-mail.read_mail.v1',
	'esi-skills.read_skills.v1',
	'esi-skills.read_skillqueue.v1',
	'esi-wallet.read_corporation_wallet.v1',
	'esi-search.search_structures.v1',
	'esi-clones.read_clones.v1',
	'esi-characters.read_contacts.v1',
	'esi-killmails.read_killmails.v1',
	'esi-corporations.read_corporation_membership.v1',
	'esi-assets.read_assets.v1',
	'esi-planets.manage_planets.v1',
	'esi-fleets.write_fleet.v1',
	'esi-ui.open_window.v1',
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
	'esi-corporations.read_standings.v1',
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
	'esi-corporations.read_fw_stats.v1',
	'esi-corporations.read_projects.v1',
	'esi-location.read_ship_type.v1',
	'esi-mail.send_mail.v1',
	'esi-wallet.read_character_wallet.v1',
	'esi-universe.read_structures.v1',
	'esi-fleets.read_fleet.v1',
	'esi-ui.write_waypoint.v1',
	'esi-contracts.read_corporation_contracts.v1',
	'esi-corporations.read_starbases.v1',
	'esi-characters.read_fw_stats.v1',
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

	// Unified EVE SSO OAuth callback endpoint (handles both primary login and character linking)
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
			.info('EVE SSO OAuth callback received', {
				state: state.substring(0, 8) + '...',
				request: getRequestLogData(c, Date.now()),
			})

		try {
			// Determine flow type by attempting to validate state
			const sessionStoreStub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')
			const evessoStoreStub = getStub<EveSSO>(c.env.EVESSO_STORE, 'global')

			let isCharacterLinkFlow = false
			let sessionId: string | undefined

			// Try OIDC state first (character linking)
			try {
				sessionId = await sessionStoreStub.validateOIDCState(state)
				isCharacterLinkFlow = true
				logger
					.withTags({
						type: 'evesso_callback_flow_detected',
					})
					.info('Character linking flow detected', {
						state: state.substring(0, 8) + '...',
						request: getRequestLogData(c, Date.now()),
					})
			} catch {
				// Not OIDC state, try ESI OAuth state (primary login)
				try {
					await evessoStoreStub.validateESIOAuthState(state)
					isCharacterLinkFlow = false
					logger
						.withTags({
							type: 'evesso_callback_flow_detected',
						})
						.info('Primary login flow detected', {
							state: state.substring(0, 8) + '...',
							request: getRequestLogData(c, Date.now()),
						})
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
			}

			// Route to appropriate flow
			if (isCharacterLinkFlow && sessionId) {
				// Character linking flow - get session and process
				const session = await sessionStoreStub.getSession(sessionId)
				return handleCharacterLinkCallback(c, code, session, evessoStoreStub, sessionStoreStub)
			} else {
				// Primary login flow
				return handlePrimaryLoginCallback(c, code, evessoStoreStub, sessionStoreStub)
			}
		} catch (error) {
			logger
				.withTags({
					type: 'evesso_oauth_exception',
				})
				.error('EVE SSO OAuth exception', {
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

			// Build EVE SSO OAuth URL (use same callback as primary login)
			const authUrl = new URL('https://login.eveonline.com/v2/oauth/authorize/')
			authUrl.searchParams.set('response_type', 'code')
			authUrl.searchParams.set('redirect_uri', c.env.ESI_SSO_CALLBACK_URL)
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


export default app

// Export Durable Object
export { EveSSO } from './evesso'

// Helper function for primary login callback
async function handlePrimaryLoginCallback(
	c: any,
	code: string,
	evessoStoreStub: any,
	sessionStoreStub: any
) {
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

		// Log full token response to identify any additional fields
		logger
			.withTags({
				type: 'evesso_token_data_debug',
			})
			.info('EVE SSO token response data (primary login)', {
				tokenDataKeys: Object.keys(tokenData),
				tokenDataFields: Object.fromEntries(
					Object.entries(tokenData).map(([key, value]) =>
						key.includes('token') ? [key, '[REDACTED]'] : [key, value]
					)
				),
				request: getRequestLogData(c, Date.now()),
			})

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
			CharacterOwnerHash: string
			Scopes: string
		}

		// Log full character verification response to identify any additional fields like owner hash
		logger
			.withTags({
				type: 'evesso_verify_data_debug',
			})
			.info('EVE SSO verify response data', {
				verifyDataKeys: Object.keys(characterInfo),
				verifyDataFull: characterInfo,
				hasOwnerHash: !!characterInfo.CharacterOwnerHash,
				request: getRequestLogData(c, Date.now()),
			})

		// Check if character is already used as a primary login
		const existingPrimaryUser = await sessionStoreStub.getRootUserByProvider(
			'evesso',
			String(characterInfo.CharacterID)
		)

		if (existingPrimaryUser) {
			// Character already has a root user account, log them in
			logger
				.withTags({
					type: 'evesso_oauth_existing_user',
				})
				.info('Existing EVE SSO user logging in', {
					characterId: characterInfo.CharacterID,
					rootUserId: existingPrimaryUser.rootUserId.substring(0, 8) + '...',
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

			// Check if character is already linked, if not, link it automatically
			try {
				const existingCharLink = await sessionStoreStub.getCharacterLinkByCharacterId(
					characterInfo.CharacterID
				)

				if (!existingCharLink) {
					await sessionStoreStub.createCharacterLink(
						existingPrimaryUser.rootUserId,
						characterInfo.CharacterID,
						characterInfo.CharacterName
					)

					// Set as primary character since it's their login character
					await sessionStoreStub.setPrimaryCharacter(
						existingPrimaryUser.rootUserId,
						characterInfo.CharacterID
					)

					logger
						.withTags({
							type: 'character_auto_linked',
							character_id: characterInfo.CharacterID,
						})
						.info('Automatically linked existing user login character', {
							characterId: characterInfo.CharacterID,
							characterName: characterInfo.CharacterName,
							rootUserId: existingPrimaryUser.rootUserId.substring(0, 8) + '...',
							isPrimary: true,
						})
				}
			} catch (linkError) {
				// Log but don't fail the login if character linking fails
				logger
					.withTags({
						type: 'character_auto_link_error',
						character_id: characterInfo.CharacterID,
					})
					.error('Failed to automatically link existing user character', {
						error: String(linkError),
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

			return c.html(authSuccessHtml.replace('__CHARACTER_NAME__', characterInfo.CharacterName))
		}

		// Check if character is already linked to another root user account
		const existingLink = await sessionStoreStub.getCharacterLinkByCharacterId(
			characterInfo.CharacterID
		)

		if (existingLink) {
			logger
				.withTags({
					type: 'evesso_oauth_primary_login_rejected',
				})
				.warn('Character is already linked to another root user account', {
					characterId: characterInfo.CharacterID,
					linkedToRootUserId: existingLink.rootUserId.substring(0, 8) + '...',
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

		// Create or get root user with EVE SSO as primary provider (with owner hash)
		await sessionStoreStub.getOrCreateRootUser(
			'evesso',
			String(characterInfo.CharacterID),
			`${characterInfo.CharacterID}@evesso.user`,
			characterInfo.CharacterName,
			characterInfo.CharacterOwnerHash
		)

		// Create new session for this root user
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

				// Fetch alliance data if character is in an alliance
				let allianceResult: { data: { name: string; ticker: string } } | null = null
				const allianceId = corpResult.data.alliance_id || charResult.data.alliance_id
				if (allianceId) {
					try {
						const { fetchAllianceInfo } = await import('../../esi/src/esi-client')
						allianceResult = await fetchAllianceInfo(allianceId, tokenData.access_token)

						logger
							.withTags({
								type: 'alliance_data_fetched',
								alliance_id: allianceId,
							})
							.info('Alliance data fetched during primary login', {
								allianceId,
								allianceName: allianceResult.data.name,
							})
					} catch (allianceError) {
						logger
							.withTags({
								type: 'alliance_fetch_error',
								alliance_id: allianceId,
							})
							.error('Failed to fetch alliance during primary login', {
								error: String(allianceError),
								allianceId,
							})
					}
				}

				// Notify tags service
				try {
					const tagStoreStub = getStub<TagStore>(c.env.TAG_STORE, 'global')

					logger
						.withTags({
							type: 'tags_onboarding_start',
							character_id: characterInfo.CharacterID,
						})
						.info('Starting tag onboarding for primary login', {
							characterId: characterInfo.CharacterID,
							corporationId: charResult.data.corporation_id,
							allianceId,
						})

					// Create/update corporation tag
					const corpUrn = `urn:eve:corporation:${charResult.data.corporation_id}`
					await tagStoreStub.upsertTag(
						corpUrn,
						'corporation',
						corpResult.data.name,
						charResult.data.corporation_id,
						{
							corporationId: charResult.data.corporation_id,
							ticker: corpResult.data.ticker,
						}
					)

					logger
						.withTags({
							type: 'tag_upserted',
							corporation_id: charResult.data.corporation_id,
						})
						.info('Corporation tag created', {
							tagUrn: corpUrn,
							corporationName: corpResult.data.name,
							corporationTicker: corpResult.data.ticker,
						})

					// Assign corporation tag to user
					await tagStoreStub.assignTagToUser(
						sessionInfo.rootUserId,
						corpUrn,
						characterInfo.CharacterID
					)

					logger
						.withTags({
							type: 'tag_assigned',
							character_id: characterInfo.CharacterID,
						})
						.info('Corporation tag assigned to user', {
							tagUrn: corpUrn,
							rootUserId: sessionInfo.rootUserId.substring(0, 8) + '...',
							characterId: characterInfo.CharacterID,
						})

					// Create/update alliance tag if applicable
					if (allianceId && allianceResult) {
						const allianceUrn = `urn:eve:alliance:${allianceId}`
						await tagStoreStub.upsertTag(
							allianceUrn,
							'alliance',
							allianceResult.data.name,
							allianceId,
							{
								allianceId,
							}
						)

						logger
							.withTags({
								type: 'tag_upserted',
								alliance_id: allianceId,
							})
							.info('Alliance tag created', {
								tagUrn: allianceUrn,
								allianceName: allianceResult.data.name,
							})

						// Assign alliance tag to user
						await tagStoreStub.assignTagToUser(
							sessionInfo.rootUserId,
							allianceUrn,
							characterInfo.CharacterID
						)

						logger
							.withTags({
								type: 'tag_assigned',
								character_id: characterInfo.CharacterID,
							})
							.info('Alliance tag assigned to user', {
								tagUrn: allianceUrn,
								rootUserId: sessionInfo.rootUserId.substring(0, 8) + '...',
								characterId: characterInfo.CharacterID,
							})
					}

					// Schedule first evaluation
					await tagStoreStub.scheduleUserEvaluation(sessionInfo.rootUserId)

					logger
						.withTags({
							type: 'tags_onboarding_complete',
							character_id: characterInfo.CharacterID,
						})
						.info('Tag onboarding completed for primary login', {
							characterId: characterInfo.CharacterID,
							corporationTag: corpUrn,
							allianceTag: allianceId ? `urn:eve:alliance:${allianceId}` : null,
						})
				} catch (tagsError) {
					// Don't fail the login if tags notification fails
					logger
						.withTags({
							type: 'tags_onboarding_error',
							character_id: characterInfo.CharacterID,
						})
						.error('Failed to onboard tags during primary login', {
							error: String(tagsError),
							characterId: characterInfo.CharacterID,
						})
				}
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

		// Link the character they logged in with to their account
		try {
			await sessionStoreStub.createCharacterLink(
				sessionInfo.rootUserId,
				characterInfo.CharacterID,
				characterInfo.CharacterName
			)

			// Set as primary character since it's the first one
			await sessionStoreStub.setPrimaryCharacter(
				sessionInfo.rootUserId,
				characterInfo.CharacterID
			)

			logger
				.withTags({
					type: 'character_auto_linked',
					character_id: characterInfo.CharacterID,
				})
				.info('Automatically linked login character to account', {
					characterId: characterInfo.CharacterID,
					characterName: characterInfo.CharacterName,
					rootUserId: sessionInfo.rootUserId.substring(0, 8) + '...',
					isPrimary: true,
				})
		} catch (linkError) {
			// Log but don't fail the login if character linking fails
			logger
				.withTags({
					type: 'character_auto_link_error',
					character_id: characterInfo.CharacterID,
				})
				.error('Failed to automatically link character during primary login', {
					error: String(linkError),
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
}

// Helper function for character link callback
async function handleCharacterLinkCallback(
	c: any,
	code: string,
	session: any,
	evessoStoreStub: any,
	sessionStoreStub: any
) {
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

		// Log full token response to identify any additional fields
		logger
			.withTags({
				type: 'evesso_token_data_debug',
			})
			.info('EVE SSO token response data (character link)', {
				tokenDataKeys: Object.keys(tokenData),
				tokenDataFields: Object.fromEntries(
					Object.entries(tokenData).map(([key, value]) =>
						key.includes('token') ? [key, '[REDACTED]'] : [key, value]
					)
				),
				request: getRequestLogData(c, Date.now()),
			})

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
			CharacterOwnerHash: string
			Scopes: string
		}

		// Log full character verification response to identify any additional fields like owner hash
		logger
			.withTags({
				type: 'evesso_verify_data_debug',
			})
			.info('EVE SSO verify response data (character link)', {
				verifyDataKeys: Object.keys(characterInfo),
				verifyDataFull: characterInfo,
				hasOwnerHash: !!characterInfo.CharacterOwnerHash,
				request: getRequestLogData(c, Date.now()),
			})

		// Check if character is already linked to another root user account
		const existingLink = await sessionStoreStub.getCharacterLinkByCharacterId(
			characterInfo.CharacterID
		)

		if (existingLink && existingLink.rootUserId !== session.rootUserId) {
			logger
				.withTags({
					type: 'evesso_character_link_rejected',
				})
				.warn('Character already linked to different root user account', {
					characterId: characterInfo.CharacterID,
					linkedToRootUserId: existingLink.rootUserId.substring(0, 8) + '...',
					currentRootUserId: session.rootUserId.substring(0, 8) + '...',
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
				session.rootUserId,
				characterInfo.CharacterID,
				characterInfo.CharacterName
			)

			logger
				.withTags({
					type: 'evesso_character_linked',
					character_id: characterInfo.CharacterID,
				})
				.info('EVE character linked to root user account', {
					characterId: characterInfo.CharacterID,
					characterName: characterInfo.CharacterName,
					rootUserId: session.rootUserId.substring(0, 8) + '...',
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

				// Fetch alliance data if character is in an alliance
				let allianceResult: { data: { name: string; ticker: string } } | null = null
				const allianceId = corpResult.data.alliance_id || charResult.data.alliance_id
				if (allianceId) {
					try {
						const { fetchAllianceInfo } = await import('../../esi/src/esi-client')
						allianceResult = await fetchAllianceInfo(allianceId, tokenData.access_token)

						logger
							.withTags({
								type: 'alliance_data_fetched',
								alliance_id: allianceId,
							})
							.info('Alliance data fetched during character linking', {
								allianceId,
								allianceName: allianceResult.data.name,
							})
					} catch (allianceError) {
						logger
							.withTags({
								type: 'alliance_fetch_error',
								alliance_id: allianceId,
							})
							.error('Failed to fetch alliance during character linking', {
								error: String(allianceError),
								allianceId,
							})
					}
				}

				// Notify tags service
				try {
					const tagStoreStub = getStub<TagStore>(c.env.TAG_STORE, 'global')

					logger
						.withTags({
							type: 'tags_onboarding_start',
							character_id: characterInfo.CharacterID,
						})
						.info('Starting tag onboarding for character linking', {
							characterId: characterInfo.CharacterID,
							corporationId: charResult.data.corporation_id,
							allianceId,
						})

					// Create/update corporation tag
					const corpUrn = `urn:eve:corporation:${charResult.data.corporation_id}`
					await tagStoreStub.upsertTag(
						corpUrn,
						'corporation',
						corpResult.data.name,
						charResult.data.corporation_id,
						{
							corporationId: charResult.data.corporation_id,
							ticker: corpResult.data.ticker,
						}
					)

					logger
						.withTags({
							type: 'tag_upserted',
							corporation_id: charResult.data.corporation_id,
						})
						.info('Corporation tag created', {
							tagUrn: corpUrn,
							corporationName: corpResult.data.name,
							corporationTicker: corpResult.data.ticker,
						})

					// Assign corporation tag to user
					await tagStoreStub.assignTagToUser(
						session.rootUserId,
						corpUrn,
						characterInfo.CharacterID
					)

					logger
						.withTags({
							type: 'tag_assigned',
							character_id: characterInfo.CharacterID,
						})
						.info('Corporation tag assigned to user', {
							tagUrn: corpUrn,
							rootUserId: session.rootUserId.substring(0, 8) + '...',
							characterId: characterInfo.CharacterID,
						})

					// Create/update alliance tag if applicable
					if (allianceId && allianceResult) {
						const allianceUrn = `urn:eve:alliance:${allianceId}`
						await tagStoreStub.upsertTag(
							allianceUrn,
							'alliance',
							allianceResult.data.name,
							allianceId,
							{
								allianceId,
							}
						)

						logger
							.withTags({
								type: 'tag_upserted',
								alliance_id: allianceId,
							})
							.info('Alliance tag created', {
								tagUrn: allianceUrn,
								allianceName: allianceResult.data.name,
							})

						// Assign alliance tag to user
						await tagStoreStub.assignTagToUser(
							session.rootUserId,
							allianceUrn,
							characterInfo.CharacterID
						)

						logger
							.withTags({
								type: 'tag_assigned',
								character_id: characterInfo.CharacterID,
							})
							.info('Alliance tag assigned to user', {
								tagUrn: allianceUrn,
								rootUserId: session.rootUserId.substring(0, 8) + '...',
								characterId: characterInfo.CharacterID,
							})
					}

					// Schedule first evaluation
					await tagStoreStub.scheduleUserEvaluation(session.rootUserId)

					logger
						.withTags({
							type: 'tags_onboarding_complete',
							character_id: characterInfo.CharacterID,
						})
						.info('Tag onboarding completed for character linking', {
							characterId: characterInfo.CharacterID,
							corporationTag: corpUrn,
							allianceTag: allianceId ? `urn:eve:alliance:${allianceId}` : null,
						})
				} catch (tagsError) {
					// Don't fail the character link if tags notification fails
					logger
						.withTags({
							type: 'tags_onboarding_error',
							character_id: characterInfo.CharacterID,
						})
						.error('Failed to onboard tags during character linking', {
							error: String(tagsError),
							characterId: characterInfo.CharacterID,
						})
				}
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
				rootUserId: session.rootUserId.substring(0, 8) + '...',
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
}
