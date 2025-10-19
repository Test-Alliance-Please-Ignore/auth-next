import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'

import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { createDb } from '../db'
import { oauthStates } from '../db/schema'
import { requireAuth } from '../middleware/session'
import { ActivityService } from '../services/activity.service'
import { AuthService } from '../services/auth.service'
import { UserService } from '../services/user.service'

import type { EveTokenStore } from '@repo/eve-token-store'
import type { App } from '../context'
import type { RequestMetadata } from '../types/user'

/**
 * Authentication routes
 *
 * Handles EVE SSO login flow, user creation, character linking, and session management.
 */
const auth = new Hono<App>()

/**
 * Helper to extract request metadata
 */
function getRequestMetadata(c: any): RequestMetadata {
	return {
		ip: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For'),
		userAgent: c.req.header('User-Agent'),
	}
}

/**
 * POST /auth/login/start
 *
 * Start EVE SSO login flow (all scopes).
 * Returns authorization URL to redirect user to.
 */
auth.post('/login/start', async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	const eveTokenStoreStub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

	// Start login flow
	const authUrl = await eveTokenStoreStub.startLoginFlow()

	// Store state in database to track flow type
	const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
	await db.insert(oauthStates).values({
		state: authUrl.state,
		flowType: 'login',
		userId: null,
		expiresAt,
	})

	return c.json({
		authorizationUrl: authUrl.url,
		state: authUrl.state,
	})
})

/**
 * POST /auth/character/start
 *
 * Start EVE SSO character flow (all scopes).
 * Used for linking additional characters.
 * Requires authentication.
 */
auth.post('/character/start', requireAuth(), async (c) => {
	const user = c.get('user')!
	const db = c.get('db') || createDb(c.env.DATABASE_URL)
	const eveTokenStoreStub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

	// Start character flow
	const authUrl = await eveTokenStoreStub.startCharacterFlow()

	// Store state in database to track flow type and user
	const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
	await db.insert(oauthStates).values({
		state: authUrl.state,
		flowType: 'character',
		userId: user.id,
		expiresAt,
	})

	return c.json({
		authorizationUrl: authUrl.url,
		state: authUrl.state,
	})
})

/**
 * GET /auth/callback
 *
 * Handle OAuth callback from EVE SSO.
 * This endpoint should be called by EVE SSO after user authorization.
 */
auth.get('/callback', async (c) => {
	const code = c.req.query('code')
	const state = c.req.query('state')

	if (!code) {
		return c.json({ error: 'Missing authorization code' }, 400)
	}

	const db = createDb(c.env.DATABASE_URL)
	const eveTokenStoreStub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

	const authService = new AuthService(db, eveTokenStoreStub, c.env.SESSION_SECRET)
	const userService = new UserService(db)
	const activityService = new ActivityService(db)

	// Look up the flow type from the state parameter
	let flowType: string | null = null
	let stateUserId: string | null = null

	if (state) {
		const oauthState = await db.query.oauthStates.findFirst({
			where: eq(oauthStates.state, state),
		})

		if (oauthState) {
			// Check if state has expired
			if (new Date() > oauthState.expiresAt) {
				return c.json({ error: 'OAuth state has expired. Please try again.' }, 400)
			}

			flowType = oauthState.flowType
			stateUserId = oauthState.userId

			// Delete the state after use (one-time use)
			await db.delete(oauthStates).where(eq(oauthStates.state, state))
		}
	}

	// Handle callback with eve-token-store
	const result = await eveTokenStoreStub.handleCallback(code, state)

	if (!result.success || !result.characterId || !result.characterInfo) {
		await activityService.logLoginFailed(0, result.error || 'Unknown error', getRequestMetadata(c))
		return c.json({ error: result.error || 'Authentication failed' }, 400)
	}

	const { characterId, characterInfo } = result

	// Handle character linking flow
	if (flowType === 'character') {
		if (!stateUserId) {
			return c.json({ error: 'Invalid character linking flow - no user ID found' }, 400)
		}

		// Verify user exists
		const user = await userService.getUserById(stateUserId)
		if (!user) {
			return c.json({ error: 'User not found' }, 404)
		}

		// Check if character is already linked
		const existingUser = await userService.getUserByCharacterId(characterId)
		if (existingUser) {
			if (existingUser.id === stateUserId) {
				// Character already linked to this user - token has been updated, just return success
				const existingCharacter = user.characters.find((char) => char.characterId === characterId)
				return c.json({
					characterLinked: true,
					tokenUpdated: true,
					character: existingCharacter,
				})
			} else {
				return c.json({ error: 'Character is already linked to another account' }, 400)
			}
		}

		// Link the character
		const linkedCharacter = await userService.linkCharacter({
			userId: stateUserId,
			characterOwnerHash: characterInfo.characterOwnerHash,
			characterId: characterInfo.characterId,
			characterName: characterInfo.characterName,
		})

		await activityService.logCharacterLinked(stateUserId, characterId, getRequestMetadata(c))

		return c.json({
			characterLinked: true,
			character: linkedCharacter,
		})
	}

	// Handle login flow
	// Check if user already exists with this character
	const user = await userService.getUserByCharacterId(characterId)

	if (user) {
		// Existing user - create session
		const session = await authService.createSession({
			userId: user.id,
			characterId,
			metadata: getRequestMetadata(c),
		})

		await activityService.logLogin(user.id, characterId, getRequestMetadata(c))

		return c.json({
			sessionToken: session.sessionToken,
			expiresAt: session.expiresAt,
			user: {
				id: user.id,
				requiresClaimMain: false,
			},
		})
	}

	// New user - return character info for claim-main flow
	return c.json({
		requiresClaimMain: true,
		characterInfo: {
			characterOwnerHash: characterInfo.characterOwnerHash,
			characterId: characterInfo.characterId,
			characterName: characterInfo.characterName,
		},
	})
})

/**
 * POST /auth/claim-main
 *
 * Claim a character as main and create root user account.
 * This should be called after a successful callback for a new user.
 */
auth.post('/claim-main', async (c) => {
	const body = await c.req.json()
	const { characterOwnerHash, characterId, characterName } = body

	if (!characterOwnerHash || !characterId || !characterName) {
		return c.json({ error: 'Missing required fields' }, 400)
	}

	const db = createDb(c.env.DATABASE_URL)
	const eveTokenStoreStub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

	const authService = new AuthService(db, eveTokenStoreStub, c.env.SESSION_SECRET)
	const userService = new UserService(db)
	const activityService = new ActivityService(db)

	// Verify character exists in eve-token-store
	const tokenInfo = await eveTokenStoreStub.getTokenInfo(characterId)

	if (!tokenInfo) {
		return c.json({ error: 'Character not authenticated. Please login first.' }, 400)
	}

	// Create user
	const user = await userService.createUser({
		characterOwnerHash,
		characterId,
		characterName,
	})

	// Create session
	const session = await authService.createSession({
		userId: user.id,
		characterId,
		metadata: getRequestMetadata(c),
	})

	await activityService.logLogin(user.id, characterId, getRequestMetadata(c))

	return c.json({
		sessionToken: session.sessionToken,
		expiresAt: session.expiresAt,
		user: {
			id: user.id,
			mainCharacterId: user.mainCharacterId,
		},
	})
})

/**
 * POST /auth/link-character
 *
 * Link an additional character to the authenticated user.
 * Requires authentication.
 */
auth.post('/link-character', requireAuth(), async (c) => {
	const user = c.get('user')!
	const body = await c.req.json()
	const { characterOwnerHash, characterId, characterName } = body

	if (!characterOwnerHash || !characterId || !characterName) {
		return c.json({ error: 'Missing required fields' }, 400)
	}

	const db = c.get('db') || createDb(c.env.DATABASE_URL)
	const eveTokenStoreStub =
		c.get('eveTokenStore') || getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

	const userService = new UserService(db)
	const activityService = new ActivityService(db)

	// Verify character exists in eve-token-store
	const tokenInfo = await eveTokenStoreStub.getTokenInfo(characterId)

	if (!tokenInfo) {
		return c.json(
			{ error: 'Character not authenticated. Please complete character flow first.' },
			400
		)
	}

	// Link character
	const linkedCharacter = await userService.linkCharacter({
		userId: user.id,
		characterOwnerHash,
		characterId,
		characterName,
	})

	await activityService.logCharacterLinked(user.id, characterId, getRequestMetadata(c))

	return c.json({
		character: linkedCharacter,
	})
})

/**
 * POST /auth/logout
 *
 * Logout user and revoke session.
 * Requires authentication.
 */
auth.post('/logout', requireAuth(), async (c) => {
	const user = c.get('user')!

	// Get session token from request
	const authHeader = c.req.header('Authorization')
	const cookieToken = getCookie(c, 'session')

	let sessionToken: string | undefined

	if (authHeader && authHeader.startsWith('Bearer ')) {
		sessionToken = authHeader.substring(7)
	} else if (cookieToken) {
		sessionToken = cookieToken
	}

	if (!sessionToken) {
		return c.json({ error: 'No session token provided' }, 400)
	}

	const db = c.get('db') || createDb(c.env.DATABASE_URL)
	const eveTokenStoreStub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

	const authService = new AuthService(db, eveTokenStoreStub, c.env.SESSION_SECRET)
	const activityService = new ActivityService(db)

	// Revoke session
	await authService.revokeSession(sessionToken)

	await activityService.logLogout(user.id, getRequestMetadata(c))

	return c.json({
		success: true,
	})
})

/**
 * GET /auth/session
 *
 * Get current session information.
 * Returns session data if authenticated, null otherwise.
 */
auth.get('/session', async (c) => {
	const user = c.get('user')

	if (!user) {
		return c.json({ authenticated: false, user: null })
	}

	return c.json({
		authenticated: true,
		user: {
			id: user.id,
			mainCharacterId: user.mainCharacterId,
			characters: user.characters,
			is_admin: user.is_admin,
		},
	})
})

export default auth
