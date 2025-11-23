import { getStub } from '@repo/do-utils'

import { getWorkflowLogger } from '../../context'

import type { WorkflowContext } from '../../context'

export interface DisableBlacklistedUserResult {
	success: boolean
}

export async function disableBlacklistedUser(
	ctx: WorkflowContext
): Promise<DisableBlacklistedUserResult> {
	const logger = getWorkflowLogger(ctx, 'disable-blacklisted-user')

	return {
		success: true,
	}
}
