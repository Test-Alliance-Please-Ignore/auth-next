import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { withNotFound, withOnError } from '@repo/hono-helpers'

import { HrDO } from './durable-object'
import { createDb } from './db'
import { HrRoleService } from './services/hr-role.service'

import type { App, Env } from './context'

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
			service: 'hr',
			status: 'ok',
			message: 'HR Durable Object Worker - Access via RPC from core worker',
		})
	})

/**
 * Queue consumer for hr-member-departed messages
 * Deactivates HR roles when members leave a corporation
 */
async function handleMemberDepartedQueue(
	batch: MessageBatch<{ corporationId: string; characterId: string }>,
	env: Env,
	_ctx: ExecutionContext
): Promise<void> {
	const db = createDb(env.DATABASE_URL)
	const hrRoleService = new HrRoleService(db)

	for (const message of batch.messages) {
		try {
			const { corporationId, characterId } = message.body

			const deactivatedCount = await hrRoleService.deactivateRolesForDepartedMember(
				corporationId,
				characterId
			)

			if (deactivatedCount > 0) {
				console.log('[hr-member-departed] Deactivated HR roles:', {
					corporationId,
					characterId,
					count: deactivatedCount,
				})
			}

			message.ack()
		} catch (error) {
			console.error('[hr-member-departed] Failed to process message:', {
				error,
				errorMessage: error instanceof Error ? error.message : String(error),
				messageId: message.id,
			})
			message.retry()
		}
	}
}

// Export default worker with fetch and queue handlers
export default {
	fetch: app.fetch.bind(app),
	async queue(
		batch: MessageBatch<{ corporationId: string; characterId: string }>,
		env: Env,
		ctx: ExecutionContext
	): Promise<void> {
		if (batch.queue === 'hr-member-departed') {
			await handleMemberDepartedQueue(batch, env, ctx)
		} else {
			console.error(`No handler found for queue: ${batch.queue}`)
		}
	},
}

// Export the Durable Object class
export { HrDO as Hr }
