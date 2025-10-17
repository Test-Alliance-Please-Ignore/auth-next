import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { getRequestLogData, logger } from '@repo/hono-helpers'
import { withStaticAuth } from '@repo/static-auth'

import type { UserTokenStore } from '@repo/user-token-store'
import type { App } from './context'

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

		try {
			// Use a global DO instance for listing all tokens
			const stub = getStub<UserTokenStore>(c.env.USER_TOKEN_STORE, 'global')

			const result = await stub.listAllTokens(limit, offset)

			logger
				.withTags({
					type: 'admin_list_tokens',
				})
				.info('Admin listed tokens', {
					limit,
					offset,
					total: result.total,
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({ success: true, data: result })
		} catch (error) {
			logger.error('Admin list tokens error', { error: String(error) })
			return c.json({ success: false, error: String(error) }, 500)
		}
	})

	// Get specific character token info with proxy token
	.get('/tokens/:characterId', async (c) => {
		const characterId = parseInt(c.req.param('characterId'), 10)

		if (isNaN(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}

		try {
			const stub = getStub<UserTokenStore>(c.env.USER_TOKEN_STORE, 'global')

			const tokenInfo = await stub.getProxyToken(characterId)

			logger
				.withTags({
					type: 'admin_get_token',
					character_id: characterId,
				})
				.info('Admin retrieved character token', {
					characterId,
					success: true,
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({ success: true, data: tokenInfo })
		} catch (error) {
			const status = error instanceof Error && error.message === 'Token not found' ? 404 : 500
			logger.error('Admin get token error', { error: String(error), characterId })
			return c.json({ success: false, error: String(error) }, status)
		}
	})

	// Delete token by character ID
	.delete('/tokens/:characterId', async (c) => {
		const characterId = parseInt(c.req.param('characterId'), 10)

		if (isNaN(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}

		try {
			const stub = getStub<UserTokenStore>(c.env.USER_TOKEN_STORE, 'global')

			await stub.revokeToken(characterId)

			logger
				.withTags({
					type: 'admin_delete_token',
					character_id: characterId,
				})
				.info('Admin deleted character token', {
					characterId,
					success: true,
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({ success: true })
		} catch (error) {
			logger.error('Admin delete token error', { error: String(error), characterId })
			return c.json({ success: false, error: String(error) }, 500)
		}
	})

	// Delete token by proxy token
	.delete('/tokens/proxy/:proxyToken', async (c) => {
		const proxyToken = c.req.param('proxyToken')

		if (!proxyToken || proxyToken.length !== 64) {
			return c.json({ error: 'Invalid proxy token format' }, 400)
		}

		try {
			// Use the global DO instance
			const stub = getStub<UserTokenStore>(c.env.USER_TOKEN_STORE, 'global')

			await stub.deleteByProxyToken(proxyToken)

			logger
				.withTags({
					type: 'admin_delete_token_by_proxy',
				})
				.info('Admin deleted token by proxy token', {
					proxyToken: proxyToken.substring(0, 8),
					success: true,
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({ success: true })
		} catch (error) {
			const status = error instanceof Error && error.message === 'Token not found' ? 404 : 500
			logger.error('Admin delete token by proxy error', { error: String(error) })
			return c.json({ success: false, error: String(error) }, status)
		}
	})

	// Get statistics
	.get('/stats', async (c) => {
		try {
			// Use the global DO instance for stats
			const stub = getStub<UserTokenStore>(c.env.USER_TOKEN_STORE, 'global')

			const stats = await stub.getStats()

			logger
				.withTags({
					type: 'admin_get_stats',
				})
				.info('Admin retrieved statistics', {
					stats,
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({ success: true, data: { stats } })
		} catch (error) {
			logger.error('Admin get stats error', { error: String(error) })
			return c.json({ success: false, error: String(error) }, 500)
		}
	})

	// Manually trigger token refresh
	.post('/tokens/:characterId/refresh', async (c) => {
		const characterId = parseInt(c.req.param('characterId'), 10)

		if (isNaN(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}

		try {
			const stub = getStub<UserTokenStore>(c.env.USER_TOKEN_STORE, 'global')

			// Get the access token, which will trigger a refresh if needed
			const tokenInfo = await stub.getAccessToken(characterId)

			logger
				.withTags({
					type: 'admin_refresh_token',
					character_id: characterId,
				})
				.info('Admin triggered token refresh', {
					characterId,
					success: true,
					request: getRequestLogData(c, Date.now()),
				})

			// Don't return the actual access token to admin
			return c.json({
				success: true,
				data: {
					characterId: tokenInfo.characterId,
					characterName: tokenInfo.characterName,
					expiresAt: tokenInfo.expiresAt,
					refreshed: true,
				},
			})
		} catch (error) {
			const status = error instanceof Error && error.message === 'Token not found' ? 404 : 500
			logger.error('Admin refresh token error', { error: String(error), characterId })
			return c.json({ success: false, error: String(error) }, status)
		}
	})
