import { WorkflowEntrypoint } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'

import { logger } from '@repo/hono-helpers'

import { syncAssets } from './steps/assets'
import {
	clearTaxProjectionRetryIntent,
	recordTaxProjectionRetryIntent,
	replayTaxProjectionRetryIntent,
	sendHrDepartedMessages,
	triggerTaxProjectionRefresh,
	updateCoreLastSync,
	updateSyncTimestamps,
} from './steps/common'
import { fetchContracts, storeContracts } from './steps/contracts'
import { recordDirectorSuccess, selectDirector } from './steps/directors'
import { fetchIndustryJobs, storeIndustryJobs } from './steps/industry-jobs'
import { fetchKillmails, storeKillmails } from './steps/killmails'
import { fetchMemberTracking, storeMemberTracking } from './steps/member-tracking'
import { fetchMembers, sendMembershipChangedMessages, storeMembers } from './steps/members'
import { fetchOrders, storeOrders } from './steps/orders'
import { fetchPublicInfo, storePublicInfo } from './steps/public-info'
import { fetchStructures, storeStructures } from './steps/structures'
import { syncWalletJournal } from './steps/wallet-journal'
import { syncWalletTransactions } from './steps/wallet-transactions'
import { fetchWallets, storeWallets } from './steps/wallets'
import { createShouldSyncPredicate } from './utils/should-sync'
import { dispatchTaxProjectionRefresh } from './utils/tax-projection-dispatch'
import {
	buildTaxProjectionRefreshInput,
	createTaxProjectionTriggerRunId,
} from './utils/tax-projection-trigger'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { EveCorporationSyncDataType } from '@repo/eve-corporation-data'
import type { Env } from '../context'
import type {
	DirectorInfo,
	EveCorporationSyncParams,
	EveCorporationSyncResult,
	SyncStats,
} from './types'

const STEP_RETRY_OPTIONS = {
	retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' } as const,
}
const ESI_RATE_LIMIT_SLEEP_FALLBACK_SECONDS = 10
const ESI_RATE_LIMIT_SLEEP_MAX_SECONDS = 45

/**
 * Result type for sync steps that tracks both the data type synced and any stats
 * All state must be derived from step returns to survive workflow hibernation
 */
interface SyncStepResult<T extends EveCorporationSyncDataType> {
	dataType: T
	stats: Partial<SyncStats>
}

export class EveCorporationSyncWorkflow extends WorkflowEntrypoint<Env, EveCorporationSyncParams> {
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
			retryAfter ?? errorLimitReset ?? ESI_RATE_LIMIT_SLEEP_FALLBACK_SECONDS

		return Math.max(1, Math.min(ESI_RATE_LIMIT_SLEEP_MAX_SECONDS, recommendedSeconds))
	}

	private async sleepForRateLimitRetry(stepName: string, seconds: number): Promise<void> {
		logger.warn('[EveCorporationSyncWorkflow] ESI 429 retry pacing delay', {
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
				logger.warn('[EveCorporationSyncWorkflow] Non-retryable ESI auth failure', {
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

	async run(event: WorkflowEvent<EveCorporationSyncParams>, step: WorkflowStep) {
		const { corporationId, dataTypes, trigger } = event.payload
		const workflowInstanceId = event.instanceId

		logger.info('[EveCorporationSyncWorkflow] Starting sync', {
			corporationId,
			dataTypes: dataTypes || 'all',
			trigger,
			timestamp: event.timestamp,
		})

		this.validateEnv()

		const shouldSync = createShouldSyncPredicate(dataTypes)

		const director: DirectorInfo | null = await step.do(
			'select-director',
			{
				retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
				timeout: '30 seconds',
			},
			async () => {
				try {
					return await selectDirector(this.env, corporationId)
				} catch (error) {
					logger.error(
						'[EveCorporationSyncWorkflow] select-director step failed; continuing without director',
						{
							corporationId,
							error: error instanceof Error ? error.message : String(error),
						}
					)
					return null
				}
			}
		)

		if (!director) {
			logger.warn(
				'[EveCorporationSyncWorkflow] No director available, skipping director-dependent steps',
				{ corporationId }
			)
		}

		const directorId = director?.directorId ?? null
		const directorCharacterId = director?.characterId ?? null
		const directorCharacterName = director?.characterName ?? null

		const shouldSyncAuthenticated = (type: EveCorporationSyncDataType) =>
			directorCharacterId !== null && shouldSync(type)

		// All step results - state is exclusively derived from step.do() returns
		// to survive workflow hibernation
		let publicInfoSync: SyncStepResult<'public-info'> | null = null
		let membersSync: SyncStepResult<'members'> | null = null
		let memberTrackingSync: SyncStepResult<'member-tracking'> | null = null
		let walletsSync: SyncStepResult<'wallets'> | null = null
		let walletJournalSync: SyncStepResult<'wallet-journal'> | null = null
		let walletTransactionsSync: SyncStepResult<'wallet-transactions'> | null = null
		let assetsSync: SyncStepResult<'assets'> | null = null
		let structuresSync: SyncStepResult<'structures'> | null = null
		let ordersSync: SyncStepResult<'orders'> | null = null
		let contractsSync: SyncStepResult<'contracts'> | null = null
		let industryJobsSync: SyncStepResult<'industry-jobs'> | null = null
		let killmailsSync: SyncStepResult<'killmails'> | null = null

		if (shouldSync('public-info')) {
			const publicInfo = await step.do(
				'fetch-public-info',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() =>
					this.withEsiRetryClassification('fetch-public-info', () =>
						fetchPublicInfo(this.env, corporationId)
					)
			)

			publicInfoSync = await step.do('store-public-info', {}, async () => {
				await storePublicInfo(this.env, corporationId, publicInfo)
				return {
					dataType: 'public-info' as const,
					stats: { corporationName: publicInfo.name },
				}
			})
		}

		if (shouldSyncAuthenticated('members')) {
			const members = await step.do(
				'fetch-members',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() =>
					this.withEsiRetryClassification('fetch-members', () =>
						fetchMembers(this.env, corporationId, directorCharacterId!)
					)
			)

			membersSync = await step.do('store-members', {}, async () => {
				const memberResult = await storeMembers(this.env, corporationId, members)

				if (memberResult.departedMemberIds.length > 0) {
					await sendHrDepartedMessages(this.env, corporationId, memberResult.departedMemberIds)
				}

				// Notify Core worker of membership changes for Discord refresh + role reconciliation
				if (memberResult.departedMemberIds.length > 0) {
					await sendMembershipChangedMessages(
						this.env,
						corporationId,
						memberResult.departedMemberIds // only departed members need refresh
					)
				}

				return {
					dataType: 'members' as const,
					stats: {
						totalMembers: members.length,
						departedMembers: memberResult.departedMemberIds.length,
						addedMembers: memberResult.addedMemberIds.length,
					},
				}
			})
		}

		if (shouldSyncAuthenticated('member-tracking')) {
			const trackingData = await step.do(
				'fetch-member-tracking',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() =>
					this.withEsiRetryClassification('fetch-member-tracking', () =>
						fetchMemberTracking(this.env, corporationId, directorCharacterId!)
					)
			)

			memberTrackingSync = await step.do('store-member-tracking', {}, async () => {
				await storeMemberTracking(this.env, corporationId, trackingData)
				return {
					dataType: 'member-tracking' as const,
					stats: {},
				}
			})
		}

		if (shouldSyncAuthenticated('wallets')) {
			const wallets = await step.do(
				'fetch-wallets',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() =>
					this.withEsiRetryClassification('fetch-wallets', () =>
						fetchWallets(this.env, corporationId, directorCharacterId!)
					)
			)

			walletsSync = await step.do('store-wallets', {}, async () => {
				await storeWallets(this.env, corporationId, wallets)
				return {
					dataType: 'wallets' as const,
					stats: { walletsCount: wallets.length },
				}
			})
		}

		if (shouldSyncAuthenticated('wallet-journal')) {
			walletJournalSync = await step.do(
				'sync-wallet-journal',
				{ ...STEP_RETRY_OPTIONS, timeout: '5 minutes' },
				async () => {
					const walletJournalResult = await this.withEsiRetryClassification(
						'sync-wallet-journal',
						() => syncWalletJournal(this.env, corporationId, directorCharacterId!)
					)
					return {
						dataType: 'wallet-journal' as const,
						stats: {
							walletJournalFetchedCount: walletJournalResult.totalEntries,
							walletJournalPersistedNewRows: walletJournalResult.persistedNewRows,
							walletJournalMaxId: walletJournalResult.maxJournalId,
							walletJournalMaxDate: walletJournalResult.maxJournalDate,
						},
					}
				}
			)
		}

		if (shouldSyncAuthenticated('wallet-transactions')) {
			walletTransactionsSync = await step.do(
				'sync-wallet-transactions',
				{ ...STEP_RETRY_OPTIONS, timeout: '5 minutes' },
				async () => {
					const walletTransactionsResult = await this.withEsiRetryClassification(
						'sync-wallet-transactions',
						() => syncWalletTransactions(this.env, corporationId, directorCharacterId!)
					)
					return {
						dataType: 'wallet-transactions' as const,
						stats: {
							walletTransactionsFetchedCount: walletTransactionsResult.totalTransactions,
							walletTransactionsPersistedNewRows: walletTransactionsResult.persistedNewRows,
							walletTransactionsMaxId: walletTransactionsResult.maxTransactionId,
							walletTransactionsMaxDate: walletTransactionsResult.maxTransactionDate,
						},
					}
				}
			)
		}

		if (shouldSyncAuthenticated('assets')) {
			assetsSync = await step.do(
				'sync-assets',
				{ ...STEP_RETRY_OPTIONS, timeout: '10 minutes' },
				async () => {
					const result = await this.withEsiRetryClassification('sync-assets', () =>
						syncAssets(this.env, corporationId, directorCharacterId!)
					)
					return {
						dataType: 'assets' as const,
						stats: { assetsCount: result.assetsCount },
					}
				}
			)
		}

		if (shouldSyncAuthenticated('structures')) {
			const structures = await step.do(
				'fetch-structures',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() =>
					this.withEsiRetryClassification('fetch-structures', () =>
						fetchStructures(this.env, corporationId, directorCharacterId!)
					)
			)

			structuresSync = await step.do('store-structures', {}, async () => {
				await storeStructures(this.env, corporationId, structures)
				return {
					dataType: 'structures' as const,
					stats: { structuresCount: structures.length },
				}
			})
		}

		if (shouldSyncAuthenticated('orders')) {
			const orders = await step.do(
				'fetch-orders',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() =>
					this.withEsiRetryClassification('fetch-orders', () =>
						fetchOrders(this.env, corporationId, directorCharacterId!)
					)
			)

			ordersSync = await step.do('store-orders', {}, async () => {
				await storeOrders(this.env, corporationId, orders)
				return {
					dataType: 'orders' as const,
					stats: { ordersCount: orders.length },
				}
			})
		}

		if (shouldSyncAuthenticated('contracts')) {
			const contracts = await step.do(
				'fetch-contracts',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() =>
					this.withEsiRetryClassification('fetch-contracts', () =>
						fetchContracts(this.env, corporationId, directorCharacterId!)
					)
			)

			contractsSync = await step.do('store-contracts', {}, async () => {
				await storeContracts(this.env, corporationId, contracts)
				return {
					dataType: 'contracts' as const,
					stats: { contractsCount: contracts.length },
				}
			})
		}

		if (shouldSyncAuthenticated('industry-jobs')) {
			const industryJobs = await step.do(
				'fetch-industry-jobs',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() =>
					this.withEsiRetryClassification('fetch-industry-jobs', () =>
						fetchIndustryJobs(this.env, corporationId, directorCharacterId!)
					)
			)

			industryJobsSync = await step.do('store-industry-jobs', {}, async () => {
				await storeIndustryJobs(this.env, corporationId, industryJobs)
				return {
					dataType: 'industry-jobs' as const,
					stats: { industryJobsCount: industryJobs.length },
				}
			})
		}

		if (shouldSyncAuthenticated('killmails')) {
			const killmails = await step.do(
				'fetch-killmails',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() =>
					this.withEsiRetryClassification('fetch-killmails', () =>
						fetchKillmails(this.env, corporationId, directorCharacterId!)
					)
			)

			killmailsSync = await step.do('store-killmails', {}, async () => {
				await storeKillmails(this.env, corporationId, killmails)
				return {
					dataType: 'killmails' as const,
					stats: { killmailsCount: killmails.length },
				}
			})
		}

		// Build final state exclusively from step return values
		// This ensures state survives workflow hibernation
		const allSyncResults = [
			publicInfoSync,
			membersSync,
			memberTrackingSync,
			walletsSync,
			walletJournalSync,
			walletTransactionsSync,
			assetsSync,
			structuresSync,
			ordersSync,
			contractsSync,
			industryJobsSync,
			killmailsSync,
		]

		const syncedDataTypes = allSyncResults
			.filter((result): result is NonNullable<typeof result> => result !== null)
			.map((result) => result.dataType)

		const stats: SyncStats = allSyncResults
			.filter((result): result is NonNullable<typeof result> => result !== null)
			.reduce((acc, result) => ({ ...acc, ...result.stats }), {} as SyncStats)

		const walletJournalFetched = walletJournalSync?.stats.walletJournalFetchedCount ?? 0
		const walletTransactionsFetched =
			walletTransactionsSync?.stats.walletTransactionsFetchedCount ?? 0
		const walletJournalPersistedNewRows =
			walletJournalSync?.stats.walletJournalPersistedNewRows ?? 0
		const walletTransactionsPersistedNewRows =
			walletTransactionsSync?.stats.walletTransactionsPersistedNewRows ?? 0
		const taxProjectionTriggerRunId = createTaxProjectionTriggerRunId({
			corporationId,
			stats: {
				walletJournalPersistedNewRows,
				walletJournalMaxId: walletJournalSync?.stats.walletJournalMaxId ?? null,
				walletJournalMaxDate: walletJournalSync?.stats.walletJournalMaxDate ?? null,
				walletTransactionsPersistedNewRows,
				walletTransactionsMaxId: walletTransactionsSync?.stats.walletTransactionsMaxId ?? null,
				walletTransactionsMaxDate: walletTransactionsSync?.stats.walletTransactionsMaxDate ?? null,
			},
		})
		const taxProjectionInput = buildTaxProjectionRefreshInput({
			corporationId,
			upstreamRunId: taxProjectionTriggerRunId,
			triggeredAt: new Date(),
			includeCharacterWallets: true,
			stats: {
				walletJournalPersistedNewRows,
				walletJournalMaxId: walletJournalSync?.stats.walletJournalMaxId ?? null,
				walletJournalMaxDate: walletJournalSync?.stats.walletJournalMaxDate ?? null,
				walletTransactionsPersistedNewRows,
				walletTransactionsMaxId: walletTransactionsSync?.stats.walletTransactionsMaxId ?? null,
				walletTransactionsMaxDate: walletTransactionsSync?.stats.walletTransactionsMaxDate ?? null,
			},
		})

		await step.do('update-sync-timestamps', {}, () =>
			updateSyncTimestamps(this.env, corporationId, syncedDataTypes)
		)

		await step.do('update-last-sync', {}, () => updateCoreLastSync(this.env, corporationId))

		if (directorId) {
			await step.do('record-director-success', {}, () =>
				recordDirectorSuccess(this.env, corporationId, directorId)
			)
		}

		await step.do('replay-tax-projection-retry-intent', { timeout: '30 seconds' }, async () => {
			const replay = await replayTaxProjectionRetryIntent(this.env, corporationId)
			if (replay.replayed) {
				logger.info('[EveCorporationSyncWorkflow] Replay tax projection retry intent', {
					corporationId,
					workflowInstanceId,
					succeeded: replay.succeeded,
					retryCount: replay.retryCount,
					reason: replay.reason,
				})
			}
			return replay
		})

		if ((walletJournalSync || walletTransactionsSync) && directorId) {
			const taxProjectionDispatch = await dispatchTaxProjectionRefresh({
				deps: {
					trigger: async () => {
						await step.do(
							'trigger-tax-projection-refresh',
							{
								retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
								timeout: '1 minute',
							},
							() => triggerTaxProjectionRefresh(this.env, directorId, taxProjectionInput)
						)
					},
					clearRetryIntent: () =>
						step.do('clear-tax-projection-retry-intent', { timeout: '10 seconds' }, () =>
							clearTaxProjectionRetryIntent(this.env, corporationId)
						),
					recordRetryIntent: (errorMessage) =>
						step.do('record-tax-projection-retry-intent', { timeout: '30 seconds' }, () =>
							recordTaxProjectionRetryIntent(
								this.env,
								corporationId,
								directorId,
								taxProjectionInput,
								errorMessage
							)
						),
				},
			})

			if (taxProjectionDispatch.outcome === 'trigger_failed') {
				logger.error('[EveCorporationSyncWorkflow] Tax projection refresh trigger failed', {
					corporationId,
					workflowInstanceId,
					taxProjectionTriggerRunId,
					error: taxProjectionDispatch.errorMessage,
				})
			}
		} else {
			logger.info('[EveCorporationSyncWorkflow] Skipping tax projection trigger (no wallet rows)', {
				corporationId,
				workflowInstanceId,
				taxProjectionTriggerRunId,
				walletJournalFetched,
				walletTransactionsFetched,
				walletJournalPersistedNewRows,
				walletTransactionsPersistedNewRows,
			})
		}

		logger.info('[EveCorporationSyncWorkflow] Full sync completed successfully', {
			corporationId,
			trigger,
			director: director
				? {
						directorId,
						characterId: directorCharacterId,
						characterName: directorCharacterName,
					}
				: null,
			syncedDataTypes,
			stats,
		})

		const result: EveCorporationSyncResult = {
			success: true,
			corporationId,
			trigger,
			stats,
		}

		return result
	}

	private validateEnv(): void {
		if (!this.env.DATABASE_URL || this.env.DATABASE_URL.trim() === '') {
			throw new NonRetryableError('DATABASE_URL environment variable is missing or empty')
		}
		if (!this.env.EVE_TOKEN_STORE) {
			throw new NonRetryableError('EVE_TOKEN_STORE binding is missing')
		}
		if (!this.env.EVE_CORPORATION_DATA) {
			throw new NonRetryableError('EVE_CORPORATION_DATA binding is missing')
		}
		if (!this.env.CORPORATION_TAX) {
			throw new NonRetryableError('CORPORATION_TAX binding is missing')
		}
		if (!this.env.CORE) {
			throw new NonRetryableError('CORE service binding is missing')
		}
	}
}
