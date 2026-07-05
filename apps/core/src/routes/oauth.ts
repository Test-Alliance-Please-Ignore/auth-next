import { Hono } from 'hono'
import { z } from 'zod'

import { logger } from '@repo/hono-helpers'

import { getThirdPartyAppsFetchBinding } from '../lib/third-party-apps'
import { requireAuth } from '../middleware/session'

import type {
	OAuthAuthorizationPreview,
	OAuthAuthorizationResult,
	OAuthSessionUser,
} from '@repo/admin'
import type { App, SessionUser } from '../context'

const app = new Hono<App>()
const OAUTH_CONSENT_MAX_SESSION_AGE_MS = 2 * 24 * 60 * 60 * 1000

const authorizeActionSchema = z.object({
	requestUrl: z.string().url(),
	action: z.enum(['approve', 'deny']),
})

function isLocalDev(c: App['Bindings']): boolean {
	return c.ENVIRONMENT === 'development'
}

function isAllowedLocalHttpUrl(url: URL): boolean {
	return (
		url.protocol === 'http:' &&
		(url.hostname === 'localhost' ||
			url.hostname === '127.0.0.1' ||
			url.hostname === '[::1]' ||
			url.hostname.endsWith('.localhost'))
	)
}

function validateAuthorizeRequestUrl(
	env: App['Bindings'],
	requestUrl: string,
	expectedOrigin: string
): boolean {
	try {
		const url = new URL(requestUrl)
		if (url.pathname !== '/authorize') return false
		if (isLocalDev(env) && isAllowedLocalHttpUrl(url)) return true
		return url.protocol === 'https:' && url.origin === expectedOrigin
	} catch {
		return false
	}
}

function toOAuthSessionUser(user: SessionUser): OAuthSessionUser {
	return {
		id: user.id,
		mainCharacterId: user.mainCharacterId,
		isAdmin: user.is_admin,
		sessionCreatedAt: user.sessionCreatedAt,
		characters: user.characters.map((character) => ({
			id: character.id,
			characterOwnerHash: character.characterOwnerHash,
			characterId: character.characterId,
			characterName: character.characterName,
			isPrimary: character.is_primary,
			hasValidToken: character.hasValidToken,
		})),
	}
}

function isFreshOAuthConsentSession(sessionCreatedAt?: string | null): boolean {
	if (!sessionCreatedAt) return false
	const createdAtMs = Date.parse(sessionCreatedAt)
	if (Number.isNaN(createdAtMs)) return false
	// Consent should require a recent interactive login, not just any active session.
	return Date.now() - createdAtMs <= OAUTH_CONSENT_MAX_SESSION_AGE_MS
}

app.get('/authorize', requireAuth(), async (c) => {
	const requestUrl = c.req.query('requestUrl')
	if (!requestUrl) {
		return c.json({ error: 'Missing requestUrl' }, 400)
	}
	const expectedOrigin = new URL(c.req.url).origin
	if (!validateAuthorizeRequestUrl(c.env, requestUrl, expectedOrigin)) {
		return c.json({ error: 'Invalid authorization request URL' }, 400)
	}

	try {
		const client = getThirdPartyAppsFetchBinding(c.env)
		if (!client) {
			return c.json({ error: 'Third-party apps service binding is not configured' }, 503)
		}
		const previewResponse = await client.fetch(
			new Request('http://third-party-apps.internal/__internal/oauth/authorize/preview', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ requestUrl, expectedOrigin }),
			})
		)
		if (!previewResponse.ok) {
			logger.warn('[OAuthRoute.authorize.preview] Internal preview request failed', {
				requestUrl,
				expectedOrigin,
				status: previewResponse.status,
				environment: c.env.ENVIRONMENT,
			})
			return c.json({ error: 'Failed to load authorization request' }, 500)
		}
		const preview = (await previewResponse.json().catch(() => null)) as OAuthAuthorizationPreview | null
		if (!preview) {
			logger.warn('[OAuthRoute.authorize.preview] Authorization request rejected by provider', {
				requestUrl,
				expectedOrigin,
				userId: c.get('user')?.id ?? null,
				environment: c.env.ENVIRONMENT,
			})
			return c.json({ error: 'Invalid authorization request' }, 400)
		}

		return c.json({
			requestUrl,
			...preview,
			requiresFreshSession: !isFreshOAuthConsentSession(c.get('user')?.sessionCreatedAt),
		})
	} catch (error) {
		logger.error('[OAuthRoute.authorize.preview] Failed', {
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to load authorization request' }, 500)
	}
})

app.post('/authorize', requireAuth(), async (c) => {
	const parsed = authorizeActionSchema.safeParse(await c.req.json().catch(() => ({})))
	if (!parsed.success) {
		return c.json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400)
	}
	const expectedOrigin = new URL(c.req.url).origin
	if (!validateAuthorizeRequestUrl(c.env, parsed.data.requestUrl, expectedOrigin)) {
		return c.json({ error: 'Invalid authorization request URL' }, 400)
	}

	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}
	if (!isFreshOAuthConsentSession(user.sessionCreatedAt)) {
		return c.json(
			{
				error: 'Reauthentication required. Please sign in again to continue.',
				reauthRequired: true,
			},
			401
		)
	}

	try {
		const client = getThirdPartyAppsFetchBinding(c.env)
		if (!client) {
			return c.json({ error: 'Third-party apps service binding is not configured' }, 503)
		}
		const resultResponse = await client.fetch(
			new Request('http://third-party-apps.internal/__internal/oauth/authorize/resolve', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					requestUrl: parsed.data.requestUrl,
					expectedOrigin,
					user: toOAuthSessionUser(user),
					action: parsed.data.action,
				}),
			})
		)
		if (!resultResponse.ok) {
			logger.warn('[OAuthRoute.authorize.resolve] Internal resolve request failed', {
				requestUrl: parsed.data.requestUrl,
				expectedOrigin,
				userId: user.id,
				action: parsed.data.action,
				status: resultResponse.status,
				environment: c.env.ENVIRONMENT,
			})
			return c.json({ error: 'Failed to complete authorization' }, 500)
		}
		const result = (await resultResponse.json().catch(() => null)) as OAuthAuthorizationResult | null
		if (!result) {
			logger.warn('[OAuthRoute.authorize.resolve] Authorization resolution rejected by provider', {
				requestUrl: parsed.data.requestUrl,
				expectedOrigin,
				userId: user.id,
				action: parsed.data.action,
				environment: c.env.ENVIRONMENT,
			})
			return c.json({ error: 'Invalid authorization request' }, 400)
		}

		return c.json(result)
	} catch (error) {
		logger.error('[OAuthRoute.authorize.resolve] Failed', {
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to complete authorization' }, 500)
	}
})

export default app
