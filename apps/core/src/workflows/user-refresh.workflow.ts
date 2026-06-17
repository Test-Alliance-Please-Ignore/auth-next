import { WorkflowEntrypoint } from 'cloudflare:workers'
import { and, eq } from 'drizzle-orm'

import { ROLE_CORE_ALLIANCE_MEMBER, ROLE_CORE_CORP_MEMBER } from '@repo/core'
import { getStub } from '@repo/do-utils'
import { esiRetryOptions } from '@repo/workflow-utils'

import { createDb } from '../db'
import { userCharacters } from '../db/schema'
import { checkUserBlacklisted, disableBlacklistedUser } from './steps/check-user-blacklisted'
import {
	reconcileCharacterCorporationMembership,
	tryCharacterAuthenticatedFetch,
	updateCharacterPublicInfo,
} from './steps/update-character'
import { updateCompletionTimestamp } from './steps/update-completion-timestamp'
import {
	attachUserRoles,
	getUserRoleAttachments,
	reconcileAffiliationBasedGroupMemberships,
} from './steps/user-roles'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { Core } from '@repo/core'
import type { Env } from '../context'
import type { WorkflowContext } from './context'

const CHARACTER_REFRESH_CONCURRENCY = 5
const CHARACTER_STEP_OPTIONS = { ...esiRetryOptions, timeout: '1 minute' as const }
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
	affiliationChanged?: boolean
	authenticatedSuccess?: boolean
	tokenInvalidated?: boolean
	error?: string
}

type WorkflowStepStatus = 'ok' | 'failed' | 'skipped'

export interface UserRefreshWorkflowResult {
	status: 'completed' | 'completed_with_errors' | 'failed'
	userId: string
	workflowInstanceId: string
	refreshMode: 'scheduled' | 'event' | 'manual'
	steps: Record<string, WorkflowStepStatus>
	characterOutcomes: CharacterRefreshOutcome[]
	summary: {
		characterCount: number
		success: number
		deleted: number
		affiliationChanged: number
		transientFailedAfterRetries: number
		permanentFailed: number
	}
	error?: {
		message: string
		stack?: string
	}
}

type CoreAttachmentSummary = {
	key: string
	roleName: string
	resourceType: string | undefined
	resourceId: string | undefined
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

function toCoreAttachmentSummaries(
	attachments: Awaited<ReturnType<typeof getUserRoleAttachments>>['roleAttachments']
): CoreAttachmentSummary[] {
	return attachments
		.filter(
			(attachment) =>
				attachment.role.name === ROLE_CORE_CORP_MEMBER ||
				attachment.role.name === ROLE_CORE_ALLIANCE_MEMBER
		)
		.map((attachment) => ({
			key: `${attachment.role.name}|${attachment.resourceType || ''}|${attachment.resourceId || ''}`,
			roleName: attachment.role.name,
			resourceType: attachment.resourceType,
			resourceId: attachment.resourceId,
		}))
}

function summarizeCoreAttachmentDelta(
	before: Awaited<ReturnType<typeof getUserRoleAttachments>>['roleAttachments'],
	after: Awaited<ReturnType<typeof getUserRoleAttachments>>['roleAttachments']
) {
	const beforeCore = toCoreAttachmentSummaries(before)
	const afterCore = toCoreAttachmentSummaries(after)

	const beforeKeys = new Set(beforeCore.map((entry) => entry.key))
	const afterKeys = new Set(afterCore.map((entry) => entry.key))

	const added = afterCore.filter((entry) => !beforeKeys.has(entry.key))
	const removed = beforeCore.filter((entry) => !afterKeys.has(entry.key))

	return {
		beforeCoreCount: beforeCore.length,
		afterCoreCount: afterCore.length,
		addedCoreAttachments: added.length,
		removedCoreAttachments: removed.length,
		addedCoreAttachmentTargets: added.map((entry) => ({
			roleName: entry.roleName,
			resourceType: entry.resourceType,
			resourceId: entry.resourceId,
		})),
		removedCoreAttachmentTargets: removed.map((entry) => ({
			roleName: entry.roleName,
			resourceType: entry.resourceType,
			resourceId: entry.resourceId,
		})),
	}
}

/**
 * User Refresh Workflow
 * Orchestrates periodic refresh of user data
 */

/**
 * Workflow parameters
 */
export interface UserRefreshWorkflowParams {
	userId: string
	refreshMode?: 'scheduled' | 'event' | 'manual'
	suppressDiscordRefresh?: boolean
	forceTokenValidation?: boolean
}

/**
 * User Refresh Workflow
 * Updates the database with workflow completion timestamp
 *
 * IMPORTANT: Cloudflare Workflows hibernate between steps, discarding all in-memory state.
 * Services (db) must be recreated inside each step using createContext().
 * Database queries MUST be wrapped in step.do() to cache results across hibernation.
 */
export class UserRefreshWorkflow extends WorkflowEntrypoint<Env, UserRefreshWorkflowParams> {
	/**
	 * Create workflow context inside each step.
	 * MUST be called inside step.do() callbacks since services don't survive hibernation.
	 */
	private createContext(
		userId: string,
		workflowInstanceId: string,
		refreshMode: UserRefreshWorkflowParams['refreshMode'] = 'scheduled',
		suppressDiscordRefresh: boolean = false,
		forceTokenValidation: boolean = false
	): WorkflowContext {
		return {
			env: this.env,
			workflowInstanceId,
			db: createDb(this.env.DATABASE_URL),
			userId,
			refreshMode,
			suppressDiscordRefresh,
			forceTokenValidation,
		}
	}

	private async refreshCharacterWithIsolation(
		step: WorkflowStep,
		userId: string,
		workflowInstanceId: string,
		refreshMode: UserRefreshWorkflowParams['refreshMode'],
		suppressDiscordRefresh: boolean,
		forceTokenValidation: boolean,
		characterId: string
	): Promise<CharacterRefreshOutcome> {
		console.log('[Workflow] Character refresh started', {
			userId,
			workflowInstanceId,
			characterId,
		})

		try {
			const updateCharacterPublicInfoResult = await step.do(
				`update-character-public-info-${characterId}`,
				CHARACTER_STEP_OPTIONS,
				async () => {
					const ctx = this.createContext(
						userId,
						workflowInstanceId,
						refreshMode,
						suppressDiscordRefresh,
						forceTokenValidation
					)
					return updateCharacterPublicInfo(ctx, characterId)
				}
			)

			if (updateCharacterPublicInfoResult.isDeleted) {
				await step.do(
					`reconcile-corporation-membership-${characterId}`,
					CHARACTER_STEP_OPTIONS,
					async () => {
						const ctx = this.createContext(
							userId,
							workflowInstanceId,
							refreshMode,
							suppressDiscordRefresh,
							forceTokenValidation
						)
						return reconcileCharacterCorporationMembership(ctx, characterId, null)
					}
				)

				return {
					characterId,
					status: 'deleted',
					affiliationChanged: updateCharacterPublicInfoResult.affiliationChanged,
				}
			}

			await step.do(
				`reconcile-corporation-membership-${characterId}`,
				CHARACTER_STEP_OPTIONS,
				async () => {
					const ctx = this.createContext(
						userId,
						workflowInstanceId,
						refreshMode,
						suppressDiscordRefresh,
						forceTokenValidation
					)
					return reconcileCharacterCorporationMembership(
						ctx,
						characterId,
						updateCharacterPublicInfoResult.corporationId
					)
				}
			)

		const authenticatedFetchResult = await step.do(
				`validate-character-token-${characterId}`,
				CHARACTER_STEP_OPTIONS,
				async () => {
					const ctx = this.createContext(
						userId,
						workflowInstanceId,
						refreshMode,
						suppressDiscordRefresh,
						forceTokenValidation
					)
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
				affiliationChanged: updateCharacterPublicInfoResult.affiliationChanged,
				authenticatedSuccess: authenticatedFetchResult.success,
				tokenInvalidated: authenticatedFetchResult.tokenInvalidated,
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
		} finally {
			console.log('[Workflow] Character refresh finished', {
				userId,
				workflowInstanceId,
				characterId,
			})
		}
	}

	async run(
		event: WorkflowEvent<UserRefreshWorkflowParams>,
		step: WorkflowStep
	): Promise<UserRefreshWorkflowResult> {
		const {
			userId,
			refreshMode = 'scheduled',
			suppressDiscordRefresh = false,
			forceTokenValidation = false,
		} = event.payload
		const workflowInstanceId = event.instanceId

		const logContext = { userId, workflowInstanceId, refreshMode, forceTokenValidation }
		const steps: Record<string, WorkflowStepStatus> = {}
		let characterOutcomes: CharacterRefreshOutcome[] = []
		let characterCount = 0

		await step.do('init-workflow', async () => {
			return {
				userId,
				workflowInstanceId,
				refreshMode,
				startedAt: new Date().toISOString(),
			}
		})
		steps['init-workflow'] = 'ok'

		console.log('[Workflow] Starting user refresh workflow', logContext)
		try {
			// Step 1: Check if user is blacklisted
			const checkUserBlacklistedResult = await step.do('check-user-blacklisted', () => {
				const ctx = this.createContext(
					userId,
					workflowInstanceId,
					refreshMode,
					suppressDiscordRefresh,
					forceTokenValidation
				)
				return checkUserBlacklisted(ctx)
			})
			steps['check-user-blacklisted'] = 'ok'

			console.log('[Workflow] Checked user blacklisted', {
				...logContext,
				isBlacklisted: checkUserBlacklistedResult.isBlacklisted,
			})

			// Step 2: Disable user if blacklisted
			if (checkUserBlacklistedResult.isBlacklisted) {
				await step.do('disable-blacklisted-user', () => {
					const ctx = this.createContext(
						userId,
						workflowInstanceId,
						refreshMode,
						suppressDiscordRefresh,
						forceTokenValidation
					)
					return disableBlacklistedUser(ctx)
				})
				steps['disable-blacklisted-user'] = 'ok'

				console.log('[Workflow] Disabled user', logContext)
			} else {
				steps['disable-blacklisted-user'] = 'skipped'
			}

			// Step 3: Fetch user's characters
			// CRITICAL: Database query MUST be in a step to cache results across hibernation
			const characters = await step.do('fetch-user-characters', async () => {
				const db = createDb(this.env.DATABASE_URL)
				return db.query.userCharacters.findMany({
					where: and(eq(userCharacters.userId, userId), eq(userCharacters.isDeleted, false)),
				})
			})
			steps['fetch-user-characters'] = 'ok'
			characterCount = characters.length
			console.log('[Workflow] Fetched user characters', {
				...logContext,
				characterCount: characters.length,
				characterIds: characters.map((character) => character.characterId),
			})

			// Process characters in bounded parallel, isolating failures per character.
			characterOutcomes = await runWithConcurrencyLimit(
				characters,
				CHARACTER_REFRESH_CONCURRENCY,
				(character) =>
					this.refreshCharacterWithIsolation(
						step,
						userId,
						workflowInstanceId,
						refreshMode,
						suppressDiscordRefresh,
						forceTokenValidation,
						character.characterId
					)
			)
			steps['refresh-characters'] = 'ok'

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
				failedCharacters: characterOutcomes
					.filter((outcome) => outcome.status !== 'success' && outcome.status !== 'deleted')
					.map((outcome) => ({
						characterId: outcome.characterId,
						status: outcome.status,
						error: outcome.error,
					})),
			})

			const invalidatedCharacterIds = [
				...new Set(
					characterOutcomes
						.filter((outcome) => outcome.tokenInvalidated === true)
						.map((outcome) => outcome.characterId)
				),
			]
			if (invalidatedCharacterIds.length > 0) {
				try {
					await step.do(
						'queue-token-invalidation-alerts',
						{
							retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
							timeout: '30 seconds',
						},
						async () => {
							const coreStub = getStub<Core>(this.env.CORE, 'default')
							const queueResult = await coreStub.queueTokenInvalidationAlerts({
								userId,
								characterIds: invalidatedCharacterIds,
								source: 'user-refresh-token-invalidated',
							})
							console.log('[Workflow] Queued token invalidation alert', {
								...logContext,
								invalidatedCharacterIds,
								queueResult,
							})
						}
					)
					steps['queue-token-invalidation-alerts'] = 'ok'
				} catch (error) {
					steps['queue-token-invalidation-alerts'] = 'failed'
					console.warn('[Workflow] Failed to queue token invalidation alert; continuing', {
						...logContext,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			} else {
				steps['queue-token-invalidation-alerts'] = 'skipped'
			}

			if (checkUserBlacklistedResult.isBlacklisted) {
				steps['get-user-role-attachments'] = 'skipped'
				steps['attach-user-roles'] = 'skipped'
			} else {
				// Step 4: Get user role attachments
				let getUserRoleAttachmentsResult = {
					roleAttachments: [] as Awaited<
						ReturnType<typeof getUserRoleAttachments>
					>['roleAttachments'],
				}
				try {
					getUserRoleAttachmentsResult = await step.do(
						'get-user-role-attachments',
						ROLE_STEP_OPTIONS,
						() => {
							const ctx = this.createContext(
								userId,
								workflowInstanceId,
								refreshMode,
								suppressDiscordRefresh,
								forceTokenValidation
							)
							return getUserRoleAttachments(ctx)
						}
					)
					steps['get-user-role-attachments'] = 'ok'
				} catch (error) {
					steps['get-user-role-attachments'] = 'failed'
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
					coreRoleAttachments: toCoreAttachmentSummaries(getUserRoleAttachmentsResult.roleAttachments)
						.length,
				})

				// Step 5: Attach user roles
				const attachUserRolesResult = await step.do('attach-user-roles', ROLE_STEP_OPTIONS, () => {
					const ctx = this.createContext(
						userId,
						workflowInstanceId,
						refreshMode,
						suppressDiscordRefresh,
						forceTokenValidation
					)
					return attachUserRoles(ctx)
				})
				steps['attach-user-roles'] = 'ok'

				console.log('[Workflow] Attached user roles', {
					...logContext,
					corporationRoleAttachments: attachUserRolesResult.corporationRoleAttachments.length,
					allianceRoleAttachments: attachUserRolesResult.allianceRoleAttachments.length,
				})

				const coreAttachmentDelta = summarizeCoreAttachmentDelta(
					getUserRoleAttachmentsResult.roleAttachments,
					[
						...attachUserRolesResult.corporationRoleAttachments,
						...attachUserRolesResult.allianceRoleAttachments,
					]
				)
				console.log('[Workflow] Core role attachment reconciliation delta', {
					...logContext,
					...coreAttachmentDelta,
				})

				let groupCleanupResult = {
					shouldStripGroups: false,
					hasQualifyingAffiliation: false,
					removedGroupIds: [] as string[],
					transferredOwnershipGroupIds: [] as string[],
					deletedGroupIds: [] as string[],
				}
				try {
					groupCleanupResult = await step.do(
						'reconcile-affiliation-group-memberships',
						ROLE_STEP_OPTIONS,
						() => {
							const ctx = this.createContext(
								userId,
								workflowInstanceId,
								refreshMode,
								suppressDiscordRefresh,
								forceTokenValidation
							)
							return reconcileAffiliationBasedGroupMemberships(ctx)
						}
					)
					steps['reconcile-affiliation-group-memberships'] = 'ok'
				} catch (error) {
					steps['reconcile-affiliation-group-memberships'] = 'failed'
					console.warn('[Workflow] Failed to reconcile affiliation-based group memberships; continuing', {
						...logContext,
						error: error instanceof Error ? error.message : String(error),
					})
				}

				if (groupCleanupResult.shouldStripGroups) {
					console.log('[Workflow] Stripped affiliation-based group memberships', {
						...logContext,
						removedGroupCount: groupCleanupResult.removedGroupIds.length,
						transferredOwnershipGroupCount: groupCleanupResult.transferredOwnershipGroupIds.length,
						deletedGroupCount: groupCleanupResult.deletedGroupIds.length,
					})
				}
			}

			// Step 6: Update completion timestamp
			await step.do('update-completion-timestamp', () => {
				const ctx = this.createContext(
					userId,
					workflowInstanceId,
					refreshMode,
					suppressDiscordRefresh,
					forceTokenValidation
				)
				return updateCompletionTimestamp(ctx)
			})
			steps['update-completion-timestamp'] = 'ok'

			console.log('[Workflow] Updated completion timestamp', logContext)
			console.log('[Workflow] User refresh workflow completed', logContext)

			const summary = {
				characterCount,
				success: characterOutcomes.filter((outcome) => outcome.status === 'success').length,
				deleted: characterOutcomes.filter((outcome) => outcome.status === 'deleted').length,
				affiliationChanged: characterOutcomes.filter((outcome) => outcome.affiliationChanged === true).length,
				transientFailedAfterRetries: characterOutcomes.filter(
					(outcome) => outcome.status === 'transient_failed_after_retries'
				).length,
				permanentFailed: characterOutcomes.filter(
					(outcome) => outcome.status === 'permanent_failed'
				).length,
			}
			const hasStepFailures = Object.values(steps).includes('failed')
			const hasCharacterFailures =
				summary.transientFailedAfterRetries > 0 || summary.permanentFailed > 0

			return {
				status: hasStepFailures || hasCharacterFailures ? 'completed_with_errors' : 'completed',
				userId,
				workflowInstanceId,
				refreshMode,
				steps,
				characterOutcomes,
				summary,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			steps['workflow'] = 'failed'
			console.error('[Workflow] User refresh workflow failed', {
				...logContext,
				error: errorMessage,
				stack: error instanceof Error ? error.stack : undefined,
			})

			return {
				status: 'failed',
				userId,
				workflowInstanceId,
				refreshMode,
				steps,
				characterOutcomes,
				summary: {
					characterCount,
					success: characterOutcomes.filter((outcome) => outcome.status === 'success').length,
					deleted: characterOutcomes.filter((outcome) => outcome.status === 'deleted').length,
					affiliationChanged: characterOutcomes.filter(
						(outcome) => outcome.affiliationChanged === true
					).length,
					transientFailedAfterRetries: characterOutcomes.filter(
						(outcome) => outcome.status === 'transient_failed_after_retries'
					).length,
					permanentFailed: characterOutcomes.filter(
						(outcome) => outcome.status === 'permanent_failed'
					).length,
				},
				error: {
					message: errorMessage,
					stack: error instanceof Error ? error.stack : undefined,
				},
			}
		}
	}
}
