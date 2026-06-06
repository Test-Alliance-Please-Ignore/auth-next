import { Hono } from 'hono'
import { z } from 'zod'

import { logger } from '@repo/hono-helpers'
import { THIRD_PARTY_APP_SUPPORTED_SCOPES } from '@repo/admin'

import { requireAdmin, requireAuth } from '../../middleware/session'

import type {
	OAuthClientCreateInput,
	OAuthClientListOptions,
	OAuthClientUpdateInput,
	ThirdPartyAppScope,
} from '@repo/admin'
import type { App } from '../../context'

const app = new Hono<App>()
const supportedScopes = THIRD_PARTY_APP_SUPPORTED_SCOPES as readonly [ThirdPartyAppScope, ...ThirdPartyAppScope[]]

const clientCreateSchema = z.object({
	clientName: z.string().min(1).max(200),
	redirectUris: z.array(z.string().url()).min(1),
	scopes: z.array(z.enum(supportedScopes)).min(1),
	tokenEndpointAuthMethod: z.enum(['client_secret_basic', 'client_secret_post', 'none']),
	grantTypes: z.array(z.enum(['authorization_code', 'refresh_token'])).min(1),
	responseTypes: z.array(z.enum(['code'])).min(1),
	clientUri: z.string().url().optional(),
	logoUri: z.string().url().optional(),
	contacts: z.array(z.string().email()).optional(),
	policyUri: z.string().url().optional(),
	tosUri: z.string().url().optional(),
	jwksUri: z.string().url().optional(),
})

const clientUpdateSchema = clientCreateSchema
	.partial()
	.refine((value) => Object.keys(value).length > 0, 'At least one field must be provided')

function toListOptions(
	limitRaw: string | null | undefined,
	cursor: string | null | undefined
): OAuthClientListOptions {
	const limit = Number.parseInt(limitRaw ?? '50', 10)
	return {
		limit: Number.isFinite(limit) ? Math.min(100, Math.max(1, limit)) : 50,
		cursor: cursor ?? undefined,
	}
}

function getThirdPartyAppsClient(c: App['Bindings']) {
	return c.THIRD_PARTY_APPS
}

function isLocalDev(c: App['Bindings']): boolean {
	return c.ENVIRONMENT === 'development'
}

function isAllowedLocalHttpRedirect(url: URL): boolean {
	return (
		url.protocol === 'http:' &&
		(url.hostname === 'localhost' ||
			url.hostname === '127.0.0.1' ||
			url.hostname === '[::1]' ||
			url.hostname.endsWith('.localhost'))
	)
}

function validateRedirectUris(env: App['Bindings'], redirectUris: string[] | undefined): string | null {
	if (!redirectUris) return null
	for (const redirectUri of redirectUris) {
		const url = new URL(redirectUri)
		if (url.protocol === 'https:') continue
		if (isLocalDev(env) && isAllowedLocalHttpRedirect(url)) continue
		return `Redirect URI must use HTTPS: ${redirectUri}`
	}
	return null
}

app.get('/clients', requireAuth(), requireAdmin(), async (c) => {
	try {
		const client = getThirdPartyAppsClient(c.env)
		const result = await client.listClients(
			toListOptions(c.req.query('limit'), c.req.query('cursor'))
		)
		return c.json(result)
	} catch (error) {
		logger.error('[AdminRoute.thirdPartyApps.listClients] Failed', {
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to list OAuth clients' }, 500)
	}
})

app.post('/clients', requireAuth(), requireAdmin(), async (c) => {
	const parsed = clientCreateSchema.safeParse(await c.req.json().catch(() => ({})))
	if (!parsed.success) {
		return c.json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400)
	}
	const redirectError = validateRedirectUris(c.env, parsed.data.redirectUris)
	if (redirectError) {
		return c.json({ error: redirectError }, 400)
	}

	try {
		const client = getThirdPartyAppsClient(c.env)
		const created = await client.createClient(parsed.data as OAuthClientCreateInput)
		return c.json(created, 201)
	} catch (error) {
		logger.error('[AdminRoute.thirdPartyApps.createClient] Failed', {
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to create OAuth client' }, 500)
	}
})

app.patch('/clients/:clientId', requireAuth(), requireAdmin(), async (c) => {
	const clientId = c.req.param('clientId')
	const parsed = clientUpdateSchema.safeParse(await c.req.json().catch(() => ({})))
	if (!parsed.success) {
		return c.json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400)
	}
	const redirectError = validateRedirectUris(c.env, parsed.data.redirectUris)
	if (redirectError) {
		return c.json({ error: redirectError }, 400)
	}

	try {
		const client = getThirdPartyAppsClient(c.env)
		const updated = await client.updateClient(clientId, parsed.data as OAuthClientUpdateInput)
		if (!updated) {
			return c.json({ error: 'OAuth client not found' }, 404)
		}
		return c.json(updated)
	} catch (error) {
		logger.error('[AdminRoute.thirdPartyApps.updateClient] Failed', {
			clientId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to update OAuth client' }, 500)
	}
})

app.delete('/clients/:clientId', requireAuth(), requireAdmin(), async (c) => {
	const clientId = c.req.param('clientId')

	try {
		const client = getThirdPartyAppsClient(c.env)
		await client.deleteClient(clientId)
		return new Response(null, { status: 204 })
	} catch (error) {
		logger.error('[AdminRoute.thirdPartyApps.deleteClient] Failed', {
			clientId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to delete OAuth client' }, 500)
	}
})

app.post('/clients/:clientId/regenerate-secret', requireAuth(), requireAdmin(), async (c) => {
	const clientId = c.req.param('clientId')

	try {
		const client = getThirdPartyAppsClient(c.env)
		const result = await client.regenerateClientSecret(clientId)
		if (!result) {
			return c.json({ error: 'OAuth client not found' }, 404)
		}
		return c.json(result)
	} catch (error) {
		logger.error('[AdminRoute.thirdPartyApps.regenerateClientSecret] Failed', {
			clientId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to regenerate OAuth client secret' }, 500)
	}
})

export default app
