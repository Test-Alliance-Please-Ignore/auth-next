import { Hono } from 'hono'

import { getRequestLogData, logger } from '@repo/hono-helpers'
import { withStaticAuth } from '@repo/static-auth'

import type { App } from './context'
import type { TokenStoreRequest, TokenStoreResponse } from './user-token-store'

/**
 * Admin API router for managing user tokens
 * All routes require static bearer token authentication
 */
export const adminRouter = new Hono<App>()
	.basePath('/admin')
	.use('*', (c, next) =>
		withStaticAuth({
			tokens: c.env.ADMIN_API_TOKENS,
			logTag: 'admin_auth',
		})(c, next)
	)

	// List all tokens (paginated)
	.get('/tokens', async (c) => {
		const limit = parseInt(c.req.query('limit') || '50', 10)
		const offset = parseInt(c.req.query('offset') || '0', 10)

		// Use a global DO instance for listing all tokens
		const id = c.env.USER_TOKEN_STORE.idFromName('global_token_list')
		const stub = c.env.USER_TOKEN_STORE.get(id)

		const request: TokenStoreRequest = {
			action: 'listAllTokens',
			limit,
			offset,
		}

		const response = await stub.fetch('http://do/admin', {
			method: 'POST',
			body: JSON.stringify(request),
		})

		const data = (await response.json()) as TokenStoreResponse

		logger
			.withTags({
				type: 'admin_list_tokens',
			})
			.info('Admin listed tokens', {
				limit,
				offset,
				total: data.data?.total,
				request: getRequestLogData(c, Date.now()),
			})

		return c.json(data, response.status as 200 | 500)
	})

	// Get specific character token info with proxy token
	.get('/tokens/:characterId', async (c) => {
		const characterId = parseInt(c.req.param('characterId'), 10)

		if (isNaN(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}

		const id = c.env.USER_TOKEN_STORE.idFromName(String(characterId))
		const stub = c.env.USER_TOKEN_STORE.get(id)

		const request: TokenStoreRequest = {
			action: 'getProxyToken',
			characterId,
		}

		const response = await stub.fetch('http://do/admin', {
			method: 'POST',
			body: JSON.stringify(request),
		})

		const data = (await response.json()) as TokenStoreResponse

		logger
			.withTags({
				type: 'admin_get_token',
				character_id: characterId,
			})
			.info('Admin retrieved character token', {
				characterId,
				success: data.success,
				request: getRequestLogData(c, Date.now()),
			})

		return c.json(data, response.status as 200 | 404 | 500)
	})

	// Delete token by character ID
	.delete('/tokens/:characterId', async (c) => {
		const characterId = parseInt(c.req.param('characterId'), 10)

		if (isNaN(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}

		const id = c.env.USER_TOKEN_STORE.idFromName(String(characterId))
		const stub = c.env.USER_TOKEN_STORE.get(id)

		const request: TokenStoreRequest = {
			action: 'revokeToken',
			characterId,
		}

		const response = await stub.fetch('http://do/admin', {
			method: 'POST',
			body: JSON.stringify(request),
		})

		const data = (await response.json()) as TokenStoreResponse

		logger
			.withTags({
				type: 'admin_delete_token',
				character_id: characterId,
			})
			.info('Admin deleted character token', {
				characterId,
				success: data.success,
				request: getRequestLogData(c, Date.now()),
			})

		return c.json(data, response.status as 200 | 500)
	})

	// Delete token by proxy token
	.delete('/tokens/proxy/:proxyToken', async (c) => {
		const proxyToken = c.req.param('proxyToken')

		if (!proxyToken || proxyToken.length !== 64) {
			return c.json({ error: 'Invalid proxy token format' }, 400)
		}

		// Use a lookup DO instance
		const id = c.env.USER_TOKEN_STORE.idFromName('proxy_delete')
		const stub = c.env.USER_TOKEN_STORE.get(id)

		const request: TokenStoreRequest = {
			action: 'deleteByProxyToken',
			proxyToken,
		}

		const response = await stub.fetch('http://do/admin', {
			method: 'POST',
			body: JSON.stringify(request),
		})

		const data = (await response.json()) as TokenStoreResponse

		logger
			.withTags({
				type: 'admin_delete_token_by_proxy',
			})
			.info('Admin deleted token by proxy token', {
				proxyToken: proxyToken.substring(0, 8),
				success: data.success,
				request: getRequestLogData(c, Date.now()),
			})

		return c.json(data, response.status as 200 | 404 | 500)
	})

	// Get statistics
	.get('/stats', async (c) => {
		// Use a global DO instance for stats
		const id = c.env.USER_TOKEN_STORE.idFromName('global_stats')
		const stub = c.env.USER_TOKEN_STORE.get(id)

		const request: TokenStoreRequest = {
			action: 'getStats',
		}

		const response = await stub.fetch('http://do/admin', {
			method: 'POST',
			body: JSON.stringify(request),
		})

		const data = (await response.json()) as TokenStoreResponse

		logger
			.withTags({
				type: 'admin_get_stats',
			})
			.info('Admin retrieved statistics', {
				stats: data.data?.stats,
				request: getRequestLogData(c, Date.now()),
			})

		return c.json(data, response.status as 200 | 500)
	})

	// Manually trigger token refresh
	.post('/tokens/:characterId/refresh', async (c) => {
		const characterId = parseInt(c.req.param('characterId'), 10)

		if (isNaN(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}

		const id = c.env.USER_TOKEN_STORE.idFromName(String(characterId))
		const stub = c.env.USER_TOKEN_STORE.get(id)

		// Get the access token, which will trigger a refresh if needed
		const request: TokenStoreRequest = {
			action: 'getAccessToken',
			characterId,
		}

		const response = await stub.fetch('http://do/admin', {
			method: 'POST',
			body: JSON.stringify(request),
		})

		const data = (await response.json()) as TokenStoreResponse

		logger
			.withTags({
				type: 'admin_refresh_token',
				character_id: characterId,
			})
			.info('Admin triggered token refresh', {
				characterId,
				success: data.success,
				request: getRequestLogData(c, Date.now()),
			})

		// Don't return the actual access token to admin
		if (data.success && data.data) {
			return c.json({
				success: true,
				data: {
					characterId: data.data.characterId,
					characterName: data.data.characterName,
					expiresAt: data.data.expiresAt,
					refreshed: true,
				},
			})
		}

		return c.json(data, response.status as 200 | 404 | 500)
	})
