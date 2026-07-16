import { Hono } from 'hono'

import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { MUMBLE_FEATURE_FLAG_KEY } from '@repo/features'

import { createDb } from '../db'
import { mumbleTempops, oauthStates } from '../db/schema'
import { consumeCredentialHandoff, hashToken } from '../services/mumble-tempop.service'
import { setOAuthStateCookie } from './auth'
import { resolveFlag } from './flags'

import type { EveTokenStore } from '@repo/eve-token-store'
import type { App } from '../context'
import type { Context } from 'hono'

/** OAuth state lifetime for the guest SSO flow (15 minutes). */
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000

// Best-effort in-memory rate limiter. Per-isolate only (resets on recycle),
// which is acceptable for these low-value, read-mostly public endpoints.
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX = 30
const rateLimitBuckets = new Map<string, number[]>()

function getClientIp(c: Context<App>): string {
	return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown'
}

function isRateLimited(bucketKey: string): boolean {
	const now = Date.now()
	const hits = (rateLimitBuckets.get(bucketKey) ?? []).filter(
		(timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS
	)
	if (hits.length >= RATE_LIMIT_MAX) {
		rateLimitBuckets.set(bucketKey, hits)
		return true
	}
	hits.push(now)
	rateLimitBuckets.set(bucketKey, hits)
	return false
}

/**
 * Public (unauthenticated) Mumble temp-op routes.
 *
 * Mounted at /api/public/mumble-tempop. Guests resolve a temp-op by its URL
 * token, start a minimal publicData SSO, and exchange a single-use handoff for
 * their one-time credentials. Gated only by the Mumble feature flag.
 */
const publicMumbleTempopRoutes = new Hono<App>().use('*', async (c, next) => {
	const enabled = await resolveFlag(c.env.FEATURES, MUMBLE_FEATURE_FLAG_KEY, false)
	if (!enabled) {
		return c.json({ error: 'Not found' }, 404)
	}
	await next()
})

/**
 * GET /api/public/mumble-tempop/:key
 * Resolve a temp-op by token. Never leaks creator identity.
 */
publicMumbleTempopRoutes.get('/:key', async (c) => {
	const key = c.req.param('key')
	if (isRateLimited(`info:${getClientIp(c)}`)) {
		return c.json({ error: 'Too many requests' }, 429)
	}

	const db = createDb(c.env.DATABASE_URL)
	const keyHash = await hashToken(key)
	const tempop = await db.query.mumbleTempops.findFirst({
		where: eq(mumbleTempops.keyHash, keyHash),
		columns: { status: true, groupName: true, expiresAt: true },
	})

	if (!tempop || tempop.status === 'deleted') {
		return c.json({ valid: false, expired: false }, 404)
	}

	const expired = tempop.status === 'expired' || tempop.expiresAt.getTime() <= Date.now()
	return c.json({
		valid: !expired,
		expired,
		groupName: tempop.groupName,
		expiresAt: tempop.expiresAt.toISOString(),
	})
})

/**
 * POST /api/public/mumble-tempop/:key/start-sso
 * Begin the minimal publicData SSO for a guest. Returns the authorization URL.
 */
publicMumbleTempopRoutes.post('/:key/start-sso', async (c) => {
	const key = c.req.param('key')
	if (isRateLimited(`sso:${getClientIp(c)}`)) {
		return c.json({ error: 'Too many requests' }, 429)
	}

	const db = createDb(c.env.DATABASE_URL)
	const keyHash = await hashToken(key)
	const tempop = await db.query.mumbleTempops.findFirst({
		where: eq(mumbleTempops.keyHash, keyHash),
		columns: { id: true, status: true, expiresAt: true },
	})

	if (!tempop || tempop.status !== 'active' || tempop.expiresAt.getTime() <= Date.now()) {
		return c.json({ error: 'This temp-op link is no longer valid' }, 404)
	}

	const state = crypto.randomUUID()
	await db.insert(oauthStates).values({
		state,
		flowType: 'mumble-tempop',
		userId: null,
		redirectUrl: null,
		metadata: { key, tempopId: tempop.id },
		expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
	})

	// This flow completes at /auth/callback, which requires the state to be bound to the
	// browser that started it.
	setOAuthStateCookie(c, state)

	const eveTokenStoreStub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')
	const { url } = await eveTokenStoreStub.startPublicDataFlow(state)
	return c.json({ authorizationUrl: url })
})

/**
 * GET /api/public/mumble-tempop/:key/credentials?h=<handoff>
 * Exchange a single-use handoff token for the freshly provisioned credentials.
 */
publicMumbleTempopRoutes.get('/:key/credentials', async (c) => {
	const handoff = c.req.query('h')
	if (!handoff) {
		return c.json({ error: 'Missing handoff token' }, 400)
	}

	const credentials = await consumeCredentialHandoff(c.env, handoff)
	if (!credentials) {
		return c.json({ error: 'Credentials are no longer available' }, 404)
	}

	return c.json({
		loginName: credentials.loginName,
		password: credentials.password,
		connection: { host: credentials.host, port: credentials.port },
	})
})

export default publicMumbleTempopRoutes
