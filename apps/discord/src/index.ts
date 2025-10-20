import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { getStub } from '@repo/do-utils'
import { withNotFound, withOnError } from '@repo/hono-helpers'

import { DiscordDO } from './durable-object'
import * as discordService from './services/discord.service'

import type { Discord } from '@repo/discord'
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
	 * Start Discord OAuth flow
	 * POST /discord/auth/start
	 * Body: { state?: string }
	 * Returns: { url: string, state: string }
	 */
	.post(
		'/discord/auth/start',
		zValidator(
			'json',
			z.object({
				state: z.string().optional(),
			})
		),
		async (c) => {
			const { state } = c.req.valid('json')
			const result = await discordService.startOAuthFlow(c.env, state)
			return c.json(result)
		}
	)

	/**
	 * Handle Discord OAuth callback
	 * POST /discord/auth/callback
	 * Body: { code: string, state?: string, coreUserId: string }
	 * Returns: { success: boolean, userId?: string, username?: string, discriminator?: string, error?: string }
	 */
	.post(
		'/discord/auth/callback',
		zValidator(
			'json',
			z.object({
				code: z.string(),
				state: z.string().optional(),
				coreUserId: z.string().uuid(),
			})
		),
		async (c) => {
			const { code, state, coreUserId } = c.req.valid('json')
			const result = await discordService.handleOAuthCallback(c.env, code, state, coreUserId)
			return c.json(result)
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
