/**
 * Update database with workflow completion timestamp
 */

import { eq } from 'drizzle-orm'

import { users } from '../../../db/schema'
import { getWorkflowLogger } from '../../context'

import type { WorkflowContext } from '../../context'

/**
 * Update database to mark workflow as completed
 *
 * @param ctx - Workflow context
 */
export async function updateCompletionTimestamp(ctx: WorkflowContext): Promise<void> {
	const logger = getWorkflowLogger(ctx, 'update-completion-timestamp')

	await ctx.db
		.update(users)
		.set({ lastRefreshWorkflow: new Date() })
		.where(eq(users.id, ctx.userId))

	logger.info('[Workflow] Updated user refresh workflow completion timestamp', {
		userId: ctx.userId,
		workflowInstanceId: ctx.workflowInstanceId,
	})
}
