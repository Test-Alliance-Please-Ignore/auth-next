import { WorkflowEntrypoint } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'

import { createDb } from '../db'
import { userCharacters } from '../db/schema'
import { checkUserBlacklisted, disableBlacklistedUser } from './steps/check-user-blacklisted'
import {
	handleCharacterDeleted,
	tryCharacterAuthenticatedFetch,
	updateCharacterPublicInfo,
} from './steps/update-character'
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
 *
 * IMPORTANT: Cloudflare Workflows hibernate between steps, discarding all in-memory state.
 * Services (db) must be recreated inside each step using createContext().
 * Database queries MUST be wrapped in step.do() to cache results across hibernation.
 */
export class UserRefreshWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
	/**
	 * Create workflow context inside each step.
	 * MUST be called inside step.do() callbacks since services don't survive hibernation.
	 */
	private createContext(userId: string, workflowInstanceId: string): WorkflowContext {
		return {
			env: this.env,
			workflowInstanceId,
			db: createDb(this.env.DATABASE_URL),
			userId,
		}
	}

	async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
		const { userId } = event.payload
		const workflowInstanceId = event.instanceId

		const logContext = { userId, workflowInstanceId }
		console.log('[Workflow] Starting user refresh workflow', logContext)

		// Step 1: Check if user is blacklisted
		const checkUserBlacklistedResult = await step.do('check-user-blacklisted', () => {
			const ctx = this.createContext(userId, workflowInstanceId)
			return checkUserBlacklisted(ctx)
		})

		console.log('[Workflow] Checked user blacklisted', {
			...logContext,
			isBlacklisted: checkUserBlacklistedResult.isBlacklisted,
		})

		// Step 2: Disable user if blacklisted
		if (checkUserBlacklistedResult.isBlacklisted) {
			await step.do('disable-blacklisted-user', () => {
				const ctx = this.createContext(userId, workflowInstanceId)
				return disableBlacklistedUser(ctx)
			})

			console.log('[Workflow] Disabled user', logContext)
		}

		// Step 3: Fetch user's characters
		// CRITICAL: Database query MUST be in a step to cache results across hibernation
		const characters = await step.do('fetch-user-characters', async () => {
			const db = createDb(this.env.DATABASE_URL)
			return db.query.userCharacters.findMany({
				where: eq(userCharacters.userId, userId),
			})
		})

		// Process characters sequentially
		for (const character of characters) {
			// Step: Update character public info
			const updateCharacterPublicInfoResult = await step.do(
				`update-character-public-info-${character.characterId}`,
				{
					retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
					timeout: '1 minute',
				},
				async () => {
					const ctx = this.createContext(userId, workflowInstanceId)
					return updateCharacterPublicInfo(ctx, character.characterId)
				}
			)

			if (updateCharacterPublicInfoResult.isDeleted) {
				console.log('[Workflow] Character is deleted', {
					characterId: character.characterId,
				})
				await step.do(`handle-character-deleted-${character.characterId}`, () => {
					const ctx = this.createContext(userId, workflowInstanceId)
					return handleCharacterDeleted(ctx, character.characterId)
				})
				console.log('[Workflow] Character marked as deleted', {
					characterId: character.characterId,
				})
			}

			// Step: Try authenticated fetch
			const authenticatedFetchResult = await step.do(
				`try-character-authenticated-fetch-${character.characterId}`,
				{
					retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
					timeout: '1 minute',
				},
				async () => {
					const ctx = this.createContext(userId, workflowInstanceId)
					return tryCharacterAuthenticatedFetch(ctx, character.characterId)
				}
			)

			// Log failures
			if (!authenticatedFetchResult.success) {
				console.error('[Workflow] Failed to fetch character authenticated data', {
					characterId: character.characterId,
					error: authenticatedFetchResult.error,
				})
			}
		}

		// Step 4: Get user role attachments
		const getUserRoleAttachmentsResult = await step.do('get-user-role-attachments', () => {
			const ctx = this.createContext(userId, workflowInstanceId)
			return getUserRoleAttachments(ctx)
		})

		console.log('[Workflow] Got user role attachments', {
			...logContext,
			roleAttachments: getUserRoleAttachmentsResult.roleAttachments.length,
		})

		// Step 5: Attach user roles
		const attachUserRolesResult = await step.do('attach-user-roles', () => {
			const ctx = this.createContext(userId, workflowInstanceId)
			return attachUserRoles(ctx)
		})

		console.log('[Workflow] Attached user roles', {
			...logContext,
			corporationRoleAttachments: attachUserRolesResult.corporationRoleAttachments.length,
			allianceRoleAttachments: attachUserRolesResult.allianceRoleAttachments.length,
		})

		// Step 6: Update completion timestamp
		await step.do('update-completion-timestamp', () => {
			const ctx = this.createContext(userId, workflowInstanceId)
			return updateCompletionTimestamp(ctx)
		})

		console.log('[Workflow] Updated completion timestamp', logContext)
	}
}
