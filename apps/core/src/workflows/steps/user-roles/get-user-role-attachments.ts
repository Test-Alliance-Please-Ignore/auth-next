import { getStub } from '@repo/do-utils'
import { RoleAttachmentType } from '@repo/groups'

import { getWorkflowLogger } from '../../context'

import type { Groups, RoleAttachment } from '@repo/groups'
import type { WorkflowContext } from '../../context'

/**
 * User roles
 */
export interface GetUserRoleAttachmentsResult {
	roleAttachments: RoleAttachment[]
}

/**
 * Attach user roles to the user
 * @param ctx - Workflow context
 * @param userId - User ID
 * @param workflowInstanceId - Workflow instance ID
 * @returns void
 */
export async function getUserRoleAttachments(
	ctx: WorkflowContext,
	userId: string
): Promise<GetUserRoleAttachmentsResult> {
	const logger = getWorkflowLogger(ctx, 'get-user-role-attachments')

	const groupsStub = getStub<Groups>(ctx.env.GROUPS, 'default')

	const userRoles = await groupsStub.getRolesFor({
		attachedToType: RoleAttachmentType.USER,
		attachedToId: userId,
	})

	logger.info('[Workflow] Attached user roles', {
		userId,
		userRoles: userRoles.length,
	})

	return {
		roleAttachments: userRoles,
	}
}
