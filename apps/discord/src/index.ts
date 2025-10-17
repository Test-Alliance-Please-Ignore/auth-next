import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
import { getRequestLogData, logger, withNotFound, withOnError } from '@repo/hono-helpers'

import authSuccessHtml from './templates/auth-success.html?raw'
import linkSuccessHtml from './templates/link-success.html?raw'

import type { Discord as DiscordDO } from '@repo/discord'
import type { SessionStore } from '@repo/session-store'
import type { App } from './context'

// OAuth scopes for primary login (with email)
const DISCORD_OAUTH_SCOPES_PRIMARY = ['identify', 'email']
// OAuth scopes for secondary linking (without email)
const DISCORD_OAUTH_SCOPES_SECONDARY = ['identify']

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
		return c.text('Discord OAuth Worker')
	})

	// Primary Discord OAuth login endpoint (with email for social auth)
	.get('/discord/login', (c) => {
		const state = crypto.randomUUID()
		const scopes = DISCORD_OAUTH_SCOPES_PRIMARY.join(' ')

		const authUrl = new URL('https://discord.com/oauth2/authorize')
		authUrl.searchParams.set('client_id', c.env.DISCORD_CLIENT_ID)
		authUrl.searchParams.set('redirect_uri', c.env.DISCORD_CALLBACK_URL)
		authUrl.searchParams.set('response_type', 'code')
		authUrl.searchParams.set('scope', scopes)
		authUrl.searchParams.set('state', state)

		logger
			.withTags({
				type: 'discord_oauth_login_redirect',
			})
			.info('Redirecting to Discord OAuth (primary)', {
				scopes,
				state,
				request: getRequestLogData(c, Date.now()),
			})

		return c.redirect(authUrl.toString())
	})

	// Primary Discord OAuth callback endpoint
	.get('/discord/callback', async (c) => {
		const code = c.req.query('code')
		const state = c.req.query('state')
		const error = c.req.query('error')

		if (error) {
			logger
				.withTags({
					type: 'discord_oauth_callback_error',
				})
				.error('Discord OAuth callback error', {
					error,
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: `Discord OAuth error: ${error}` }, 400)
		}

		if (!code) {
			return c.json({ error: 'Missing authorization code' }, 400)
		}

		logger
			.withTags({
				type: 'discord_oauth_callback',
			})
			.info('Discord OAuth callback received (primary)', {
				state,
				request: getRequestLogData(c, Date.now()),
			})

		try {
			// Exchange code for tokens
			const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({
					code,
					client_id: c.env.DISCORD_CLIENT_ID,
					client_secret: c.env.DISCORD_CLIENT_SECRET,
					redirect_uri: c.env.DISCORD_CALLBACK_URL,
					grant_type: 'authorization_code',
				}),
			})

			if (!tokenResponse.ok) {
				const error = await tokenResponse.text()
				logger
					.withTags({
						type: 'discord_oauth_token_error',
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
				token_type: string
			}

			// Get user info from Discord
			const userInfoResponse = await fetch('https://discord.com/api/users/@me', {
				headers: {
					Authorization: `Bearer ${tokenData.access_token}`,
				},
			})

			if (!userInfoResponse.ok) {
				const error = await userInfoResponse.text()
				logger
					.withTags({
						type: 'discord_oauth_userinfo_error',
					})
					.error('Failed to get Discord user info', {
						status: userInfoResponse.status,
						error,
						request: getRequestLogData(c, Date.now()),
					})
				return c.json({ error: 'Failed to get Discord user info' }, 502)
			}

			const userInfo = (await userInfoResponse.json()) as {
				id: string
				username: string
				discriminator?: string
				email?: string
				avatar?: string
			}

			// Construct name from Discord username
			const name =
				userInfo.discriminator && userInfo.discriminator !== '0'
					? `${userInfo.username}#${userInfo.discriminator}`
					: userInfo.username

			// Email might be null if user didn't grant permission
			const email = userInfo.email || `${userInfo.id}@discord.user`

			// Check if Discord account is already linked as a secondary provider to another user
			const sessionStoreStub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')
			const existingProviderLink = await sessionStoreStub.getProviderLinkByProvider(
				'discord',
				userInfo.id
			)

			if (existingProviderLink) {
				logger
					.withTags({
						type: 'discord_oauth_primary_login_rejected',
					})
					.warn('Discord account is already linked as secondary provider', {
						discordUserId: userInfo.id.substring(0, 8) + '...',
						linkedToRootUserId: existingProviderLink.rootUserId.substring(0, 8) + '...',
						request: getRequestLogData(c, Date.now()),
					})
				return c.json(
					{
						error:
							'This Discord account is already linked to another user account. Please log in with your original authentication provider (Google, etc.) to access your account.',
					},
					400
				)
			}

			// Store session in SessionStore (using global instance)
			const sessionInfo = await sessionStoreStub.createSession(
				'discord',
				userInfo.id,
				email,
				name,
				tokenData.access_token,
				tokenData.refresh_token,
				tokenData.expires_in
			)

			// Store Discord tokens in Discord DO
			const discordStoreStub = getStub<DiscordDO>(c.env.DISCORD_STORE, 'global')
			await discordStoreStub.storeDiscordTokens(sessionInfo.rootUserId, {
				accessToken: tokenData.access_token,
				refreshToken: tokenData.refresh_token,
				expiresIn: tokenData.expires_in,
			})

			// Set HTTP-only cookie for session
			const now = Date.now()
			const maxAge = Math.floor((sessionInfo.expiresAt - now) / 1000) // Convert to seconds
			setCookie(c, 'session_id', sessionInfo.sessionId, {
				httpOnly: true,
				secure: true,
				sameSite: 'Lax',
				path: '/',
				maxAge,
			})

			logger
				.withTags({
					type: 'discord_oauth_success',
				})
				.info('Discord OAuth flow completed (primary)', {
					email,
					name,
					sessionId: sessionInfo.sessionId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.html(authSuccessHtml.replace('__USER_NAME__', name))
		} catch (error) {
			logger
				.withTags({
					type: 'discord_oauth_exception',
				})
				.error('Discord OAuth exception (primary)', {
					error: String(error),
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: String(error) }, 500)
		}
	})

	// Initiate Discord provider link (secondary, no email)
	.post('/link/discord/initiate', async (c) => {
		const sessionId = getCookie(c, 'session_id')

		if (!sessionId) {
			return c.json({ error: 'Not authenticated' }, 401)
		}

		try {
			const sessionStoreStub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Verify session exists and get session info
			const session = await sessionStoreStub.getSession(sessionId)

			// Prevent linking Discord if user is already logged in with Discord
			if (session.provider === 'discord') {
				logger
					.withTags({
						type: 'discord_provider_link_rejected',
					})
					.warn('User attempted to link Discord while logged in with Discord', {
						sessionId: sessionId.substring(0, 8) + '...',
						request: getRequestLogData(c, Date.now()),
					})
				return c.json(
					{ error: 'Cannot link Discord account when already logged in with Discord' },
					400
				)
			}

			// Create OIDC state linked to this session
			const state = await sessionStoreStub.createOIDCState(sessionId)

			// Build Discord OAuth URL (no email scope for secondary linking)
			const authUrl = new URL('https://discord.com/oauth2/authorize')
			authUrl.searchParams.set('client_id', c.env.DISCORD_CLIENT_ID)
			authUrl.searchParams.set(
				'redirect_uri',
				c.env.DISCORD_CALLBACK_URL.replace('/discord/callback', '/link/discord/callback')
			)
			authUrl.searchParams.set('response_type', 'code')
			authUrl.searchParams.set('scope', DISCORD_OAUTH_SCOPES_SECONDARY.join(' '))
			authUrl.searchParams.set('state', state)

			logger
				.withTags({
					type: 'discord_provider_link_initiate',
				})
				.info('Initiating Discord provider link', {
					sessionId: sessionId.substring(0, 8) + '...',
					state: state.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
				authUrl: authUrl.toString(),
			})
		} catch (error) {
			logger.error('Discord provider link initiate error', { error: String(error) })
			return c.json(
				{ error: String(error) },
				error instanceof Error && error.message === 'Session not found' ? 404 : 500
			)
		}
	})

	// Handle Discord provider link callback (secondary, no email)
	.get('/link/discord/callback', async (c) => {
		const code = c.req.query('code')
		const state = c.req.query('state')
		const error = c.req.query('error')

		if (error) {
			logger
				.withTags({
					type: 'discord_provider_link_callback_error',
				})
				.error('Discord link callback error', {
					error,
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: `Discord OAuth error: ${error}` }, 400)
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

			// Prevent linking Discord if user is already logged in with Discord
			if (session.provider === 'discord') {
				logger
					.withTags({
						type: 'discord_provider_link_callback_rejected',
					})
					.warn('Discord link callback rejected - user logged in with Discord', {
						sessionId: sessionId.substring(0, 8) + '...',
						request: getRequestLogData(c, Date.now()),
					})
				return c.json(
					{ error: 'Cannot link Discord account when already logged in with Discord' },
					400
				)
			}

			// Exchange code for tokens
			const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({
					code,
					client_id: c.env.DISCORD_CLIENT_ID,
					client_secret: c.env.DISCORD_CLIENT_SECRET,
					redirect_uri: c.env.DISCORD_CALLBACK_URL.replace(
						'/discord/callback',
						'/link/discord/callback'
					),
					grant_type: 'authorization_code',
				}),
			})

			if (!tokenResponse.ok) {
				const error = await tokenResponse.text()
				logger
					.withTags({
						type: 'discord_provider_link_token_error',
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
				token_type: string
			}

			// Store Discord tokens in Discord DO (this will fetch user info internally)
			const discordStoreStub = getStub<DiscordDO>(c.env.DISCORD_STORE, 'global')
			const { discordUserId, discordUsername } = await discordStoreStub.storeDiscordTokens(
				session.rootUserId,
				{
					accessToken: tokenData.access_token,
					refreshToken: tokenData.refresh_token,
					expiresIn: tokenData.expires_in,
				}
			)

			// Check if Discord account is already used as a primary login
			const existingPrimaryUser = await sessionStoreStub.getRootUserByProvider(
				'discord',
				discordUserId
			)

			if (existingPrimaryUser) {
				logger
					.withTags({
						type: 'discord_provider_link_rejected_primary_exists',
					})
					.warn('Discord account is already used as primary login', {
						discordUserId: discordUserId.substring(0, 8) + '...',
						primaryRootUserId: existingPrimaryUser.rootUserId.substring(0, 8) + '...',
						request: getRequestLogData(c, Date.now()),
					})
				return c.json(
					{
						error:
							'This Discord account is already being used as a primary login method. A Discord account cannot be both a primary login and a linked provider.',
					},
					400
				)
			}

			// Create provider link in SessionStore for metadata
			const link = await sessionStoreStub.createProviderLink(
				session.rootUserId,
				'discord',
				discordUserId,
				discordUsername
			)

			logger
				.withTags({
					type: 'discord_provider_link_success',
				})
				.info('Discord provider link completed', {
					linkId: link.linkId,
					rootUserId: link.rootUserId.substring(0, 8) + '...',
					provider: link.provider,
					providerUserId: link.providerUserId,
					request: getRequestLogData(c, Date.now()),
				})

			return c.html(linkSuccessHtml.replace('__DISCORD_USERNAME__', discordUsername))
		} catch (error) {
			logger
				.withTags({
					type: 'discord_provider_link_exception',
				})
				.error('Discord provider link callback exception', {
					error: String(error),
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: String(error) }, 500)
		}
	})

export default app

// Export Durable Object
export { Discord } from './discord'
