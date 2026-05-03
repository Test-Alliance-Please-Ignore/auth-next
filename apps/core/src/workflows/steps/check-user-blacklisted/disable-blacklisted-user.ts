import { enforceBlacklistedDiscordAccess } from '../../../services/discord.service'

import { getWorkflowLogger } from '../../context'

import type { WorkflowContext } from '../../context'

export interface DisableBlacklistedUserResult {
	success: boolean
	totalUpdated: number
	totalFailed: number
}

export async function disableBlacklistedUser(
	ctx: WorkflowContext
): Promise<DisableBlacklistedUserResult> {
	const logger = getWorkflowLogger(ctx, 'disable-blacklisted-user')
	const enforcement = await enforceBlacklistedDiscordAccess(
		ctx.env,
		ctx.userId,
		'User is blacklisted (user-refresh workflow enforcement)'
	)

	logger.info('[Workflow] Enforced blacklisted Discord access', {
		userId: ctx.userId,
		workflowInstanceId: ctx.workflowInstanceId,
		totalUpdated: enforcement.totalUpdated,
		totalFailed: enforcement.totalFailed,
		resultCount: enforcement.results.length,
	})

	return {
		success: true,
		totalUpdated: enforcement.totalUpdated,
		totalFailed: enforcement.totalFailed,
	}
}
