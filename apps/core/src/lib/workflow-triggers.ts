import { eq } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'

import { users } from '../db/schema'

import type { Env } from '../context'
import type { createDb } from '../db'

const THROTTLE_MS = 5 * 60 * 1000 // 5 minutes

export interface TriggerUserRefreshOptions {
	db: ReturnType<typeof createDb>
	env: Env
	userId: string
	source: string
}

/**
 * Trigger user refresh workflow with throttling.
 * Returns immediately - does not block on workflow creation.
 * Logs errors but does not throw.
 */
export async function triggerUserRefreshWorkflow({
	db,
	env,
	userId,
	source,
}: TriggerUserRefreshOptions): Promise<void> {
	try {
		const userRecord = await db.query.users.findFirst({
			where: eq(users.id, userId),
			columns: { lastRefreshWorkflowAttempt: true },
		})

		const shouldTrigger =
			!userRecord?.lastRefreshWorkflowAttempt ||
			Date.now() - userRecord.lastRefreshWorkflowAttempt.getTime() > THROTTLE_MS

		if (!shouldTrigger) return

		await db
			.update(users)
			.set({ lastRefreshWorkflowAttempt: new Date() })
			.where(eq(users.id, userId))

		await env.USER_REFRESH_WORKFLOW.create({
			id: `user-refresh-${source}-${userId}-${Date.now()}`,
			params: { userId },
		})

		logger.info('[WorkflowTrigger] Triggered user refresh workflow', { userId, source })
	} catch (error) {
		logger.error('[WorkflowTrigger] Failed to trigger user refresh workflow', {
			userId,
			source,
			error: error instanceof Error ? error.message : String(error),
		})
	}
}
