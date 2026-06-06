import { Hono } from 'hono'
import { z } from 'zod'

import { logger } from '@repo/hono-helpers'

import { getStub } from '@repo/do-utils'

import { requireAuth } from '../middleware/session'

import type {
	OAuthSessionUser,
} from '@repo/admin'
import type { App, SessionUser } from '../context'

const app = new Hono<App>()

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

function getThirdPartyAppsClient(c: App['Bindings']) {
	return c.THIRD_PARTY_APPS
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
		const client = getThirdPartyAppsClient(c.env)
		const preview = await client.previewAuthorization(requestUrl, expectedOrigin)
		if (!preview) {
			return c.json({ error: 'Invalid authorization request' }, 400)
		}

		return c.json({
			requestUrl,
			...preview,
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

	try {
		const client = getThirdPartyAppsClient(c.env)
		const result = await client.resolveAuthorization(
			parsed.data.requestUrl,
			expectedOrigin,
			toOAuthSessionUser(user),
			parsed.data.action
		)
		if (!result) {
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
