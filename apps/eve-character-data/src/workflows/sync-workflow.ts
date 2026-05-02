import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'
import { createWorkflowInstanceUpdater } from '@repo/orchestrator'
import { esiRetryOptions, withEsiRetryClassification } from '@repo/workflow-utils'

import * as refreshHelpers from './helpers/refresh-public-info'
import * as refreshAuthenticatedData from './helpers/refresh-authenticated-data'

import type { EveCharacterSyncDataType } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../context'

/**
 * Workflow parameters for character data synchronization
 */
export interface EveCharacterSyncParams {
	/** Character ID to sync */
	characterId: string
	/** Optional: specific data types to sync (defaults to all) */
	dataTypes?: EveCharacterSyncDataType[]
	/** Trigger source (cron or api) */
	trigger: 'cron' | 'api'
	/** Optional jitter delay in seconds before the workflow begins work */
	jitterDelaySeconds?: number
}

function extractErrorDetails(error: unknown): Record<string, unknown> {
	if (!error || typeof error !== 'object') {
		return { rawError: String(error) }
	}

	const e = error as Record<string, unknown>
	return {
		name: e.name,
		message: e.message,
		code: e.code,
		detail: e.detail,
		hint: e.hint,
		constraint: e.constraint,
		table: e.table,
		column: e.column,
		schema: e.schema,
		severity: e.severity,
		where: e.where,
		routine: e.routine,
		stack: e.stack,
		cause: e.cause,
	}
}

/**
 * EveCharacterSyncWorkflow
 *
 * Orchestrates the synchronization of character data from ESI.
 * Each workflow instance represents a single sync operation for one character.
 *
 * Data Types Synced:
 * 1. Public info (no auth required)
 * 2. Authenticated data (skills, attributes, wallet balance) - requires token
 */
export class EveCharacterSyncWorkflow extends WorkflowEntrypoint<Env, EveCharacterSyncParams> {
	async run(event: WorkflowEvent<EveCharacterSyncParams>, step: WorkflowStep) {
		const { dataTypes, trigger, jitterDelaySeconds } = event.payload
		const characterId = String(event.payload.characterId)
		let characterMarkedDeleted = false

		// Helper to check if a data type should be synced
		const requestedTypes = dataTypes ? new Set<EveCharacterSyncDataType>(dataTypes) : null
		const shouldSync = (type: EveCharacterSyncDataType) =>
			!requestedTypes || requestedTypes.size === 0 || requestedTypes.has(type)

		logger.info('[EveCharacterSyncWorkflow] Starting character sync', {
			characterId,
			dataTypes: dataTypes || 'all',
			trigger,
			jitterDelaySeconds: jitterDelaySeconds ?? 0,
			timestamp: event.timestamp,
		})

		// Step: Jitter delay — spread load across the batch window
		if (jitterDelaySeconds && jitterDelaySeconds > 0) {
			await step.sleep('jitter-delay', `${jitterDelaySeconds} seconds`)
		}

		// Step: Mark workflow as running
		// Note: updater must be created inside step to survive hibernation
		await step.do('mark-running', async () => {
			const updater = createWorkflowInstanceUpdater(event.instanceId, this.env.DATABASE_URL)
			await updater.markRunning()
		})

		// Step: Validate token upfront — proactively refreshes if expired, detects revoked/missing tokens
		const tokenValidation = await step.do(
			'validate-token',
			{
				retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
				timeout: '30 seconds',
			},
			async () => {
				const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
				const validation = await tokenStoreStub.validateToken(characterId)
				// Treat transient errors as retriable — step retries will handle them
				if (validation.status === 'transient_error') {
					throw new Error(`Transient token validation error for character ${characterId}`)
				}
				return {
					hasValidToken: validation.isValid,
					status: validation.status,
					refreshAttempted: validation.refreshAttempted,
					refreshSucceeded: validation.refreshSucceeded,
				}
			}
		)

		logger.info('[EveCharacterSyncWorkflow] Token validation complete', {
			characterId,
			hasValidToken: tokenValidation.hasValidToken,
			status: tokenValidation.status,
			refreshAttempted: tokenValidation.refreshAttempted,
			refreshSucceeded: tokenValidation.refreshSucceeded,
		})

		// Step 1: Fetch & store public info
		let publicInfoResult: refreshHelpers.RefreshPublicInfoResult | null = null
		if (shouldSync('public-info')) {
			try {
				publicInfoResult = await step.do(
					'fetch-public-info',
					{
						...esiRetryOptions,
						timeout: '1 minute',
					},
					() =>
						withEsiRetryClassification('fetch-public-info', async () => {
							logger.debug('[Step] Fetching public info', { characterId })
							return await refreshHelpers.refreshPublicInfo(this.env, characterId)
						})
				)
				logger.info('[Step] Public info fetched', {
					characterId,
					characterName: publicInfoResult.characterName,
				})
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				const lowerMessage = message.toLowerCase()
				const isDeletedCharacterError =
					lowerMessage.includes('has been deleted') ||
					lowerMessage.includes('character deleted') ||
					lowerMessage.includes('character_deleted') ||
					lowerMessage.includes('esi request failed: 404')

				if (!isDeletedCharacterError) {
					logger.error('[EveCharacterSyncWorkflow] fetch-public-info step failed', {
						characterId,
						error: message,
						errorDetails: extractErrorDetails(error),
					})
					throw error
				}

				await step.do('mark-character-deleted', async () => {
					const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
					await tokenStoreStub.markCharacterDeleted(characterId)
				})
				characterMarkedDeleted = true

				logger.info('[EveCharacterSyncWorkflow] Character marked deleted after non-retryable public info error', {
					characterId,
					error: message,
					errorDetails: extractErrorDetails(error),
				})
			}
		} else {
			logger.debug('[Step] Skipping public info sync (filtered)', { characterId })
		}

		// If public affiliation changed, route to Core so user-character linkage,
		// role attachments, and Discord entitlement refresh all converge.
		if (
			!characterMarkedDeleted &&
			publicInfoResult?.success &&
			publicInfoResult.affiliationChanged
		) {
			await step.do(
				'notify-core-affiliation-change',
				{
					retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
					timeout: '30 seconds',
				},
				async () => {
					await this.env.CORE.handleCharacterAffiliationChange(characterId, {
						source: 'eve-character-sync-affiliation-change',
						bypassThrottle: true,
					})
				}
			)
		}

		// Step 2: Fetch & store authenticated data
		let authenticatedDataResult: refreshAuthenticatedData.RefreshAuthenticatedDataResult | null = null
		if (shouldSync('authenticated') && !characterMarkedDeleted) {
			if (!tokenValidation.hasValidToken) {
				logger.info('[Step] Skipping authenticated data (no valid token)', {
					characterId,
					tokenStatus: tokenValidation.status,
				})
				authenticatedDataResult = { success: false, hasValidToken: false }
			} else {
				authenticatedDataResult = await step.do(
					'fetch-authenticated-data',
					{
						...esiRetryOptions,
						timeout: '1 minute',
					},
					() =>
						withEsiRetryClassification('fetch-authenticated-data', async () => {
							logger.debug('[Step] Fetching authenticated data', { characterId })
							return await refreshAuthenticatedData.refreshAuthenticatedData(
								this.env,
								characterId
							)
						})
				)
				if (authenticatedDataResult.success) {
					logger.info('[Step] Authenticated data fetched', { characterId })
				} else {
					logger.info('[Step] Authenticated data skipped (no valid token)', { characterId })
				}
			}
		} else {
			logger.debug('[Step] Skipping authenticated data sync (filtered)', { characterId })
		}

		logger.info('[EveCharacterSyncWorkflow] Character sync completed successfully', {
			characterId,
			trigger,
			characterMarkedDeleted,
			tokenStatus: tokenValidation.status,
			stats: {
				characterName: publicInfoResult?.characterName,
				hasAuthenticatedData: authenticatedDataResult?.success,
			},
		})

		// Step: Mark workflow as completed and record data sync timestamp
		// Note: updater must be created inside step to survive hibernation
		await step.do('mark-completed', async () => {
			const updater = createWorkflowInstanceUpdater(event.instanceId, this.env.DATABASE_URL)
			const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
			const completionTasks = [updater.markCompleted()]
			if (!characterMarkedDeleted) {
				completionTasks.push(tokenStoreStub.markCharacterDataSyncComplete(characterId))
			}
			await Promise.all(completionTasks)
		})

		return {
			success: true,
			characterId,
			trigger,
			characterMarkedDeleted,
			tokenStatus: tokenValidation.status,
			stats: {
				characterName: publicInfoResult?.characterName,
				hasAuthenticatedData: authenticatedDataResult?.success,
			},
		}
	}
}
