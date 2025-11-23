/**
 * Update database with workflow completion timestamp
 */

import { getStub } from '@repo/do-utils'

import { getWorkflowLogger } from '../../context'

import type { Hr } from '@repo/hr'
import type { WorkflowContext } from '../../context'

export interface CheckUserBlacklistedResult {
	isBlacklisted: boolean
}

/**
 * Update database to mark workflow as completed
 *
 * @param databaseUrl - Database connection URL
 * @param userId - User UUID
 */
export async function checkUserBlacklisted(
	ctx: WorkflowContext
): Promise<CheckUserBlacklistedResult> {
	const logger = getWorkflowLogger(ctx, 'check-user-blacklisted')

	const hrStub = getStub<Hr>(ctx.env.HR, 'default')
	const isBlacklisted = await hrStub.isUserBlacklisted(ctx.userId)

	logger.info('[Workflow] Checked user blacklisted', {
		userId: ctx.userId,
		workflowInstanceId: ctx.workflowInstanceId,
		isBlacklisted,
	})

	return {
		isBlacklisted,
	}
}
