/**
 * Update database with workflow completion timestamp
 */

import { eq } from 'drizzle-orm'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../../../db'
import { users } from '../../../db/schema'

/**
 * Update database to mark workflow as completed
 *
 * @param databaseUrl - Database connection URL
 * @param userId - User UUID
 * @param workflowInstanceId - Workflow instance ID (for logging)
 */
export async function updateCompletionTimestamp(
	databaseUrl: string,
	userId: string,
	workflowInstanceId: string,
): Promise<void> {
	const db = createDb(databaseUrl)

	await db
		.update(users)
		.set({ lastRefreshWorkflow: new Date() })
		.where(eq(users.id, userId))

	logger.info('[Workflow] Updated user refresh workflow completion timestamp', {
		userId,
		workflowInstanceId,
	})
}

