import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
import { withNotFound, withOnError } from '@repo/hono-helpers'

// Export the scheduled handler
import { scheduled } from './scheduled'
import { UserDiscordRefreshWorkflow } from './workflows/user-discord-refresh'

import type { Core } from '@repo/core'
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
			// Fetch user from Discord DO to get discordUserId
			const discordStub = getStub<Discord>(c.env.DISCORD, 'default')
			const users = await discordStub.getUsersNeedingRefresh(1000, 15)
			const discordUser = users.find((u) => u.coreUserId === userId)

			if (!discordUser) {
				return c.json(
					{
						error: 'User not found or does not have Discord linked',
						userId,
					},
					404
				)
			}

			// Create workflow without jitter for immediate testing
			const workflowId = `user-discord-refresh-${userId}-manual-${Date.now()}`
			const instance = await c.env.USER_DISCORD_REFRESH.create({
				id: workflowId,
				params: {
					userId,
					discordUserId: discordUser.discordUserId,
					jitterDelaySeconds: 0, // No jitter for manual trigger
				},
			})

			return c.json({
				success: true,
				userId,
				discordUserId: discordUser.discordUserId,
				workflowId: instance.id,
				message: 'Workflow created',
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
			// Query Discord database directly via RPC (15-minute minimum interval)
			const discordStub = getStub<Discord>(c.env.DISCORD, 'default')
			const discordUsers = await discordStub.getUsersNeedingRefresh(50, 15)

			if (discordUsers.length === 0) {
				return c.json({
					success: true,
					message: 'No users need refresh at this time',
					userCount: 0,
				})
			}

			const workflowPromises = discordUsers.map(async (discordUser) => {
				// Use small jitter for manual batch (0-5 minutes)
				const jitterSeconds = Math.floor(Math.random() * 300)

				const workflowId = `user-discord-refresh-${discordUser.coreUserId}-batch-${Date.now()}`
				const instance = await c.env.USER_DISCORD_REFRESH.create({
					id: workflowId,
					params: {
						userId: discordUser.coreUserId,
						discordUserId: discordUser.discordUserId,
						jitterDelaySeconds: jitterSeconds,
					},
				})

				return {
					userId: discordUser.coreUserId,
					workflowId: instance.id,
					jitterMinutes: Math.floor(jitterSeconds / 60),
				}
			})

			const results = await Promise.all(workflowPromises)

			return c.json({
				success: true,
				message: 'Batch workflows created',
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

	.get('/test/orchestrator/user-refresh', async (c) => {
		const batchSizeParam = c.req.query('batchSize')
		const parsedBatchSize = batchSizeParam ? Number.parseInt(batchSizeParam, 10) : 10

		if (Number.isNaN(parsedBatchSize) || parsedBatchSize <= 0) {
			return c.json({ error: 'batchSize must be a positive integer' }, 400)
		}

		const limit = Math.min(parsedBatchSize, 100)

		try {
			const stub = getStub<Core>(c.env.CORE_DURABLE_OBJECT, 'default')
			const userIds = await stub.listUsersNeedingRefresh(limit)

			if (userIds.length === 0) {
				return c.json({
					success: true,
					message: 'No users need refresh',
					userCount: 0,
					workflows: [],
				})
			}

			const now = Date.now()
			const batchPayload = userIds.map((userId, index) => ({
				id: `user-refresh-${userId}-${now}-${index}`,
				params: {
					userId,
					refreshMode: 'manual' as const,
				},
			}))

			const instances = await c.env.USER_REFRESH_WORKFLOW.createBatch(batchPayload)

			return c.json({
				success: true,
				message: 'User refresh workflows created',
				userCount: userIds.length,
				workflows: instances.map((instance, index) => ({
					workflowId: instance.id,
					userId: userIds[index],
				})),
			})
		} catch (error) {
			return c.json(
				{
					error: 'Failed to trigger user refresh workflows',
					message: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

// Export the Workflow class
export { UserDiscordRefreshWorkflow }

export default {
	fetch: app.fetch,
	scheduled: scheduled,
}
