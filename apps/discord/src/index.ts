import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'
import { z } from 'zod'

import { withNotFound, withOnError } from '@repo/hono-helpers'

import { DiscordDO } from './durable-object'
import * as discordService from './services/discord.service'

import type { App } from './context'

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
		return c.text('Discord Durable Object Worker')
	})

	/**
	 * Store Discord tokens (PKCE flow)
	 * POST /discord/auth/store-tokens
	 * Body: { userId, username, discriminator, scopes, accessToken, refreshToken, expiresAt, coreUserId }
	 * Returns: { success: boolean }
	 */
	.post(
		'/discord/auth/store-tokens',
		zValidator(
			'json',
			z.object({
				userId: z.string(),
				username: z.string(),
				discriminator: z.string(),
				scopes: z.array(z.string()),
				accessToken: z.string(),
				refreshToken: z.string(),
				expiresAt: z.string(),
				coreUserId: z.string().uuid(),
			})
		),
		async (c) => {
			const {
				userId,
				username,
				discriminator,
				scopes,
				accessToken,
				refreshToken,
				expiresAt,
				coreUserId,
			} = c.req.valid('json')
			const result = await discordService.storeTokens(
				c.env,
				userId,
				username,
				discriminator,
				scopes,
				accessToken,
				refreshToken,
				new Date(expiresAt),
				coreUserId
			)
			return c.json({ success: result })
		}
	)

	/**
	 * Get Discord profile by core user ID
	 * GET /discord/profile/:coreUserId
	 * Returns: { userId: string, username: string, discriminator: string, scopes: string[] } | null
	 */
	.get('/discord/profile/:coreUserId', async (c) => {
		const coreUserId = c.req.param('coreUserId')
		const profile = await discordService.getProfile(c.env, coreUserId)

		if (!profile) {
			return c.json({ error: 'Discord profile not found' }, 404)
		}

		return c.json(profile)
	})

	/**
	 * Refresh Discord OAuth token
	 * POST /discord/refresh/:coreUserId
	 * Returns: { success: boolean }
	 */
	.post('/discord/refresh/:coreUserId', async (c) => {
		const coreUserId = c.req.param('coreUserId')
		const success = await discordService.refreshToken(c.env, coreUserId)

		return c.json({ success })
	})

export default app

// Export the Durable Object class
export { DiscordDO as Discord }
