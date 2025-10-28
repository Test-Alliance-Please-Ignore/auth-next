import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { withNotFound, withOnError } from '@repo/hono-helpers'

import type { App } from './context'
import { UserDiscordRefreshWorkflow } from './workflows/user-discord-refresh'

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
		return c.json({
			status: 'ok',
			service: 'orchestrator',
			timestamp: new Date().toISOString(),
		})
	})

	.get('/health', async (c) => {
		return c.json({
			status: 'ok',
			service: 'orchestrator',
			timestamp: new Date().toISOString(),
		})
	})

	.post('/trigger/discord-refresh/:userId', async (c) => {
		const userId = c.req.param('userId')

		if (!userId) {
			return c.json({ error: 'Missing userId parameter' }, 400)
		}

		try {
			// Fetch user from CORE to get discordUserId
			const users = await c.env.CORE.getUsersForDiscordRefresh(1000, 30)
			const user = users.find((u) => u.userId === userId)

			if (!user) {
				return c.json(
					{
						error: 'User not found or does not have Discord linked',
						userId,
					},
					404
				)
			}

			// Create workflow instance without jitter for immediate testing
			const workflowId = `user-discord-refresh-${userId}-manual-${Date.now()}`
			const instance = await c.env.USER_DISCORD_REFRESH.create({
				id: workflowId,
				params: {
					userId: user.userId,
					discordUserId: user.discordUserId,
					jitterDelaySeconds: 0, // No jitter for manual trigger
				},
			})

			return c.json({
				success: true,
				userId,
				discordUserId: user.discordUserId,
				workflowId: instance.id,
				message: 'Workflow instance created',
			})
		} catch (error) {
			return c.json(
				{
					error: 'Failed to create workflow',
					message: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

	.post('/trigger/discord-refresh-batch', async (c) => {
		try {
			// Manually trigger the batch process (same as scheduled handler)
			const users = await c.env.CORE.getUsersForDiscordRefresh(50, 30)

			if (users.length === 0) {
				return c.json({
					success: true,
					message: 'No users need refresh at this time',
					userCount: 0,
				})
			}

			const workflowPromises = users.map(async (user) => {
				// Use small jitter for manual batch (0-5 minutes)
				const jitterSeconds = Math.floor(Math.random() * 300)

				const workflowId = `user-discord-refresh-${user.userId}-batch-${Date.now()}`
				const instance = await c.env.USER_DISCORD_REFRESH.create({
					id: workflowId,
					params: {
						userId: user.userId,
						discordUserId: user.discordUserId,
						jitterDelaySeconds: jitterSeconds,
					},
				})

				return {
					userId: user.userId,
					workflowId: instance.id,
					jitterMinutes: Math.floor(jitterSeconds / 60),
				}
			})

			const results = await Promise.all(workflowPromises)

			return c.json({
				success: true,
				message: 'Batch workflow instances created',
				userCount: results.length,
				workflows: results,
			})
		} catch (error) {
			return c.json(
				{
					error: 'Failed to create batch workflows',
					message: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

export default app

// Export the Workflow class
export { UserDiscordRefreshWorkflow }

// Export the scheduled handler
export { default as scheduled } from './scheduled'
