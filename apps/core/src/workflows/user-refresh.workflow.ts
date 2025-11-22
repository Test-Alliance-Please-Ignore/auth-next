import { WorkflowEntrypoint } from 'cloudflare:workers'

import { createDb } from '../db'
import { getWorkflowLogger } from './context'
import { checkUserBlacklisted } from './steps/check-user-blacklisted'
import { updateCompletionTimestamp } from './steps/update-completion-timestamp'
import { attachUserRoles, getUserRoleAttachments } from './steps/user-roles'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { Env } from '../context'
import type { WorkflowContext } from './context'

/**
 * User Refresh Workflow
 * Orchestrates periodic refresh of user data
 */

/**
 * Workflow parameters
 */
export interface WorkflowParams {
	userId: string
}

/**
 * User Refresh Workflow
 * Updates the database with workflow completion timestamp
 */
export class UserRefreshWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
	async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
		const { userId } = event.payload
		const workflowInstanceId = event.instanceId

		const workflowContext: WorkflowContext = {
			env: this.env,
			workflowInstanceId,
			db: createDb(this.env.DATABASE_URL),
		}

		const logger = getWorkflowLogger(workflowContext)

		// Step 1: Update completion timestamp
		const checkUserBlacklistedResult = await step.do('check-user-blacklisted', () =>
			checkUserBlacklisted(workflowContext, userId, workflowInstanceId)
		)

		logger.info('[Workflow] Checked user blacklisted', {
			userId,
			workflowInstanceId,
			isBlacklisted: checkUserBlacklistedResult.isBlacklisted,
		})

		// Step 2: Get user role attachments
		const getUserRoleAttachmentsResult = await step.do('get-user-role-attachments', () =>
			getUserRoleAttachments(workflowContext, userId)
		)

		logger.info('[Workflow] Got user role attachments', {
			userId,
			workflowInstanceId,
			roleAttachments: getUserRoleAttachmentsResult.roleAttachments.length,
		})

		// Step 3: Attach user roles
		const attachUserRolesResult = await step.do('attach-user-roles', () =>
			attachUserRoles(workflowContext, userId)
		)

		logger.info('[Workflow] Attached user roles', {
			userId,
			workflowInstanceId,
			corporationRoleAttachments: attachUserRolesResult.corporationRoleAttachments.length,
			allianceRoleAttachments: attachUserRolesResult.allianceRoleAttachments.length,
		})

		// Step 2: Update completion timestamp
		await step.do('update-completion-timestamp', () =>
			updateCompletionTimestamp(this.env.DATABASE_URL, userId, workflowInstanceId)
		)
	}
}
