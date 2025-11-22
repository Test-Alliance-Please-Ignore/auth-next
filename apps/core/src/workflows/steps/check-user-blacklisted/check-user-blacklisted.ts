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
	ctx: WorkflowContext,
	userId: string,
	workflowInstanceId: string
): Promise<CheckUserBlacklistedResult> {
	const logger = getWorkflowLogger(ctx)

	const hrStub = getStub<Hr>(ctx.env.HR, 'default')
	const isBlacklisted = await hrStub.isUserBlacklisted(userId)

	logger.info('[Workflow] Checked user blacklisted', {
		userId,
		workflowInstanceId,
		isBlacklisted,
	})

	return {
		isBlacklisted,
	}
}
