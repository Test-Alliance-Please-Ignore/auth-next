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

const CHARACTER_REFRESH_CONCURRENCY = 5
const CHARACTER_STEP_OPTIONS = {
	retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' as const },
	timeout: '1 minute' as const,
} as const
const ROLE_STEP_OPTIONS = {
	retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' as const },
	timeout: '30 seconds' as const,
} as const

type CharacterRefreshStatus =
	| 'success'
	| 'deleted'
	| 'transient_failed_after_retries'
	| 'permanent_failed'

interface CharacterRefreshOutcome {
	characterId: string
	status: CharacterRefreshStatus
	authenticatedSuccess?: boolean
	error?: string
}

async function runWithConcurrencyLimit<T, R>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<R>
): Promise<R[]> {
	if (items.length === 0) {
		return []
	}

	const results = new Array<R>(items.length)
	let index = 0
	const workerCount = Math.max(1, Math.min(limit, items.length))

	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (true) {
				const currentIndex = index
				index++
				if (currentIndex >= items.length) {
					return
				}
				results[currentIndex] = await worker(items[currentIndex])
			}
		})
	)

	return results
}

function classifyCharacterRefreshError(error: unknown): CharacterRefreshStatus {
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
	if (
		message.includes('timeout') ||
		message.includes('timed out') ||
		message.includes('rate limit') ||
		message.includes('429') ||
		message.includes('420') ||
		message.includes('network') ||
		message.includes('temporar')
	) {
		return 'transient_failed_after_retries'
	}
	return 'permanent_failed'
}

/**
 * User Refresh Workflow
 * Orchestrates periodic refresh of user data
 */

/**
 * Workflow parameters
 */
export interface WorkflowParams {
	userId: string
	refreshMode?: 'scheduled' | 'manual'
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
	private createContext(
		userId: string,
		workflowInstanceId: string,
		refreshMode: WorkflowParams['refreshMode'] = 'scheduled'
	): WorkflowContext {
		return {
			env: this.env,
			workflowInstanceId,
			db: createDb(this.env.DATABASE_URL),
			userId,
			refreshMode,
		}
	}

	private async refreshCharacterWithIsolation(
		step: WorkflowStep,
		userId: string,
		workflowInstanceId: string,
		refreshMode: WorkflowParams['refreshMode'],
		characterId: string
	): Promise<CharacterRefreshOutcome> {
		try {
			const updateCharacterPublicInfoResult = await step.do(
				`update-character-public-info-${characterId}`,
				CHARACTER_STEP_OPTIONS,
				async () => {
					const ctx = this.createContext(userId, workflowInstanceId, refreshMode)
					return updateCharacterPublicInfo(ctx, characterId)
				}
			)

			if (updateCharacterPublicInfoResult.isDeleted) {
				await step.do(`handle-character-deleted-${characterId}`, CHARACTER_STEP_OPTIONS, () => {
					const ctx = this.createContext(userId, workflowInstanceId, refreshMode)
					return handleCharacterDeleted(ctx, characterId)
				})
				return {
					characterId,
					status: 'deleted',
				}
			}

			const authenticatedFetchResult = await step.do(
				`try-character-authenticated-fetch-${characterId}`,
				CHARACTER_STEP_OPTIONS,
				async () => {
					const ctx = this.createContext(userId, workflowInstanceId, refreshMode)
					return tryCharacterAuthenticatedFetch(ctx, characterId)
				}
			)

			if (!authenticatedFetchResult.success) {
				console.error('[Workflow] Failed character authenticated fetch', {
					userId,
					workflowInstanceId,
					characterId,
					error: authenticatedFetchResult.error,
				})
			}

			return {
				characterId,
				status: 'success',
				authenticatedSuccess: authenticatedFetchResult.success,
				error: authenticatedFetchResult.error,
			}
		} catch (error) {
			const status = classifyCharacterRefreshError(error)
			const errorMessage = error instanceof Error ? error.message : String(error)
			console.error('[Workflow] Character refresh failed after retries; continuing workflow', {
				userId,
				workflowInstanceId,
				characterId,
				status,
				error: errorMessage,
			})
			return {
				characterId,
				status,
				error: errorMessage,
			}
		}
	}

	async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
		const { userId, refreshMode = 'scheduled' } = event.payload
		const workflowInstanceId = event.instanceId

		const logContext = { userId, workflowInstanceId }
		console.log('[Workflow] Starting user refresh workflow', logContext)

		// Step 1: Check if user is blacklisted
		const checkUserBlacklistedResult = await step.do('check-user-blacklisted', () => {
			const ctx = this.createContext(userId, workflowInstanceId, refreshMode)
			return checkUserBlacklisted(ctx)
		})

		console.log('[Workflow] Checked user blacklisted', {
			...logContext,
			isBlacklisted: checkUserBlacklistedResult.isBlacklisted,
		})

		// Step 2: Disable user if blacklisted
		if (checkUserBlacklistedResult.isBlacklisted) {
			await step.do('disable-blacklisted-user', () => {
				const ctx = this.createContext(userId, workflowInstanceId, refreshMode)
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

		// Process characters in bounded parallel, isolating failures per character.
		const characterOutcomes = await runWithConcurrencyLimit(
			characters,
			CHARACTER_REFRESH_CONCURRENCY,
			(character) =>
				this.refreshCharacterWithIsolation(
					step,
					userId,
					workflowInstanceId,
					refreshMode,
					character.characterId
				)
		)

		const outcomeSummary = {
			success: 0,
			deleted: 0,
			transient_failed_after_retries: 0,
			permanent_failed: 0,
		}
		for (const outcome of characterOutcomes) {
			outcomeSummary[outcome.status]++
		}
		console.log('[Workflow] Character refresh outcomes', {
			...logContext,
			totalCharacters: characters.length,
			...outcomeSummary,
		})

		// Step 4: Get user role attachments
		let getUserRoleAttachmentsResult = {
			roleAttachments: [] as Awaited<ReturnType<typeof getUserRoleAttachments>>['roleAttachments'],
		}
		try {
			getUserRoleAttachmentsResult = await step.do(
				'get-user-role-attachments',
				ROLE_STEP_OPTIONS,
				() => {
					const ctx = this.createContext(userId, workflowInstanceId, refreshMode)
					return getUserRoleAttachments(ctx)
				}
			)
		} catch (error) {
			console.warn(
				'[Workflow] Failed to fetch user role attachments before reconcile; continuing',
				{
					...logContext,
					error: error instanceof Error ? error.message : String(error),
				}
			)
		}

		console.log('[Workflow] Got user role attachments', {
			...logContext,
			roleAttachments: getUserRoleAttachmentsResult.roleAttachments.length,
		})

		// Step 5: Attach user roles
		const attachUserRolesResult = await step.do('attach-user-roles', ROLE_STEP_OPTIONS, () => {
			const ctx = this.createContext(userId, workflowInstanceId, refreshMode)
			return attachUserRoles(ctx)
		})

		console.log('[Workflow] Attached user roles', {
			...logContext,
			corporationRoleAttachments: attachUserRolesResult.corporationRoleAttachments.length,
			allianceRoleAttachments: attachUserRolesResult.allianceRoleAttachments.length,
		})

		// Step 6: Update completion timestamp
		await step.do('update-completion-timestamp', () => {
			const ctx = this.createContext(userId, workflowInstanceId, refreshMode)
			return updateCompletionTimestamp(ctx)
		})

		console.log('[Workflow] Updated completion timestamp', logContext)
	}
}
