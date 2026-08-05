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
 * Get user role attachments
 * @param ctx - Workflow context
 * @returns User role attachments
 */
export async function getUserRoleAttachments(
	ctx: WorkflowContext
): Promise<GetUserRoleAttachmentsResult> {
	const logger = getWorkflowLogger(ctx, 'get-user-role-attachments')

	const groupsStub = getStub<Groups>(ctx.env.GROUPS, 'default')

	const userRoles = await groupsStub.getRolesFor({
		attachedToType: RoleAttachmentType.USER,
		attachedToId: ctx.userId,
	})

	logger.info('[Workflow] Attached user roles', {
		userId: ctx.userId,
		userRoles: userRoles.length,
	})

	return {
		roleAttachments: userRoles,
	}
}
