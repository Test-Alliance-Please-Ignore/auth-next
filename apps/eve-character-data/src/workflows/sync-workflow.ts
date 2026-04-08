import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'
import { createWorkflowInstanceUpdater } from '@repo/orchestrator'

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
	private static readonly ESI_RATE_LIMIT_SLEEP_FALLBACK_SECONDS = 10
	private static readonly ESI_RATE_LIMIT_SLEEP_MAX_SECONDS = 60

	private parseEsiErrorMetadata(message: string): Record<string, unknown> | null {
		const metadataMarker = ' | metadata='
		const markerIndex = message.lastIndexOf(metadataMarker)
		if (markerIndex === -1) {
			return null
		}

		const metadataText = message.slice(markerIndex + metadataMarker.length).trim()
		if (!metadataText) {
			return null
		}

		try {
			const parsed = JSON.parse(metadataText)
			return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
		} catch {
			return null
		}
	}

	private extractEsiRateLimitSleepSeconds(message: string): number | null {
		const metadata = this.parseEsiErrorMetadata(message)
		if (!metadata) {
			return null
		}

		const status = typeof metadata.status === 'number' ? metadata.status : null
		if (status !== 429) {
			return null
		}

		const retryAfter =
			typeof metadata.retryAfterSeconds === 'number' ? metadata.retryAfterSeconds : undefined
		const errorLimitReset =
			typeof metadata.errorLimitResetSeconds === 'number'
				? metadata.errorLimitResetSeconds
				: undefined
		const recommendedSeconds =
			retryAfter ?? errorLimitReset ?? EveCharacterSyncWorkflow.ESI_RATE_LIMIT_SLEEP_FALLBACK_SECONDS

		return Math.max(
			1,
			Math.min(EveCharacterSyncWorkflow.ESI_RATE_LIMIT_SLEEP_MAX_SECONDS, recommendedSeconds)
		)
	}

	private async sleepForRateLimitRetry(stepName: string, seconds: number): Promise<void> {
		logger.warn('[EveCharacterSyncWorkflow] ESI 429 retry pacing delay', {
			stepName,
			waitSeconds: seconds,
		})
		await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
	}

	private isPermanentEsiAuthFailure(message: string): boolean {
		const normalized = message.toLowerCase()
		const isBadRequest = normalized.includes('esi request failed: 400')
		const isAuthUnauthorized = normalized.includes('esi request failed: 401')
		const isAuthForbidden = normalized.includes('esi request failed: 403')
		if (!isBadRequest && !isAuthUnauthorized && !isAuthForbidden) {
			return false
		}

		return (
			normalized.includes('bad request') ||
			normalized.includes('unauthorized') ||
			normalized.includes('forbidden') ||
			normalized.includes('no token provided') ||
			normalized.includes('invalid token') ||
			normalized.includes('token expired')
		)
	}

	private async withEsiRetryClassification<T>(stepName: string, run: () => Promise<T>): Promise<T> {
		try {
			return await run()
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			if (this.isPermanentEsiAuthFailure(message)) {
				logger.warn('[EveCharacterSyncWorkflow] Non-retryable ESI auth failure', {
					stepName,
					error: message,
				})
				throw new NonRetryableError(`${stepName}: ${message}`)
			}

			const rateLimitSleepSeconds = this.extractEsiRateLimitSleepSeconds(message)
			if (rateLimitSleepSeconds !== null) {
				await this.sleepForRateLimitRetry(stepName, rateLimitSleepSeconds)
			}

			throw error
		}
	}

	async run(event: WorkflowEvent<EveCharacterSyncParams>, step: WorkflowStep) {
		const { characterId, dataTypes, trigger, jitterDelaySeconds } = event.payload

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
			publicInfoResult = await step.do(
				'fetch-public-info',
				{
					retries: { limit: 5, delay: '1 minute', backoff: 'exponential' },
					timeout: '1 minute',
				},
				() =>
					this.withEsiRetryClassification('fetch-public-info', async () => {
						logger.debug('[Step] Fetching public info', { characterId })
						return await refreshHelpers.refreshPublicInfo(this.env, characterId)
					})
			)
			logger.info('[Step] Public info fetched', {
				characterId,
				characterName: publicInfoResult.characterName,
			})
		} else {
			logger.debug('[Step] Skipping public info sync (filtered)', { characterId })
		}

		// Step 2: Fetch & store authenticated data
		let authenticatedDataResult: refreshAuthenticatedData.RefreshAuthenticatedDataResult | null = null
		if (shouldSync('authenticated')) {
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
						retries: { limit: 5, delay: '1 minute', backoff: 'exponential' },
						timeout: '1 minute',
					},
					() =>
						this.withEsiRetryClassification('fetch-authenticated-data', async () => {
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
			await Promise.all([
				updater.markCompleted(),
				tokenStoreStub.markCharacterDataSyncComplete(characterId),
			])
		})

		return {
			success: true,
			characterId,
			trigger,
			tokenStatus: tokenValidation.status,
			stats: {
				characterName: publicInfoResult?.characterName,
				hasAuthenticatedData: authenticatedDataResult?.success,
			},
		}
	}
}
