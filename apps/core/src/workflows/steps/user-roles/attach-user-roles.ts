import {
	reconcileUserCoreMembershipRoles,
	splitCoreRoleAttachments,
} from '../../../services/core-role-reconciliation.service'
import { getWorkflowLogger } from '../../context'

import type { RoleAttachment } from '@repo/groups'
import type { WorkflowContext } from '../../context'

/**
 * User roles
 */
export interface AttachUserRolesResult {
	corporationRoleAttachments: RoleAttachment[]
	allianceRoleAttachments: RoleAttachment[]
}

/**
 * Attach user roles to the user
 *
 * Source of truth breakdown:
 * - `user_characters` in core is the refresh-time source of truth for corporation and
 *   alliance membership role derivation.
 * - The refresh workflow is responsible for hydrating those fields from ESI before this
 *   step runs.
 * - Groups role attachments are the persisted authorization surface consumed by session
 *   auth and route guards.
 * - Live ESI affiliation lookup is intentionally not used here, to avoid divergence
 *   between refresh-persisted character state and attached roles.
 *
 * @param ctx - Workflow context
 * @returns User role attachments
 */
export async function attachUserRoles(ctx: WorkflowContext): Promise<AttachUserRolesResult> {
	const logger = getWorkflowLogger(ctx, 'attach-user-roles')

	const reconcileResult = await reconcileUserCoreMembershipRoles(ctx.env, ctx.userId)
	logger.info('[Workflow] Reconciled user core membership roles', {
		userId: ctx.userId,
		desiredCount: reconcileResult.desiredCount,
		attachedCount: reconcileResult.attachedCount,
		detachedCount: reconcileResult.detachedCount,
		finalCount: reconcileResult.roleAttachments.length,
	})

	return splitCoreRoleAttachments(reconcileResult.roleAttachments)
}
