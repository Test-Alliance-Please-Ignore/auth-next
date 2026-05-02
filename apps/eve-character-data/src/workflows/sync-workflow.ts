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
	/** User ID owning the characters to sync (preferred mode) */
	userId?: string
	/** Character IDs to sync */
	characterIds?: string[]
	/** Legacy single character mode */
	characterId?: string
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
		const { dataTypes, trigger, jitterDelaySeconds, userId } = event.payload
		const requestedCharacterIds = event.payload.characterIds ?? []
		const legacyCharacterId = event.payload.characterId
		const characterIds = [
			...new Set(
				[...requestedCharacterIds, ...(legacyCharacterId ? [legacyCharacterId] : [])]
					.map((id) => String(id).trim())
					.filter(Boolean)
			),
		]
		if (characterIds.length === 0) {
			throw new Error('EveCharacterSyncWorkflow requires at least one character ID')
		}

		// Helper to check if a data type should be synced
		const requestedTypes = dataTypes ? new Set<EveCharacterSyncDataType>(dataTypes) : null
		const shouldSync = (type: EveCharacterSyncDataType) =>
			!requestedTypes || requestedTypes.size === 0 || requestedTypes.has(type)

		logger.info('[EveCharacterSyncWorkflow] Starting character sync', {
			userId: userId ?? null,
			characterCount: characterIds.length,
			characterIds,
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

		const affiliationChangedCharacterIds: string[] = []
		const syncStats = {
			deleted: 0,
			publicInfoSuccess: 0,
			authenticatedSuccess: 0,
			authenticatedSkippedNoToken: 0,
			characterFailures: 0,
		}

		for (const [index, characterId] of characterIds.entries()) {
			let characterMarkedDeleted = false
			const stepSuffix = `${index + 1}-${characterId}`
			try {
				// Sub-step: Validate token per character — attempts refresh when needed.
				const tokenValidation = await step.do(
					`validate-token-${stepSuffix}`,
					{
						retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
						timeout: '30 seconds',
					},
					async () => {
						const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
						const validation = await tokenStoreStub.validateToken(characterId)
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

				let publicInfoResult: refreshHelpers.RefreshPublicInfoResult | null = null
				if (shouldSync('public-info')) {
					try {
						publicInfoResult = await step.do(
							`fetch-public-info-${stepSuffix}`,
							{
								...esiRetryOptions,
								timeout: '1 minute',
							},
							() =>
								withEsiRetryClassification('fetch-public-info', async () => {
									logger.debug('[Step] Fetching public info', { characterId, userId: userId ?? null })
									return await refreshHelpers.refreshPublicInfo(this.env, characterId)
								})
						)
						syncStats.publicInfoSuccess++
						if (publicInfoResult.affiliationChanged) {
							affiliationChangedCharacterIds.push(characterId)
						}
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
								userId: userId ?? null,
								error: message,
								errorDetails: extractErrorDetails(error),
							})
							throw error
						}

						await step.do(`mark-character-deleted-${stepSuffix}`, async () => {
							const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
							await tokenStoreStub.markCharacterDeleted(characterId)
						})
						characterMarkedDeleted = true
						syncStats.deleted++
					}
				}

				if (shouldSync('authenticated') && !characterMarkedDeleted) {
					if (!tokenValidation.hasValidToken) {
						syncStats.authenticatedSkippedNoToken++
					} else {
						const authenticatedDataResult = await step.do(
							`fetch-authenticated-data-${stepSuffix}`,
							{
								...esiRetryOptions,
								timeout: '1 minute',
							},
							() =>
								withEsiRetryClassification('fetch-authenticated-data', async () => {
									logger.debug('[Step] Fetching authenticated data', {
										characterId,
										userId: userId ?? null,
									})
									return await refreshAuthenticatedData.refreshAuthenticatedData(
										this.env,
										characterId
									)
								})
						)
						if (authenticatedDataResult.success) {
							syncStats.authenticatedSuccess++
						} else {
							syncStats.authenticatedSkippedNoToken++
						}
					}
				}
			} catch (error) {
				syncStats.characterFailures++
				logger.error('[EveCharacterSyncWorkflow] Character sync failed; continuing with next character', {
					characterId,
					userId: userId ?? null,
					error: error instanceof Error ? error.message : String(error),
					errorDetails: extractErrorDetails(error),
				})
			}
		}

		// End-of-user cascade: when any character affiliation changed, reconcile in Core.
		if (affiliationChangedCharacterIds.length > 0) {
			await step.do(
				'notify-core-affiliation-changes',
				{
					retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
					timeout: '30 seconds',
				},
				async () => {
					const cascadeResult = await this.env.CORE.handleCharacterAffiliationChanges(
						affiliationChangedCharacterIds,
						{
						source: 'eve-character-sync-affiliation-change',
						bypassThrottle: true,
						}
					)
					logger.info('[EveCharacterSyncWorkflow] Core affiliation cascade result', {
						userId: userId ?? null,
						changedCharacterCount: affiliationChangedCharacterIds.length,
						...cascadeResult,
					})
				}
			)
		}

		logger.info('[EveCharacterSyncWorkflow] Character sync completed successfully', {
			userId: userId ?? null,
			characterIds,
			trigger,
			affiliationChangedCharacterIds,
			stats: {
				...syncStats,
			},
		})

		// Step: Mark workflow as completed and record data sync timestamp
		// Note: updater must be created inside step to survive hibernation
		await step.do('mark-completed', async () => {
			const updater = createWorkflowInstanceUpdater(event.instanceId, this.env.DATABASE_URL)
			const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
			const completionTasks = [updater.markCompleted()]
			for (const characterId of characterIds) {
				completionTasks.push(tokenStoreStub.markCharacterDataSyncComplete(characterId))
			}
			await Promise.all(completionTasks)
		})

		return {
			success: true,
			userId: userId ?? null,
			characterIds,
			trigger,
			affiliationChangedCharacterIds,
			stats: {
				...syncStats,
			},
		}
	}
}
