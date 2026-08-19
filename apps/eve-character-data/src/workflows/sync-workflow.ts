import { WorkflowEntrypoint } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'
import { createWorkflowInstanceUpdater } from '@repo/orchestrator'
import { esiRetryOptions, withEsiRetryClassification } from '@repo/workflow-utils'

import * as refreshAuthenticatedData from './helpers/refresh-authenticated-data'
import * as refreshHelpers from './helpers/refresh-public-info'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { EveCharacterData, EveCharacterSyncDataType } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../context'

type TokenValidationSummary = {
	hasValidToken: boolean
	status: string
	refreshAttempted: boolean
	refreshSucceeded: boolean
	error?: string
}

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
 * 3. Character wallet journal and market transactions - requires a token and
 *    an active member-corporation affiliation
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
		const shouldSyncAuthenticatedData = shouldSync('authenticated')
		const shouldSyncWalletJournal = shouldSync('wallet-journal')
		const shouldSyncMarketTransactions = shouldSync('market-transactions')
		const shouldSyncAuthenticatedSources =
			shouldSyncAuthenticatedData || shouldSyncWalletJournal || shouldSyncMarketTransactions

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
		const publicInfoRefreshedCharacterIds: string[] = []
		const syncStats = {
			deleted: 0,
			publicInfoSuccess: 0,
			authenticatedSuccess: 0,
			authenticatedSkippedNoToken: 0,
			walletJournalSuccess: 0,
			marketTransactionsSuccess: 0,
			walletDataSkippedNotMember: 0,
			characterFailures: 0,
		}

		let tokenValidityByCharacterId = new Map<
			string,
			{
				characterId: string
				previousHasValidToken: boolean | null
				nextHasValidToken: boolean | null
				validationStatus: string | null
				validationError: string | null
				refreshAttempted: boolean
				refreshSucceeded: boolean
			}
		>()
		if (userId) {
			try {
				const transitions = await step.do(
					'sync-token-validity-batch',
					{
						retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
						timeout: '1 minute',
					},
					async () =>
						await this.env.CORE.syncUserCharacterTokenValidityBatch({
							userId,
							characterIds,
							forceValidate: trigger === 'cron',
						})
				)
				tokenValidityByCharacterId = new Map(
					transitions.map((transition) => [transition.characterId, transition])
				)

				const invalidatedCharacterIds = transitions
					.filter(
						(transition) =>
							transition.previousHasValidToken === true && transition.nextHasValidToken === false
					)
					.map((transition) => transition.characterId)

				if (invalidatedCharacterIds.length > 0) {
					const queueResult = await this.env.CORE.queueTokenInvalidationAlerts({
						userId,
						characterIds: invalidatedCharacterIds,
						source: 'character-refresh-token-invalidated',
					})
					logger.info(
						'[EveCharacterSyncWorkflow] Queued token invalidation alerts from batch sync',
						{
							userId,
							invalidatedCharacterIds,
							queueResult,
						}
					)
				}
			} catch (error) {
				logger.warn(
					'[EveCharacterSyncWorkflow] Failed to batch-sync token validity; falling back to per-character validation',
					{
						userId,
						error: error instanceof Error ? error.message : String(error),
					}
				)
			}
		}

		for (const [index, characterId] of characterIds.entries()) {
			let characterMarkedDeleted = false
			const stepSuffix = `${index + 1}-${characterId}`
			try {
				let publicInfoResult: refreshHelpers.RefreshPublicInfoResult | null = null
				let tokenValidation: TokenValidationSummary = {
					hasValidToken: false,
					status: 'unknown',
					refreshAttempted: false,
					refreshSucceeded: false,
				}
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
									logger.debug('[Step] Fetching public info', {
										characterId,
										userId: userId ?? null,
									})
									return await refreshHelpers.refreshPublicInfo(this.env, characterId)
								})
						)
						syncStats.publicInfoSuccess++
						publicInfoRefreshedCharacterIds.push(characterId)
						if (publicInfoResult.isDeleted) {
							await step.do(`mark-character-deleted-${stepSuffix}`, async () => {
								const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
								await tokenStoreStub.markCharacterDeleted(characterId)
							})
							characterMarkedDeleted = true
							syncStats.deleted++
						} else if (publicInfoResult.affiliationChanged) {
							affiliationChangedCharacterIds.push(characterId)
						}
						// Fetch corporation history in a separate step with its own retry config.
						// This is a public ESI endpoint so it doesn't require auth, but it can
						// still fail (rate limits, ESI downtime) without impacting the critical
						// public-info and affiliation detection for this character.
						if (!publicInfoResult.isDeleted) {
							try {
								await step.do(
									`fetch-corporation-history-${stepSuffix}`,
									{
										retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' },
										timeout: '30 seconds',
									},
									async () => {
										const characterDataStub = getStub<EveCharacterData>(
											this.env.EVE_CHARACTER_DATA,
											'default'
										)
										logger.debug('[Step] Fetching corporation history', {
											characterId,
											userId: userId ?? null,
										})
										return await characterDataStub.fetchCorporationHistory(characterId)
									}
								)
							} catch (error) {
								const message = error instanceof Error ? error.message : String(error)
								logger.warn(
									'[EveCharacterSyncWorkflow] Corporation history fetch failed (non-fatal)',
									{
										characterId,
										userId: userId ?? null,
										error: message,
									}
								)
							}
						}
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error)
						logger.error('[EveCharacterSyncWorkflow] fetch-public-info step failed', {
							characterId,
							userId: userId ?? null,
							error: message,
							errorDetails: extractErrorDetails(error),
						})
						throw error
					}
				}

				const batchTokenValidation = tokenValidityByCharacterId.get(characterId)
				if (batchTokenValidation) {
					tokenValidation = {
						hasValidToken: batchTokenValidation.nextHasValidToken === true,
						status: batchTokenValidation.validationStatus ?? 'cached',
						refreshAttempted: batchTokenValidation.refreshAttempted,
						refreshSucceeded: batchTokenValidation.refreshSucceeded,
						error: batchTokenValidation.validationError ?? undefined,
					}
				} else {
					// Sub-step: Validate token per character — attempts refresh when needed.
					// This runs after public refresh so deleted-character detection is not blocked
					// by token cooldown or invalid token state.
					tokenValidation = await step.do(
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
				}

				if (shouldSyncAuthenticatedSources && !characterMarkedDeleted) {
					if (!tokenValidation.hasValidToken) {
						if (shouldSyncAuthenticatedData) {
							syncStats.authenticatedSkippedNoToken++
						}
					} else {
						const authenticatedDataResult = await step.do(
							`fetch-authenticated-sources-${stepSuffix}`,
							{
								...esiRetryOptions,
								timeout: '1 minute',
							},
							() =>
								withEsiRetryClassification('fetch-authenticated-data', async () => {
									logger.debug('[Step] Fetching authenticated sources', {
										characterId,
										userId: userId ?? null,
									})
									return await refreshAuthenticatedData.refreshAuthenticatedData(
										this.env,
										characterId,
										{
											includeAuthenticatedData: shouldSyncAuthenticatedData,
											includeWalletJournal: shouldSyncWalletJournal,
											includeMarketTransactions: shouldSyncMarketTransactions,
											corporationId: publicInfoResult?.currentCorporationId,
										}
									)
								})
						)
						if (authenticatedDataResult.success) {
							if (shouldSyncAuthenticatedData) {
								syncStats.authenticatedSuccess++
							}
							if (authenticatedDataResult.walletJournalRefreshed) {
								syncStats.walletJournalSuccess++
							}
							if (authenticatedDataResult.marketTransactionsRefreshed) {
								syncStats.marketTransactionsSuccess++
							}
							if (
								authenticatedDataResult.walletDataSkipReason === 'not_member_corporation' &&
								(shouldSyncWalletJournal ||
									shouldSyncMarketTransactions ||
									shouldSyncAuthenticatedData)
							) {
								syncStats.walletDataSkippedNotMember++
							}
						} else {
							if (shouldSyncAuthenticatedData) {
								syncStats.authenticatedSkippedNoToken++
							}
						}
					}
				}
			} catch (error) {
				syncStats.characterFailures++
				logger.error(
					'[EveCharacterSyncWorkflow] Character sync failed; continuing with next character',
					{
						characterId,
						userId: userId ?? null,
						error: error instanceof Error ? error.message : String(error),
						errorDetails: extractErrorDetails(error),
					}
				)
			}
		}

		// End-of-user cascade:
		// - cron runs keep change-based behavior
		// - api/manual runs force reconciliation for all public-info refreshed characters
		//   to heal existing core affiliation drift even when eve-character-data has no local delta
		const reconciliationCharacterIds =
			trigger === 'api' ? publicInfoRefreshedCharacterIds : affiliationChangedCharacterIds
		if (reconciliationCharacterIds.length > 0) {
			await step.do(
				'notify-core-affiliation-changes',
				{
					retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
					timeout: '30 seconds',
				},
				async () => {
					const cascadeResult = await this.env.CORE.handleCharacterAffiliationChanges(
						reconciliationCharacterIds,
						{
							source:
								trigger === 'api'
									? 'eve-character-sync-manual-reconcile'
									: 'eve-character-sync-affiliation-change',
							bypassThrottle: true,
						}
					)
					logger.info('[EveCharacterSyncWorkflow] Core affiliation cascade result', {
						userId: userId ?? null,
						reconciledCharacterCount: reconciliationCharacterIds.length,
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
