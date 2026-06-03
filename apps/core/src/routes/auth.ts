import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { assertEveCharacterId } from '@repo/eve-types'
import { toErrorMessage } from '@repo/hono-helpers'

import { createDb } from '../db'
import { oauthStates, userCharacters, users } from '../db/schema'
import { waitUntilWithTelemetry } from '../lib/background-task'
import { getDiscordStatus } from '../lib/discord-helpers'
import { getCachedUserPermissions } from '../lib/groups-cache'
import { extractClientIp, recordUserIpAddress } from '../lib/ip-tracking'
import { createUserRefreshWorkflowId } from '../lib/workflow-triggers'
import { requireAuth } from '../middleware/session'
import { ActivityService } from '../services/activity.service'
import { AuthService } from '../services/auth.service'
import { hydrateCharacterAffiliation } from '../services/character-affiliation-hydration.service'
import { reconcileUserCoreMembershipRoles } from '../services/core-role-reconciliation.service'
import { autoRegisterDirectorCorporation } from '../services/corporation-auto-register.service'
import { SessionService } from '../services/session.service'
import { UserService } from '../services/user.service'

import type { Context } from 'hono'
import type { RequestMetadata } from '@repo/core'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { BlacklistEntry, Hr } from '@repo/hr'
import type { Legacy } from '@repo/legacy'
import type { App } from '../context'

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

function enqueueIpRecording(
	c: Context<App>,
	db: ReturnType<typeof createDb>,
	userId: string
): void {
	const ip = extractClientIp(c)
	const hashSecret = c.env.IP_ADDRESS_HASH_SECRET

	if (!ip || !hashSecret) {
		return
	}

	waitUntilWithTelemetry(
		c.executionCtx,
		'auth.ip-recording',
		() =>
			recordUserIpAddress({
				db,
				userId,
				ip,
				hashSecret,
			}),
		{
			userId,
		}
	)
}

async function hydrateAndReconcileUserRoles(
	c: Context<App>,
	db: ReturnType<typeof createDb>,
	userId: string,
	characterId: string
): Promise<void> {
	try {
		await hydrateCharacterAffiliation({
			db,
			env: c.env,
			characterId,
			cacheMode: 'no-store',
			executionCtx: c.executionCtx,
		})
	} catch (error) {
		console.error('[Auth] Failed to hydrate character affiliation at link-time', {
			userId,
			characterId,
			error: toErrorMessage(error),
		})
	}

	try {
		const reconcileResult = await reconcileUserCoreMembershipRoles(c.env, userId)
		console.log('[Auth] Reconciled core membership roles after link-time update', {
			userId,
			characterId,
			desiredCount: reconcileResult.desiredCount,
			attachedCount: reconcileResult.attachedCount,
			detachedCount: reconcileResult.detachedCount,
			finalCount: reconcileResult.roleAttachments.length,
		})
	} catch (error) {
		console.error('[Auth] Failed to reconcile core membership roles at link-time', {
			userId,
			characterId,
			error: toErrorMessage(error),
		})
	}
}

function triggerLegacyMigrationRecheck(c: Context<App>, userId: string): void {
	waitUntilWithTelemetry(
		c.executionCtx,
		'auth.legacy-migration-recheck',
		async () => {
			const stub = getStub<Legacy>(c.env.LEGACY, 'default')
			await stub.recheckUser(userId, 'system:auth-link')
		},
		{
			userId,
		}
	)
}

async function findBlacklistedCharacterTrigger(
	hrStub: Hr,
	characterId: string,
	characterName?: string
): Promise<BlacklistEntry | null> {
	const isIdBlacklisted = await hrStub.isCharacterBlacklisted(characterId)
	if (isIdBlacklisted) {
		const idEntries = await hrStub.getBlacklistsForCharacter(characterId)
		if (idEntries.length > 0) return idEntries[0]
	}

	if (characterName?.trim()) {
		const isNameBlacklisted = await hrStub.isCharacterNameBlacklisted(characterName)
		if (isNameBlacklisted) {
			const nameEntries = await hrStub.getBlacklistsForCharacterName(characterName)
			if (nameEntries.length > 0) return nameEntries[0]
		}
	}

	return null
}

async function blacklistUserLinkedTargets(
	db: ReturnType<typeof createDb>,
	hrStub: Hr,
	userId: string,
	blacklistedBy: string,
	userBlacklistEntryId: string
): Promise<void> {
	const linkedChars = await db.query.userCharacters.findMany({
		where: eq(userCharacters.userId, userId),
		columns: { characterId: true, characterName: true },
	})

	for (const linkedChar of linkedChars) {
		await hrStub.createCharacterBlacklist({
			characterId: linkedChar.characterId,
			characterName: linkedChar.characterName,
			reason: `Auto-blacklisted: owned by blacklisted user ${userId}`,
			blacklistedBy,
			triggeredBy: userBlacklistEntryId,
			metadata: {
				triggeredByUserBlacklist: userBlacklistEntryId,
			},
		})
	}
}

/**
 * GET /auth/login
 *
 * Initiate EVE SSO login flow and redirect user to EVE SSO.
 * Supports optional redirect parameter for post-login navigation.
 */
auth.get('/login', async (c) => {
	const redirectUrl = c.req.query('redirect')
	const db = createDb(c.env.DATABASE_URL)
	const eveTokenStoreStub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

	// Start login flow
	const authUrl = await eveTokenStoreStub.startLoginFlow()

	// Store state in database to track flow type and redirect URL
	const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
	await db.insert(oauthStates).values({
		state: authUrl.state,
		flowType: 'login',
		userId: null,
		redirectUrl: redirectUrl || null,
		expiresAt,
	})

	// Redirect user to EVE SSO
	return c.redirect(authUrl.url)
})

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
		redirectUrl: null,
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
		redirectUrl: null,
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
	let redirectUrl: string | null = null

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
			redirectUrl = oauthState.redirectUrl

			// Delete the state after use (one-time use)
			await db.delete(oauthStates).where(eq(oauthStates.state, state))
		}
	}

	// Handle callback with eve-token-store
	const result = await eveTokenStoreStub.handleCallback(code, state)

	if (!result.success || !result.characterId || !result.characterInfo) {
		await activityService.logLoginFailed(
			'unknown',
			result.error || 'Unknown error',
			getRequestMetadata(c)
		)
		return c.json({ error: result.error || 'Authentication failed' }, 400)
	}

	const { characterId: _characterId, characterInfo } = result
	const characterId = assertEveCharacterId(_characterId)

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
				await hydrateAndReconcileUserRoles(c, db, stateUserId, characterId)
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

		// SECURITY: Check if character ID or character name is blacklisted
		const hrStub = getStub<Hr>(c.env.HR, 'default')
		const charBlacklistTrigger = await findBlacklistedCharacterTrigger(
			hrStub,
			characterId,
			characterInfo.characterName
		)

		if (charBlacklistTrigger) {
			// Character is blacklisted - auto-blacklist the user
			const userBlacklistEntry = await hrStub.createUserBlacklist({
				userId: stateUserId,
				discordUserId: user.discordUserId ?? undefined,
				reason: `Auto-blacklisted: attempted to link blacklisted character ${characterId}`,
				blacklistedBy: charBlacklistTrigger.blacklistedBy,
				triggeredBy: charBlacklistTrigger.id,
				isAutoBlacklist: true,
			})
			await blacklistUserLinkedTargets(
				db,
				hrStub,
				stateUserId,
				charBlacklistTrigger.blacklistedBy,
				userBlacklistEntry.id
			)

			// Invalidate all sessions for this user
			const sessionService = new SessionService(db)
			await sessionService.invalidateAllUserSessions(stateUserId)

			return c.json({ error: 'Account suspended' }, 403)
		}

		// Link the character
		const linkedCharacter = await userService.linkCharacter({
			userId: stateUserId,
			characterOwnerHash: characterInfo.characterOwnerHash,
			characterId: characterInfo.characterId,
			characterName: characterInfo.characterName,
		})
		await hydrateAndReconcileUserRoles(c, db, stateUserId, characterId)

		// Update token validity cache (token was just received from SSO)
		await db
			.update(userCharacters)
			.set({ hasValidToken: true })
			.where(eq(userCharacters.characterId, characterId))

		await activityService.logCharacterLinked(stateUserId, characterId, getRequestMetadata(c))
		triggerLegacyMigrationRecheck(c, stateUserId)

		// Fetch character data in background (non-blocking)
		const eveCharacterDataStub = getStub<EveCharacterData>(
			c.env.EVE_CHARACTER_DATA,
			typeof characterId === 'string' ? characterId : String(characterId)
		)
		waitUntilWithTelemetry(
			c.executionCtx,
			'auth.link-character.refresh',
			async () => {
				// Fetch public character data
				await eveCharacterDataStub.fetchCharacterData(String(characterId), false)

				// Fetch authenticated data (skills, attributes, etc.)
				await eveCharacterDataStub.fetchAuthenticatedData(String(characterId), false)

				await db
					.update(users)
					.set({ lastRefreshWorkflowAttempt: new Date() })
					.where(eq(users.id, stateUserId))

				await c.env.USER_REFRESH_WORKFLOW.create({
					id: createUserRefreshWorkflowId('link', stateUserId),
					params: { userId: stateUserId, refreshMode: 'event' },
				})
			},
			{
				userId: stateUserId,
				characterId: String(characterId),
				source: 'link-character',
			}
		)

		// Auto-register corporation if character is a director
		let autoRegResult
		try {
			autoRegResult = await autoRegisterDirectorCorporation(
				characterId,
				characterInfo.characterName,
				stateUserId,
				db,
				c.env.EVE_TOKEN_STORE,
				c.env.EVE_CORPORATION_DATA
			)
		} catch (error) {
			// Don't fail character linking if auto-registration fails
			console.error('[Auth] Auto-registration failed:', toErrorMessage(error))
		}

		return c.json({
			characterLinked: true,
			character: linkedCharacter,
			autoRegistration: autoRegResult,
		})
	}

	// Handle login flow
	// Check if user already exists with this character
	const user = await userService.getUserByCharacterId(characterId)

	if (user) {
		// SECURITY: Check if character ID/name or user is blacklisted
		const hrStub = getStub<Hr>(c.env.HR, 'default')
		const charBlacklistTrigger = await findBlacklistedCharacterTrigger(
			hrStub,
			characterId,
			characterInfo.characterName
		)
		const isUserBlacklisted = await hrStub.isUserBlacklisted(user.id)

		if (charBlacklistTrigger) {
			// Character is blacklisted - auto-blacklist user and linked targets.
			const userBlacklistEntry = await hrStub.createUserBlacklist({
				userId: user.id,
				discordUserId: user.discordUserId ?? undefined,
				reason: `Auto-blacklisted: attempted login with blacklisted character ${characterId}`,
				blacklistedBy: charBlacklistTrigger.blacklistedBy,
				triggeredBy: charBlacklistTrigger.id,
				isAutoBlacklist: true,
			})
			await blacklistUserLinkedTargets(
				db,
				hrStub,
				user.id,
				charBlacklistTrigger.blacklistedBy,
				userBlacklistEntry.id
			)

			// Invalidate all sessions for this user
			const sessionService = new SessionService(db)
			await sessionService.invalidateAllUserSessions(user.id)

			return c.json({ error: 'Account suspended' }, 403)
		}

		if (isUserBlacklisted) {
			// User is blacklisted - reject login
			const sessionService = new SessionService(db)
			await sessionService.invalidateAllUserSessions(user.id)

			return c.json({ error: 'Account suspended' }, 403)
		}

		// Existing user - create session
		const session = await authService.createSession({
			userId: user.id,
			characterId,
			metadata: getRequestMetadata(c),
		})

		enqueueIpRecording(c, db, user.id)

		// Update token validity cache (token was just refreshed from SSO)
		await db
			.update(userCharacters)
			.set({ hasValidToken: true })
			.where(eq(userCharacters.characterId, characterId))

		await activityService.logLogin(user.id, characterId, getRequestMetadata(c))

		// Fetch character data in background (non-blocking)
		const eveCharacterDataStub = getStub<EveCharacterData>(
			c.env.EVE_CHARACTER_DATA,
			typeof characterId === 'string' ? characterId : String(characterId)
		)
		waitUntilWithTelemetry(
			c.executionCtx,
			'auth.login.refresh',
			async () => {
				// Fetch public character data
				await eveCharacterDataStub.fetchCharacterData(String(characterId), false)

				// Fetch authenticated data (skills, attributes, etc.)
				await eveCharacterDataStub.fetchAuthenticatedData(String(characterId), false)

				// Trigger user refresh workflow (throttled to every 5 minutes)
				const THROTTLE_MS = 5 * 60 * 1000 // 5 minutes
				const userRecord = await db.query.users.findFirst({
					where: eq(users.id, user.id),
					columns: { lastRefreshWorkflowAttempt: true },
				})

				const shouldTrigger =
					!userRecord?.lastRefreshWorkflowAttempt ||
					Date.now() - userRecord.lastRefreshWorkflowAttempt.getTime() > THROTTLE_MS

				if (shouldTrigger) {
					await db
						.update(users)
						.set({ lastRefreshWorkflowAttempt: new Date() })
						.where(eq(users.id, user.id))

					await c.env.USER_REFRESH_WORKFLOW.create({
						id: createUserRefreshWorkflowId('login', user.id),
						params: { userId: user.id, refreshMode: 'event' },
					})
				}
			},
			{
				userId: user.id,
				characterId: String(characterId),
				source: 'login',
			}
		)

		// Auto-register corporation if character is a director
		let autoRegResult
		try {
			autoRegResult = await autoRegisterDirectorCorporation(
				characterId,
				characterInfo.characterName,
				user.id,
				db,
				c.env.EVE_TOKEN_STORE,
				c.env.EVE_CORPORATION_DATA
			)
		} catch (error) {
			// Don't fail login if auto-registration fails
			console.error('[Auth] Auto-registration failed:', toErrorMessage(error))
		}

		// Set session cookie
		setCookie(c, 'session', session.sessionToken, {
			httpOnly: true,
			secure: true,
			sameSite: 'Lax',
			maxAge: 60 * 60 * 24 * 30, // 30 days
			path: '/',
		})

		// Return JSON response with redirect URL if present
		return c.json({
			success: true,
			user: {
				id: user.id,
				requiresClaimMain: false,
			},
			redirectUrl: redirectUrl || undefined,
			autoRegistration: autoRegResult,
		})
	}

	// New user - check if character ID/name is blacklisted before allowing claim-main
	const hrStub = getStub<Hr>(c.env.HR, 'default')
	const charBlacklistTrigger = await findBlacklistedCharacterTrigger(
		hrStub,
		characterId,
		characterInfo.characterName
	)

	if (charBlacklistTrigger) {
		// Character is blacklisted - prevent new user creation
		return c.json({ error: 'Account suspended' }, 403)
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
 *
 * Security: Character data comes from the token store, not from client input.
 */
auth.post('/claim-main', async (c) => {
	const body = await c.req.json()
	const { characterId } = body

	if (!characterId) {
		return c.json({ error: 'Missing characterId' }, 400)
	}

	const db = createDb(c.env.DATABASE_URL)
	const eveTokenStoreStub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

	const authService = new AuthService(db, eveTokenStoreStub, c.env.SESSION_SECRET)
	const userService = new UserService(db)
	const activityService = new ActivityService(db)

	// Fetch verified character data from token store
	const tokenInfo = await eveTokenStoreStub.getTokenInfo(characterId)

	if (!tokenInfo) {
		return c.json({ error: 'Character not authenticated. Please login first.' }, 400)
	}

	// SECURITY: Check if character ID/name is blacklisted before creating user
	const hrStub = getStub<Hr>(c.env.HR, 'default')
	const charBlacklistTrigger = await findBlacklistedCharacterTrigger(
		hrStub,
		tokenInfo.characterId,
		tokenInfo.characterName
	)

	if (charBlacklistTrigger) {
		// Character is blacklisted - prevent user creation
		return c.json({ error: 'Account suspended' }, 403)
	}

	// Create user with verified data from token store (not from client)
	const user = await userService.createUser({
		characterOwnerHash: tokenInfo.characterOwnerHash,
		characterId: tokenInfo.characterId,
		characterName: tokenInfo.characterName,
	})
	await hydrateAndReconcileUserRoles(c, db, user.id, tokenInfo.characterId)

	// Update token validity cache (token was just received from SSO)
	await db
		.update(userCharacters)
		.set({ hasValidToken: true })
		.where(eq(userCharacters.characterId, tokenInfo.characterId))

	// Create session
	const session = await authService.createSession({
		userId: user.id,
		characterId: tokenInfo.characterId,
		metadata: getRequestMetadata(c),
	})

	enqueueIpRecording(c, db, user.id)

	await activityService.logLogin(user.id, tokenInfo.characterId, getRequestMetadata(c))
	triggerLegacyMigrationRecheck(c, user.id)

	// Fetch character data in background (non-blocking)
	const eveCharacterDataStub = getStub<EveCharacterData>(
		c.env.EVE_CHARACTER_DATA,
		typeof characterId === 'string' ? characterId : String(characterId)
	)
	waitUntilWithTelemetry(
		c.executionCtx,
		'auth.claim-main.refresh',
		async () => {
			// Fetch public character data
			await eveCharacterDataStub.fetchCharacterData(String(tokenInfo.characterId), false)

			// Fetch authenticated data (skills, attributes, etc.)
			await eveCharacterDataStub.fetchAuthenticatedData(String(tokenInfo.characterId), false)

			// Trigger user refresh workflow for new user
			await db
				.update(users)
				.set({ lastRefreshWorkflowAttempt: new Date() })
				.where(eq(users.id, user.id))

			await c.env.USER_REFRESH_WORKFLOW.create({
				id: createUserRefreshWorkflowId('login', user.id),
				params: { userId: user.id, refreshMode: 'event' },
			})
		},
		{
			userId: user.id,
			characterId: tokenInfo.characterId,
			source: 'claim-main',
		}
	)

	// Auto-register corporation if character is a director
	let autoRegResult
	try {
		autoRegResult = await autoRegisterDirectorCorporation(
			tokenInfo.characterId,
			tokenInfo.characterName,
			user.id,
			db,
			c.env.EVE_TOKEN_STORE,
			c.env.EVE_CORPORATION_DATA
		)
	} catch (error) {
		// Don't fail user creation if auto-registration fails
		console.error('[Auth] Auto-registration failed:', toErrorMessage(error))
	}

	// Set session cookie
	setCookie(c, 'session', session.sessionToken, {
		httpOnly: true,
		secure: true,
		sameSite: 'Lax',
		maxAge: 60 * 60 * 24 * 30, // 30 days
		path: '/',
	})

	return c.json({
		success: true,
		user: {
			id: user.id,
			mainCharacterId: user.mainCharacterId,
		},
		autoRegistration: autoRegResult,
	})
})

/**
 * POST /auth/link-character
 *
 * Link an additional character to the authenticated user.
 * Requires authentication.
 *
 * Security: Character data comes from the token store, not from client input.
 */
auth.post('/link-character', requireAuth(), async (c) => {
	const user = c.get('user')!
	const body = await c.req.json()
	const { characterId } = body

	if (!characterId) {
		return c.json({ error: 'Missing characterId' }, 400)
	}

	const db = c.get('db') || createDb(c.env.DATABASE_URL)
	const eveTokenStoreStub =
		c.get('eveTokenStore') || getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

	const userService = new UserService(db)
	const activityService = new ActivityService(db)

	// Fetch verified character data from token store
	const tokenInfo = await eveTokenStoreStub.getTokenInfo(characterId)

	if (!tokenInfo) {
		return c.json(
			{ error: 'Character not authenticated. Please complete character flow first.' },
			400
		)
	}

	// SECURITY: Check if character ID or name is blacklisted
	const hrStub = getStub<Hr>(c.env.HR, 'default')
	const charBlacklistTrigger = await findBlacklistedCharacterTrigger(
		hrStub,
		tokenInfo.characterId,
		tokenInfo.characterName
	)

	if (charBlacklistTrigger) {
		// Character is blacklisted - auto-blacklist the user
		const userBlacklistEntry = await hrStub.createUserBlacklist({
			userId: user.id,
			discordUserId: user.discordUserId ?? undefined,
			reason: `Auto-blacklisted: attempted to link blacklisted character ${tokenInfo.characterId}`,
			blacklistedBy: charBlacklistTrigger.blacklistedBy,
			triggeredBy: charBlacklistTrigger.id,
			isAutoBlacklist: true,
		})
		await blacklistUserLinkedTargets(
			db,
			hrStub,
			user.id,
			charBlacklistTrigger.blacklistedBy,
			userBlacklistEntry.id
		)

		// Invalidate all sessions for this user
		const sessionService = new SessionService(db)
		await sessionService.invalidateAllUserSessions(user.id)

		return c.json({ error: 'Account suspended' }, 403)
	}

	// Link character with verified data from token store (not from client)
	const linkedCharacter = await userService.linkCharacter({
		userId: user.id,
		characterOwnerHash: tokenInfo.characterOwnerHash,
		characterId: tokenInfo.characterId,
		characterName: tokenInfo.characterName,
	})
	await hydrateAndReconcileUserRoles(c, db, user.id, tokenInfo.characterId)

	await activityService.logCharacterLinked(user.id, tokenInfo.characterId, getRequestMetadata(c))
	triggerLegacyMigrationRecheck(c, user.id)

	waitUntilWithTelemetry(
		c.executionCtx,
		'auth.link.refresh',
		async () => {
			await db
				.update(users)
				.set({ lastRefreshWorkflowAttempt: new Date() })
				.where(eq(users.id, user.id))

			await c.env.USER_REFRESH_WORKFLOW.create({
				id: createUserRefreshWorkflowId('link', user.id),
				params: { userId: user.id, refreshMode: 'event' },
			})
		},
		{
			userId: user.id,
			characterId: tokenInfo.characterId,
			source: 'link',
		}
	)

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

	// Delete session cookie
	deleteCookie(c, 'session', {
		path: '/',
	})

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
		return c.json({ authenticated: false, user: null, permissions: [] })
	}

	// Fetch user permissions (cached for 15 seconds)
	const permissions = await getCachedUserPermissions(c.env, user.id)

	// Lazy-load Discord status if needed
	const discordStatus = await getDiscordStatus(c)

	// Get user profile to include legacy auth info
	const db = c.get('db') || createDb(c.env.DATABASE_URL)
	const userService = new UserService(db)

	let profile: Awaited<ReturnType<typeof userService.getUserProfile>>
	try {
		profile = await userService.getUserProfile(user.id)
	} catch (error) {
		console.error('[Auth Session] Failed to fetch user profile', {
			userId: user.id,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		throw error
	}

	// Build legacy auth status
	const isLinked = !!(profile.legacyAuthUserId && profile.legacyAuthUserUsername)
	const legacyAuth = {
		userId: profile.legacyAuthUserId,
		username: profile.legacyAuthUserUsername,
		isLinked,
	}

	return c.json({
		authenticated: true,
		user: {
			id: user.id,
			mainCharacterId: user.mainCharacterId,
			characters: user.characters,
			is_admin: user.is_admin,
			discord: discordStatus,
			legacyAuth,
		},
		permissions: permissions.map((p) => ({
			permissionId: p.permissionId ?? null,
			urn: p.urn,
			name: p.name,
			description: p.description,
		})),
	})
})

/**
 * POST /auth/legacy-auth/start
 *
 * Start legacy auth OIDC OAuth flow.
 * Requires authentication.
 * Returns authorization URL to redirect user to.
 */
auth.post('/legacy-auth/start', requireAuth(), async (c) => {
	const user = c.get('user')!
	const db = c.get('db') || createDb(c.env.DATABASE_URL)

	// Check if user already has legacy auth linked
	const userRecord = await db.query.users.findFirst({
		where: eq(users.id, user.id),
		columns: { legacyAuthUserId: true },
	})

	if (userRecord?.legacyAuthUserId) {
		return c.json({ error: 'User already has a legacy account linked' }, 400)
	}

	// Fetch OIDC discovery document
	const discoveryResponse = await fetch(
		'https://auth.pleaseignore.com/openid/.well-known/openid-configuration'
	)

	if (!discoveryResponse.ok) {
		return c.json({ error: 'Failed to fetch OIDC discovery document' }, 500)
	}

	const discovery = await discoveryResponse.json<{
		authorization_endpoint: string
		token_endpoint: string
	}>()

	// Generate OAuth state (UUID)
	const state = crypto.randomUUID()

	// Store state in database to track flow type and user
	const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
	await db.insert(oauthStates).values({
		state,
		flowType: 'legacy-auth',
		userId: user.id,
		redirectUrl: null,
		expiresAt,
	})

	// Build authorization URL
	const params = new URLSearchParams({
		client_id: c.env.LEGACY_AUTH_CLIENT_ID,
		redirect_uri: c.env.LEGACY_AUTH_CALLBACK_URL,
		response_type: 'code',
		scope: 'openid profile read_profile read_characters ssouser',
		state,
	})

	const authorizationUrl = `${discovery.authorization_endpoint}?${params.toString()}`

	return c.json({
		authorizationUrl,
		state,
	})
})

/**
 * GET /auth/legacy-auth/callback
 *
 * Handle OAuth callback from legacy auth OIDC server.
 * Exchanges authorization code for access token, fetches user profile, and saves legacy auth info.
 */
auth.get('/legacy-auth/callback', async (c) => {
	const code = c.req.query('code')
	const state = c.req.query('state')

	if (!code) {
		return c.redirect(
			'/legacy-auth/callback?error=' + encodeURIComponent('Missing authorization code')
		)
	}

	if (!state) {
		return c.redirect(
			'/legacy-auth/callback?error=' + encodeURIComponent('Missing state parameter')
		)
	}

	const db = createDb(c.env.DATABASE_URL)
	const userService = new UserService(db)

	// Validate state from oauthStates table
	const oauthState = await db.query.oauthStates.findFirst({
		where: eq(oauthStates.state, state),
	})

	if (!oauthState) {
		return c.redirect('/legacy-auth/callback?error=' + encodeURIComponent('Invalid OAuth state'))
	}

	// Check if state has expired
	if (new Date() > oauthState.expiresAt) {
		await db.delete(oauthStates).where(eq(oauthStates.state, state))
		return c.redirect(
			'/legacy-auth/callback?error=' +
				encodeURIComponent('OAuth state has expired. Please try again.')
		)
	}

	// Check flow type
	if (oauthState.flowType !== 'legacy-auth') {
		return c.redirect('/legacy-auth/callback?error=' + encodeURIComponent('Invalid flow type'))
	}

	// Verify user ID exists
	if (!oauthState.userId) {
		return c.redirect(
			'/legacy-auth/callback?error=' + encodeURIComponent('Invalid OAuth state - no user ID found')
		)
	}

	// Verify user exists
	const user = await userService.getUserById(oauthState.userId)
	if (!user) {
		return c.redirect('/legacy-auth/callback?error=' + encodeURIComponent('User not found'))
	}

	// SECURITY: Check if user already has legacy auth linked
	if (user.legacyAuthUserId) {
		await db.delete(oauthStates).where(eq(oauthStates.state, state))
		return c.redirect(
			'/legacy-auth/callback?error=' +
				encodeURIComponent('User already has a legacy account linked')
		)
	}

	// Fetch OIDC discovery document
	const discoveryResponse = await fetch(
		'https://auth.pleaseignore.com/openid/.well-known/openid-configuration'
	)

	if (!discoveryResponse.ok) {
		return c.redirect(
			'/legacy-auth/callback?error=' + encodeURIComponent('Failed to fetch OIDC discovery document')
		)
	}

	const discovery = await discoveryResponse.json<{
		token_endpoint: string
	}>()

	// Exchange authorization code for access token
	const tokenResponse = await fetch(discovery.token_endpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			client_id: c.env.LEGACY_AUTH_CLIENT_ID,
			client_secret: c.env.LEGACY_AUTH_CLIENT_SECRET,
			code,
			grant_type: 'authorization_code',
			redirect_uri: c.env.LEGACY_AUTH_CALLBACK_URL,
		}),
	})

	if (!tokenResponse.ok) {
		const errorText = await tokenResponse.text()
		console.error('[Legacy Auth] Token exchange failed:', errorText)
		await db.delete(oauthStates).where(eq(oauthStates.state, state))
		return c.redirect(
			'/legacy-auth/callback?error=' +
				encodeURIComponent('Failed to exchange authorization code for token')
		)
	}

	const tokenData = await tokenResponse.json<{
		access_token: string
		token_type?: string
		expires_in?: number
	}>()

	if (!tokenData.access_token) {
		await db.delete(oauthStates).where(eq(oauthStates.state, state))
		return c.redirect(
			'/legacy-auth/callback?error=' + encodeURIComponent('No access token in response')
		)
	}

	console.log('[Legacy Auth] Access token fetched', {
		accessToken: tokenData.access_token,
		tokenType: tokenData.token_type,
		expiresIn: tokenData.expires_in,
	})
	// Call profile API to get user info
	const profileResponse = await fetch('https://auth.pleaseignore.com/openid/userinfo', {
		headers: {
			Authorization: `Bearer ${tokenData.access_token}`,
		},
	})

	if (!profileResponse.ok) {
		const errorText = await profileResponse.text()
		console.error(
			'[Legacy Auth] Profile fetch failed:',
			errorText,
			profileResponse.status,
			profileResponse.statusText
		)
		await db.delete(oauthStates).where(eq(oauthStates.state, state))
		return c.redirect(
			'/legacy-auth/callback?error=' + encodeURIComponent('Failed to fetch user profile')
		)
	}

	const profile = await profileResponse.json<{
		sub: string
		auth_username: string
	}>()

	if (!profile.sub || !profile.auth_username) {
		await db.delete(oauthStates).where(eq(oauthStates.state, state))
		return c.redirect(
			'/legacy-auth/callback?error=' +
				encodeURIComponent('Invalid profile response - missing id or username')
		)
	}

	try {
		// Update user record with legacy auth info (includes duplicate check)
		await userService.updateLegacyAuthInfo(oauthState.userId, profile.sub, profile.auth_username)
	} catch (error) {
		await db.delete(oauthStates).where(eq(oauthStates.state, state))
		const errorMessage =
			error instanceof Error ? error.message : 'Failed to update legacy auth info'
		return c.redirect('/legacy-auth/callback?error=' + encodeURIComponent(errorMessage))
	}

	// Delete OAuth state after successful use
	await db.delete(oauthStates).where(eq(oauthStates.state, state))

	// Redirect to frontend callback page with success
	return c.redirect(
		`/legacy-auth/callback?success=true&username=${encodeURIComponent(profile.auth_username)}`
	)
})

export default auth
