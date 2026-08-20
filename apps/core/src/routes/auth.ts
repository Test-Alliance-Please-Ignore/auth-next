import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { assertEveCharacterId } from '@repo/eve-types'
import { captureException, logger, toErrorMessage } from '@repo/hono-helpers'
import { createWorkflow } from '@repo/workflow-utils'

import { createDb } from '../db'
import {
	managedCorporations,
	mumbleTempops,
	oauthStates,
	userCharacters,
	users,
} from '../db/schema'
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
import { recheckDirectorHealthAfterTokenReauth } from '../services/director-health-recheck.service'
import { storeCredentialHandoff } from '../services/mumble-tempop.service'
import { provisionTempopGuest } from '../services/mumble.service'
import { SessionService } from '../services/session.service'
import { CharacterAlreadyClaimedError, UserService } from '../services/user.service'

import type { Context } from 'hono'
import type { RequestMetadata, UserProfileDTO } from '@repo/core'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { BlacklistEntry, Hr } from '@repo/hr'
import type { Legacy } from '@repo/legacy'
import type { App } from '../context'
import type { ClaimMainOAuthMetadata, OAuthStateMetadata, TempopOAuthMetadata } from '../db/schema'
import type {
	DirectorHealthRecheckStub,
	ManagedCorporationSummary,
} from '../services/director-health-recheck.service'

/**
 * Authentication routes
 *
 * Handles EVE SSO login flow, user creation, character linking, and session management.
 */
const auth = new Hono<App>()

export function shouldUseSecureSessionCookie(c: Context<App>): boolean {
	return new URL(c.req.url).protocol === 'https:'
}

/**
 * Flows that legitimately terminate at GET /auth/callback.
 *
 * oauth_states also holds 'legacy-auth' rows (redeemed at /auth/legacy-auth/callback) and
 * 'claim-main' tickets (redeemed at /auth/claim-main). Each callback accepts only its own
 * flow types so a state minted for one flow cannot be replayed against another.
 */
const CALLBACK_FLOW_TYPES = ['login', 'character', 'mumble-tempop'] as const
type CallbackFlowType = (typeof CALLBACK_FLOW_TYPES)[number]

function isCallbackFlowType(flowType: string): flowType is CallbackFlowType {
	return (CALLBACK_FLOW_TYPES as readonly string[]).includes(flowType)
}

/** How long a claim-main ticket stays redeemable after SSO verifies the character. */
const CLAIM_TICKET_TTL_MS = 15 * 60 * 1000

/**
 * Characters imported from legacy auth carry this placeholder instead of a CCP owner hash
 * (see legacyImportCharacterLinks in ../durable-object.ts). The import is an admin assertion
 * with no cryptographic proof of ownership, so the placeholder is not evidence of anything —
 * it must never be compared against a real hash.
 */
const LEGACY_IMPORT_HASH_PREFIX = 'legacy-import:'

const OAUTH_STATE_COOKIE = 'oauth_state'

/**
 * Deliberately outlives the 15-minute oauth_states row. If the cookie died first, an expired
 * flow would be reported by the cookie check below instead of by the state-expiry check, which
 * is the one that knows how to render a friendly per-flow error (the temp-op guest redirect).
 */
const OAUTH_STATE_COOKIE_TTL_SECONDS = 30 * 60

/**
 * Bind an in-flight OAuth state to the browser that started the flow.
 *
 * The oauth_states row proves *a* flow was started; it does not prove *this browser* started
 * it, because /auth/login and /auth/login/start are unauthenticated and will hand a valid
 * state to anyone who asks. This cookie is what supplies the missing half, and it is the
 * actual login-CSRF defence — see the check in /auth/callback.
 *
 * SameSite=Lax is sufficient: EVE redirects the browser to the SPA's /auth/callback page,
 * which then calls this API same-origin.
 */
export function setOAuthStateCookie(c: Context<App>, state: string): void {
	setCookie(c, OAUTH_STATE_COOKIE, state, {
		httpOnly: true,
		secure: shouldUseSecureSessionCookie(c),
		sameSite: 'Lax',
		maxAge: OAUTH_STATE_COOKIE_TTL_SECONDS,
		path: '/',
	})
}

/** Narrow an oauth_states.metadata blob to the temp-op shape, or null if it is not one. */
function getTempopMetadata(metadata: OAuthStateMetadata | null): TempopOAuthMetadata | null {
	return metadata && 'key' in metadata ? metadata : null
}

/** Narrow an oauth_states.metadata blob to the claim-main shape, or null if it is not one. */
function getClaimMainMetadata(metadata: OAuthStateMetadata | null): ClaimMainOAuthMetadata | null {
	return metadata && 'characterId' in metadata ? metadata : null
}

interface AuthSessionPermissionView {
	permissionId: string | null
	urn: string
	name: string
	description: string | null
}

interface AuthSessionUserView {
	id: string
	mainCharacterId: string
	characters: Array<{
		characterId: string
		characterName: string
		hasValidToken: boolean
	}>
	is_admin: boolean
	roles: string[]
	discord: Awaited<ReturnType<typeof getDiscordStatus>>
	legacyAuth: {
		userId: string | null
		username: string | null
		isLinked: boolean
	}
}

export interface AuthSessionResponse {
	authenticated: boolean
	user: AuthSessionUserView | null
	permissions: AuthSessionPermissionView[]
}

export function buildAuthSessionResponse(
	user: AuthSessionUserView,
	permissions: Array<{
		permissionId?: string | null
		urn: string
		name: string
		description: string | null
	}>
): AuthSessionResponse
export function buildAuthSessionResponse(
	user: null,
	permissions?: Array<{
		permissionId?: string | null
		urn: string
		name: string
		description: string | null
	}>
): AuthSessionResponse
export function buildAuthSessionResponse(
	user: AuthSessionUserView | null,
	permissions: Array<{
		permissionId?: string | null
		urn: string
		name: string
		description: string | null
	}> = []
): AuthSessionResponse {
	if (!user) {
		return {
			authenticated: false,
			user: null,
			permissions: [],
		}
	}

	return {
		authenticated: true,
		user,
		permissions: permissions.map((permission) => ({
			permissionId: permission.permissionId ?? null,
			urn: permission.urn,
			name: permission.name,
			description: permission.description,
		})),
	}
}

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
		logger.error('[Auth] Failed to hydrate character affiliation at link-time', {
			userId,
			characterId,
			error: toErrorMessage(error),
		})
	}

	try {
		const reconcileResult = await reconcileUserCoreMembershipRoles(c.env, userId)
		logger.log('[Auth] Reconciled core membership roles after link-time update', {
			userId,
			characterId,
			desiredCount: reconcileResult.desiredCount,
			attachedCount: reconcileResult.attachedCount,
			detachedCount: reconcileResult.detachedCount,
			finalCount: reconcileResult.roleAttachments.length,
		})
	} catch (error) {
		logger.error('[Auth] Failed to reconcile core membership roles at link-time', {
			userId,
			characterId,
			error: toErrorMessage(error),
		})
	}
}

async function scheduleDirectorHealthRecheckAfterTokenReauth(
	c: Context<App>,
	db: ReturnType<typeof createDb>,
	characterId: string,
	characterName: string
): Promise<void> {
	try {
		const corporations: ManagedCorporationSummary[] = await db.query.managedCorporations.findMany({
			where: eq(managedCorporations.isActive, true),
			columns: {
				corporationId: true,
				name: true,
			},
		})

		if (corporations.length === 0) {
			return
		}
		const result = await recheckDirectorHealthAfterTokenReauth({
			characterId,
			characterName,
			corporations,
			getCorporationStub: (corporationId): DirectorHealthRecheckStub =>
				getStub<DirectorHealthRecheckStub>(c.env.EVE_CORPORATION_DATA, corporationId),
			updateManagedCorporationHealth: async ({ corporationId, healthyDirectorCount }) => {
				await db
					.update(managedCorporations)
					.set({
						healthyDirectorCount,
						isVerified: healthyDirectorCount > 0,
						lastVerified: new Date(),
						updatedAt: new Date(),
					})
					.where(eq(managedCorporations.corporationId, corporationId))
			},
		})

		if (result.matchedCorporations.length === 0) {
			return
		}

		if (result.matchedCorporations.length > 1) {
			logger.warn('[Auth] Character is configured as director in multiple corporations', {
				characterId,
				characterName,
				corporationIds: result.matchedCorporations,
			})
		}

		for (const corporationId of result.verifiedCorporations) {
			logger.log('[Auth] Director recovered after token reauth', {
				characterId,
				characterName,
				corporationId,
			})
		}
	} catch (error) {
		logger.error('[Auth] Failed to schedule director health recheck after token reauth', {
			characterId,
			characterName,
			error: toErrorMessage(error),
		})
	}
}

function triggerDirectorHealthRecheckAfterTokenReauth(
	c: Context<App>,
	db: ReturnType<typeof createDb>,
	characterId: string,
	characterName: string
): void {
	waitUntilWithTelemetry(
		c.executionCtx,
		'auth.director-health-recheck',
		() => scheduleDirectorHealthRecheckAfterTokenReauth(c, db, characterId, characterName),
		{
			characterId,
			characterName,
			source: 'oauth-callback',
		}
	)
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
 * Handle the EVE SSO callback for a Mumble temp-op guest.
 *
 * Verifies the minimal publicData token (no persistence), re-validates the
 * temp-op, provisions the ephemeral guest account, and returns JSON with a
 * temp-op landing URL. The SPA then navigates to the public landing page with
 * a single-use credential handoff token.
 */
async function handleMumbleTempopCallback(
	c: Context<App>,
	code: string,
	metadata: TempopOAuthMetadata | null
): Promise<Response> {
	const key = metadata?.key ?? null
	const tempopId = metadata?.tempopId ?? null

	if (!key || !tempopId) {
		return c.json(
			{
				success: false,
				error: 'Invalid temp-op authentication state',
			},
			400
		)
	}

	try {
		const db = createDb(c.env.DATABASE_URL)

		// Re-validate the temp-op is still live before provisioning.
		const tempop = await db.query.mumbleTempops.findFirst({
			where: eq(mumbleTempops.id, tempopId),
			columns: { id: true, status: true, expiresAt: true },
		})
		if (!tempop || tempop.status !== 'active' || tempop.expiresAt.getTime() <= Date.now()) {
			return c.json(
				{
					success: false,
					error: 'This temp-op link has expired.',
				},
				400
			)
		}

		const eveTokenStoreStub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')
		const verified = await eveTokenStoreStub.verifyPublicDataCallback(code)
		if ('error' in verified) {
			return c.json(
				{
					success: false,
					error: 'EVE login failed. Please try again.',
				},
				400
			)
		}

		// Refuse blacklisted characters from joining voice via a temp-op.
		const hrStub = getStub<Hr>(c.env.HR, 'default')
		const blacklisted = await findBlacklistedCharacterTrigger(
			hrStub,
			verified.characterId,
			verified.characterName
		)
		if (blacklisted) {
			return c.json(
				{
					success: false,
					error: 'This character is not permitted to join this voice server.',
				},
				403
			)
		}

		const credentials = await provisionTempopGuest(c.env, {
			tempopId,
			characterId: verified.characterId,
		})

		const handoff = await storeCredentialHandoff(c.env, tempopId, {
			loginName: credentials.loginName,
			password: credentials.password,
			host: credentials.connection.host,
			port: credentials.connection.port,
		})

		return c.json({
			success: true,
			redirectUrl: `/tempop/${key}?provisioned=1&h=${encodeURIComponent(handoff)}`,
		})
	} catch (error) {
		logger.error('[Mumble] Temp-op guest provisioning failed', {
			tempopId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json(
			{
				success: false,
				error: 'Could not create your voice account. Please try again.',
			},
			500
		)
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

	// Tie this state to the browser we are about to send to EVE, so only that browser can
	// complete the flow.
	setOAuthStateCookie(c, authUrl.state)

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

	setOAuthStateCookie(c, authUrl.state)

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

	setOAuthStateCookie(c, authUrl.state)

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

	if (!state) {
		return c.json({ error: 'Missing state parameter' }, 400)
	}

	// SECURITY: this pair of checks is the login-CSRF defence, and BOTH halves are load-bearing.
	//
	// The oauth_states row (checked below) proves only that *a* flow was started — it is not
	// evidence about *this* browser, because /auth/login and /auth/login/start are
	// unauthenticated and hand a valid state to any caller. An attacker can therefore mint a
	// state, complete SSO as their own character, and walk a victim through this endpoint with
	// the attacker's code; every DB-side check would pass and the victim's browser would be
	// left holding a 30-day session on the attacker's account.
	//
	// The cookie is what ties the state to the browser that started the flow. It is HttpOnly,
	// so an attacker cannot plant their own state in the victim's browser. Note the EVE token
	// store accepts `state` but uses it only as a log tag, so nothing downstream re-checks this.
	const boundState = getCookie(c, OAUTH_STATE_COOKIE)
	deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/' })

	if (!boundState || boundState !== state) {
		return c.json({ error: 'OAuth state does not match this browser. Please try again.' }, 400)
	}

	const db = createDb(c.env.DATABASE_URL)
	const eveTokenStoreStub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

	const authService = new AuthService(db, eveTokenStoreStub, c.env.SESSION_SECRET)
	const userService = new UserService(db)
	const activityService = new ActivityService(db)

	const oauthState = await db.query.oauthStates.findFirst({
		where: eq(oauthStates.state, state),
	})

	if (!oauthState) {
		return c.json({ error: 'Invalid OAuth state' }, 400)
	}

	// Check if state has expired
	if (new Date() > oauthState.expiresAt) {
		await db.delete(oauthStates).where(eq(oauthStates.state, state))
		// Guest temp-op flows render in the SPA, so surface a usable error
		// on the landing page rather than a raw JSON response.
		if (oauthState.flowType === 'mumble-tempop') {
			const expiredKey = getTempopMetadata(oauthState.metadata)?.key ?? ''
			return c.redirect(`/tempop/${expiredKey}?error=expired`)
		}
		return c.json({ error: 'OAuth state has expired. Please try again.' }, 400)
	}

	// Only flows that actually terminate here may be replayed here. This notably excludes
	// 'claim-main' tickets, which live in the same table but are redeemable only at
	// /auth/claim-main.
	if (!isCallbackFlowType(oauthState.flowType)) {
		return c.json({ error: 'Invalid flow type' }, 400)
	}

	const flowType = oauthState.flowType
	const stateUserId = oauthState.userId
	const redirectUrl = oauthState.redirectUrl
	const stateMetadata = oauthState.metadata

	// Delete the state after use (one-time use)
	await db.delete(oauthStates).where(eq(oauthStates.state, state))

	// Mumble temp-op guest flow: minimal publicData identity → ephemeral voice
	// credentials. Handled separately because guests never carry full scopes and
	// no token is persisted (handleCallback would reject and over-persist).
	if (flowType === 'mumble-tempop') {
		return handleMumbleTempopCallback(c, code, getTempopMetadata(stateMetadata))
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
				const existingCharacter = user.characters.find((char) => char.characterId === characterId)
				await db
					.update(userCharacters)
					.set({ hasValidToken: true, updatedAt: new Date() })
					.where(eq(userCharacters.characterId, characterId))
				triggerDirectorHealthRecheckAfterTokenReauth(
					c,
					db,
					characterId,
					characterInfo.characterName
				)

				// Character already linked to this user - token has been updated, just return success
				return c.json({
					characterLinked: true,
					tokenUpdated: true,
					character: existingCharacter
						? { ...existingCharacter, hasValidToken: true }
						: existingCharacter,
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
		triggerDirectorHealthRecheckAfterTokenReauth(c, db, characterId, characterInfo.characterName)

		await activityService.logCharacterLinked(stateUserId, characterId, getRequestMetadata(c))
		triggerLegacyMigrationRecheck(c, stateUserId)

		// Fetch character data in background (non-blocking)
		const eveCharacterDataStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')
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

				await createWorkflow(c.env.USER_REFRESH_WORKFLOW, {
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
				c.env.ESI,
				c.env.EVE_CORPORATION_DATA
			)
		} catch (error) {
			// Don't fail character linking if auto-registration fails
			logger.error('[Auth] Auto-registration failed:', toErrorMessage(error))
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
		// SECURITY: EVE rotates CharacterOwnerHash whenever a character changes hands (a
		// Character Bazaar sale, or any transfer). It is the only evidence CCP gives us that
		// the human behind this character is no longer the human who linked it, so a mismatch
		// must never mint a session onto the previous owner's account — that would hand the
		// buyer every alt, role and permission the seller had.
		//
		// This is checked before the blacklist and before anything else reads `user`, because
		// a broken identity binding makes every other fact about that account meaningless.
		// Fail closed: refuse both parties and let an admin decide, rather than silently
		// migrating or destroying an account on the strength of one hash comparison.
		const ownership = await userService.getCharacterOwnership(characterId)

		if (ownership?.characterOwnerHash.startsWith(LEGACY_IMPORT_HASH_PREFIX)) {
			// Legacy-imported links carry a placeholder, never a CCP hash, so there is nothing
			// meaningful to compare against — the import asserted ownership without proving it.
			// This SSO round-trip is the first real proof we have ever had for this character, so
			// adopt its hash. Without this branch every migrated user is refused on sight and has
			// their sessions wiped, with no self-service path back.
			await userService.adoptCharacterOwnerHash(characterId, characterInfo.characterOwnerHash)
			logger.info('[Auth] Adopted real owner hash for legacy-imported character', {
				characterId,
				userId: ownership.userId,
			})
		} else if (ownership && ownership.characterOwnerHash !== characterInfo.characterOwnerHash) {
			const sessionService = new SessionService(db)
			await sessionService.invalidateAllUserSessions(ownership.userId)
			await activityService.logLoginFailed(
				characterId,
				'Character owner hash mismatch - character ownership has changed',
				getRequestMetadata(c)
			)
			logger.warn('[Auth] Character owner hash mismatch, refusing login', {
				characterId,
				userId: ownership.userId,
			})

			return c.json(
				{
					error:
						'This character has changed ownership since it was linked. ' +
						'For security, access has been suspended. Please contact an administrator.',
				},
				403
			)
		}

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
		triggerDirectorHealthRecheckAfterTokenReauth(c, db, characterId, characterInfo.characterName)

		await activityService.logLogin(user.id, characterId, getRequestMetadata(c))

		// Fetch character data in background (non-blocking)
		const eveCharacterDataStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')
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

					await createWorkflow(c.env.USER_REFRESH_WORKFLOW, {
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
				c.env.ESI,
				c.env.EVE_CORPORATION_DATA
			)
		} catch (error) {
			// Don't fail login if auto-registration fails
			logger.error('[Auth] Auto-registration failed:', toErrorMessage(error))
		}

		// Set session cookie
		setCookie(c, 'session', session.sessionToken, {
			httpOnly: true,
			secure: shouldUseSecureSessionCookie(c),
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

	// New user - mint a single-use ticket bound to the character SSO just verified, and hand
	// the client that instead of trusting it to tell us which character to claim. The
	// characterInfo below is display data for the confirmation screen; nothing is authorized
	// from it.
	const claimTicket = crypto.randomUUID()
	await db.insert(oauthStates).values({
		state: claimTicket,
		flowType: 'claim-main',
		userId: null,
		redirectUrl: redirectUrl || null,
		expiresAt: new Date(Date.now() + CLAIM_TICKET_TTL_MS),
		metadata: {
			characterId,
			characterName: characterInfo.characterName,
			characterOwnerHash: characterInfo.characterOwnerHash,
		} satisfies ClaimMainOAuthMetadata,
	})

	return c.json({
		requiresClaimMain: true,
		claimTicket,
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
 * This should be called after a successful callback for a new user, with the claim ticket
 * that callback issued.
 *
 * SECURITY: this endpoint is deliberately unauthenticated — the caller has no account yet,
 * which is the whole point of it. Authority therefore comes from the claim ticket, which is
 * minted only by /auth/callback after EVE SSO proves the caller controls the character, and
 * which names that character server-side. Never reintroduce a characterId (or any other
 * object selector) read from the request body here: `getTokenInfo` resolves whatever id it
 * is handed with no notion of who is asking, so a body-supplied id let any unauthenticated
 * caller mint an account and a 30-day session for any character that had authenticated but
 * not yet been claimed.
 */
auth.post('/claim-main', async (c) => {
	const body = await c.req.json()
	const { claimTicket } = body

	if (!claimTicket || typeof claimTicket !== 'string') {
		return c.json({ error: 'Missing claim ticket' }, 400)
	}

	const db = createDb(c.env.DATABASE_URL)
	const eveTokenStoreStub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

	const authService = new AuthService(db, eveTokenStoreStub, c.env.SESSION_SECRET)
	const userService = new UserService(db)
	const activityService = new ActivityService(db)

	// Resolve which character is being claimed from the ticket, never from the request.
	const ticket = await db.query.oauthStates.findFirst({
		where: eq(oauthStates.state, claimTicket),
	})

	if (!ticket || ticket.flowType !== 'claim-main') {
		return c.json({ error: 'Invalid or expired claim ticket. Please login again.' }, 400)
	}

	if (new Date() > ticket.expiresAt) {
		await db.delete(oauthStates).where(eq(oauthStates.state, claimTicket))
		return c.json({ error: 'Claim ticket has expired. Please login again.' }, 400)
	}

	const claimMetadata = getClaimMainMetadata(ticket.metadata)

	if (!claimMetadata) {
		return c.json({ error: 'Invalid claim ticket. Please login again.' }, 400)
	}

	// Burn the ticket before doing any work, so a failure below cannot leave a replayable
	// ticket behind. The cost is that a retry needs a fresh SSO round-trip.
	await db.delete(oauthStates).where(eq(oauthStates.state, claimTicket))

	const characterId = claimMetadata.characterId

	// Fetch verified character data from token store
	const tokenInfo = await eveTokenStoreStub.getTokenInfo(characterId)

	if (!tokenInfo) {
		return c.json({ error: 'Character not authenticated. Please login first.' }, 400)
	}

	// SECURITY: the token store holds *current* state, so if the character changed hands
	// between minting and redeeming this ticket, tokenInfo now describes the new owner. Pin it
	// to what SSO verified when the ticket was issued, or we would stamp the buyer's hash onto
	// the account the seller is creating and lock the seller out of it forever.
	if (tokenInfo.characterOwnerHash !== claimMetadata.characterOwnerHash) {
		logger.warn('[Auth] claim-main ticket owner hash no longer matches, refusing', {
			characterId,
		})
		return c.json({ error: 'This character has changed ownership. Please login again.' }, 400)
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
	let user: UserProfileDTO
	try {
		user = await userService.createUser({
			characterOwnerHash: tokenInfo.characterOwnerHash,
			characterId: tokenInfo.characterId,
			characterName: tokenInfo.characterName,
		})
	} catch (error) {
		// A lost race (double submit, stale tab) is not a server fault, so answer it rather than
		// letting it surface as an unhandled 500 — which also made this endpoint a
		// claimed/unclaimed oracle, since 400/500/200 were three distinguishable answers.
		// Everything else IS a fault and must keep reaching Sentry rather than being flattened
		// into a reassuring 409.
		if (error instanceof CharacterAlreadyClaimedError) {
			logger.warn('[Auth] claim-main lost a race for this character', {
				characterId,
				reason: toErrorMessage(error),
			})
			return c.json({ error: 'This character has already been claimed. Please login again.' }, 409)
		}

		captureException(error as Error, {
			tags: { route: 'auth.claim-main', characterId },
		})
		throw error
	}

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
	const eveCharacterDataStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')
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

			await createWorkflow(c.env.USER_REFRESH_WORKFLOW, {
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
			c.env.ESI,
			c.env.EVE_CORPORATION_DATA
		)
	} catch (error) {
		// Don't fail user creation if auto-registration fails
		logger.error('[Auth] Auto-registration failed:', toErrorMessage(error))
	}

	// Set session cookie
	setCookie(c, 'session', session.sessionToken, {
		httpOnly: true,
		secure: shouldUseSecureSessionCookie(c),
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
		return c.json(buildAuthSessionResponse(null))
	}

	// Fetch user permissions (cached for 15 seconds)
	const permissions = await getCachedUserPermissions(c.env, user.id)

	// Lazy-load Discord status if needed
	const discordStatus = await getDiscordStatus(c)

	// Reuse the full profile already loaded by session middleware.
	// Fall back to a direct DB lookup only if something unexpected bypassed the middleware.
	let profile = c.get('userProfile')
	if (!profile) {
		const db = c.get('db') || createDb(c.env.DATABASE_URL)
		const userService = new UserService(db)

		try {
			profile = await userService.getUserProfile(user.id)
		} catch (error) {
			logger.error('[Auth Session] Failed to fetch user profile', {
				userId: user.id,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
			throw error
		}
	}

	// Build legacy auth status
	const isLinked = !!(profile.legacyAuthUserId && profile.legacyAuthUserUsername)
	const legacyAuth = {
		userId: profile.legacyAuthUserId,
		username: profile.legacyAuthUserUsername,
		isLinked,
	}

	return c.json(
		buildAuthSessionResponse(
			{
				id: user.id,
				mainCharacterId: user.mainCharacterId,
				characters: user.characters,
				is_admin: user.is_admin,
				roles: user.roles,
				discord: discordStatus,
				legacyAuth,
			},
			permissions
		)
	)
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
		logger.error('[Legacy Auth] Token exchange failed:', errorText)
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

	logger.log('[Legacy Auth] Access token fetched', {
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
		logger.error(
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
