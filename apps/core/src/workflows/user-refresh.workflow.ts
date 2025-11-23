import { WorkflowEntrypoint } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'

import { createDb } from '../db'
import { userCharacters } from '../db/schema'
import { getWorkflowLogger } from './context'
import { checkUserBlacklisted, disableBlacklistedUser } from './steps/check-user-blacklisted'
import { updateCharacterPublicInfo } from './steps/update-character'
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
			userId,
		}

		const logger = getWorkflowLogger(workflowContext)

		// Step 1: Check if user is blacklisted
		const checkUserBlacklistedResult = await step.do('check-user-blacklisted', () =>
			checkUserBlacklisted(workflowContext)
		)

		logger.info('[Workflow] Checked user blacklisted', {
			userId,
			workflowInstanceId,
			isBlacklisted: checkUserBlacklistedResult.isBlacklisted,
		})

		// Step 2: Disable user if blacklisted
		if (checkUserBlacklistedResult.isBlacklisted) {
			await step.do('disable-blacklisted-user', () => disableBlacklistedUser(workflowContext))

			logger.info('[Workflow] Disabled user', {
				userId,
				workflowInstanceId,
			})
		}

		const characters = await workflowContext.db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, userId),
		})

		await Promise.all(
			characters.map(async (character) => {
				await step.do(
					`update-character-public-info-${character.characterId}`,
					{
						retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
						timeout: '1 minute',
					},
					async () => updateCharacterPublicInfo(workflowContext, character.characterId)
				)
			})
		)

		// Step 3: Get user role attachments
		const getUserRoleAttachmentsResult = await step.do('get-user-role-attachments', () =>
			getUserRoleAttachments(workflowContext)
		)

		logger.info('[Workflow] Got user role attachments', {
			userId,
			workflowInstanceId,
			roleAttachments: getUserRoleAttachmentsResult.roleAttachments.length,
		})

		// Step 3: Attach user roles
		const attachUserRolesResult = await step.do('attach-user-roles', () =>
			attachUserRoles(workflowContext)
		)

		logger.info('[Workflow] Attached user roles', {
			userId,
			workflowInstanceId,
			corporationRoleAttachments: attachUserRolesResult.corporationRoleAttachments.length,
			allianceRoleAttachments: attachUserRolesResult.allianceRoleAttachments.length,
		})

		// Step 4: Update completion timestamp
		await step.do('update-completion-timestamp', () => updateCompletionTimestamp(workflowContext))

		logger.info('[Workflow] Updated completion timestamp', {
			userId,
			workflowInstanceId,
		})
	}
}
