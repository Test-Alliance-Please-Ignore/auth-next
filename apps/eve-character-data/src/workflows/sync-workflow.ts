import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'

import { logger } from '@repo/hono-helpers'
import { createWorkflowInstanceUpdater } from '@repo/orchestrator'

import * as refreshHelpers from './helpers/refresh-public-info'
import * as refreshAuthenticatedData from './helpers/refresh-authenticated-data'
import * as refreshKillmails from './helpers/refresh-killmails'
import * as refreshWalletJournal from './helpers/refresh-wallet-journal'
import * as refreshMarketData from './helpers/refresh-market-data'
import * as refreshAssets from './helpers/refresh-assets'
import * as refreshContracts from './helpers/refresh-contracts'
import * as refreshFittings from './helpers/refresh-fittings'
import * as refreshMiningLedger from './helpers/refresh-mining-ledger'
import * as refreshOpenMarketOrders from './helpers/refresh-open-market-orders'

import type { EveCharacterSyncDataType } from '@repo/eve-character-data'
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
}

/**
 * EveCharacterSyncWorkflow
 *
 * Orchestrates the synchronization of character data from ESI.
 * Each workflow instance represents a single sync operation for one character.
 *
 * Data Types Synced:
 * 1. Public info (no auth required)
 * 2. Authenticated data (skills, attributes) - requires token
 * 3. Killmails - requires token
 * 4. Wallet journal - requires token
 * 5. Market transactions - requires token
 * 6. Market orders - requires token
 * 7. Assets - stub (to be implemented)
 * 8. Contracts - stub (to be implemented)
 * 9. Fittings - stub (to be implemented)
 * 10. Mining ledger - stub (to be implemented)
 * 11. Open market orders - stub (to be implemented)
 */
export class EveCharacterSyncWorkflow extends WorkflowEntrypoint<Env, EveCharacterSyncParams> {
	async run(event: WorkflowEvent<EveCharacterSyncParams>, step: WorkflowStep) {
		const { characterId, dataTypes, trigger } = event.payload
		const updater = createWorkflowInstanceUpdater(event.instanceId, this.env.DATABASE_URL)

		await updater.markRunning()

		try {
			const requestedTypes = dataTypes ? new Set<EveCharacterSyncDataType>(dataTypes) : null
			const shouldSync = (type: EveCharacterSyncDataType) =>
				!requestedTypes || requestedTypes.size === 0 || requestedTypes.has(type)

			logger.info('[EveCharacterSyncWorkflow] Starting character sync', {
				characterId,
				dataTypes: dataTypes || 'all',
				trigger,
				timestamp: event.timestamp,
			})

			// Step 1: Fetch & store public info
			let publicInfoResult: refreshHelpers.RefreshPublicInfoResult | null = null
			if (shouldSync('public-info')) {
				publicInfoResult = await step.do(
					'fetch-public-info',
					{
						retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
						timeout: '1 minute',
					},
					async () => {
						logger.debug('[Step] Fetching public info', { characterId })
						return await refreshHelpers.refreshPublicInfo(this.env, characterId)
					}
				)
				logger.info('[Step] Public info fetched', {
					characterId,
					characterName: publicInfoResult.characterName,
				})
			} else {
				logger.debug('[Step] Skipping public info sync (filtered)', { characterId })
			}

			// Step 2: Fetch & store authenticated data
			let authenticatedDataResult: refreshAuthenticatedData.RefreshAuthenticatedDataResult | null =
				null
			if (shouldSync('authenticated')) {
				authenticatedDataResult = await step.do(
					'fetch-authenticated-data',
					{
						retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
						timeout: '1 minute',
					},
					async () => {
						logger.debug('[Step] Fetching authenticated data', { characterId })
						return await refreshAuthenticatedData.refreshAuthenticatedData(
							this.env,
							characterId
						)
					}
				)
				if (authenticatedDataResult.success) {
					logger.info('[Step] Authenticated data fetched', { characterId })
				} else {
					logger.info('[Step] Authenticated data skipped (no valid token)', { characterId })
				}
			} else {
				logger.debug('[Step] Skipping authenticated data sync (filtered)', { characterId })
			}

			// Step 3: Fetch & store killmails
			let killmailsResult: refreshKillmails.RefreshKillmailsResult | null = null
			if (shouldSync('killmails')) {
				killmailsResult = await step.do(
					'fetch-killmails',
					{
						retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
						timeout: '1 minute',
					},
					async () => {
						logger.debug('[Step] Fetching killmails', { characterId })
						return await refreshKillmails.refreshKillmails(this.env, characterId)
					}
				)
				if (killmailsResult.success) {
					logger.info('[Step] Killmails fetched', {
						characterId,
						killmailCount: killmailsResult.killmailCount,
					})
				} else {
					logger.info('[Step] Killmails skipped (no valid token)', { characterId })
				}
			} else {
				logger.debug('[Step] Skipping killmails sync (filtered)', { characterId })
			}

			// Step 4: Fetch & store wallet journal
			let walletJournalResult: refreshWalletJournal.RefreshWalletJournalResult | null = null
			if (shouldSync('wallet-journal')) {
				walletJournalResult = await step.do(
					'fetch-wallet-journal',
					{
						retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
						timeout: '1 minute',
					},
					async () => {
						logger.debug('[Step] Fetching wallet journal', { characterId })
						return await refreshWalletJournal.refreshWalletJournal(this.env, characterId)
					}
				)
				if (walletJournalResult.success) {
					logger.info('[Step] Wallet journal fetched', {
						characterId,
						entryCount: walletJournalResult.entryCount,
					})
				} else {
					logger.info('[Step] Wallet journal skipped (no valid token)', { characterId })
				}
			} else {
				logger.debug('[Step] Skipping wallet journal sync (filtered)', { characterId })
			}

			// Step 5: Fetch & store market data (transactions and orders)
			let marketDataResult: refreshMarketData.RefreshMarketDataResult | null = null
			if (shouldSync('market-transactions') || shouldSync('market-orders')) {
				marketDataResult = await step.do(
					'fetch-market-data',
					{
						retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
						timeout: '1 minute',
					},
					async () => {
						logger.debug('[Step] Fetching market data', { characterId })
						return await refreshMarketData.refreshMarketData(this.env, characterId)
					}
				)
				if (marketDataResult.success) {
					logger.info('[Step] Market data fetched', {
						characterId,
						transactionCount: marketDataResult.transactionCount,
						orderCount: marketDataResult.orderCount,
					})
				} else {
					logger.info('[Step] Market data skipped (no valid token)', { characterId })
				}
			} else {
				logger.debug('[Step] Skipping market data sync (filtered)', { characterId })
			}

			// Step 6: Fetch & store assets (stub)
			if (shouldSync('assets')) {
				await step.do(
					'fetch-assets',
					{
						retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
						timeout: '30 seconds',
					},
					async () => {
						logger.debug('[Step] Fetching assets (stub)', { characterId })
						return await refreshAssets.refreshAssets(this.env, characterId)
					}
				)
			} else {
				logger.debug('[Step] Skipping assets sync (filtered)', { characterId })
			}

			// Step 7: Fetch & store contracts (stub)
			if (shouldSync('contracts')) {
				await step.do(
					'fetch-contracts',
					{
						retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
						timeout: '30 seconds',
					},
					async () => {
						logger.debug('[Step] Fetching contracts (stub)', { characterId })
						return await refreshContracts.refreshContracts(this.env, characterId)
					}
				)
			} else {
				logger.debug('[Step] Skipping contracts sync (filtered)', { characterId })
			}

			// Step 8: Fetch & store fittings (stub)
			if (shouldSync('fittings')) {
				await step.do(
					'fetch-fittings',
					{
						retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
						timeout: '30 seconds',
					},
					async () => {
						logger.debug('[Step] Fetching fittings (stub)', { characterId })
						return await refreshFittings.refreshFittings(this.env, characterId)
					}
				)
			} else {
				logger.debug('[Step] Skipping fittings sync (filtered)', { characterId })
			}

			// Step 9: Fetch & store mining ledger (stub)
			if (shouldSync('mining-ledger')) {
				await step.do(
					'fetch-mining-ledger',
					{
						retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
						timeout: '30 seconds',
					},
					async () => {
						logger.debug('[Step] Fetching mining ledger (stub)', { characterId })
						return await refreshMiningLedger.refreshMiningLedger(this.env, characterId)
					}
				)
			} else {
				logger.debug('[Step] Skipping mining ledger sync (filtered)', { characterId })
			}

			// Step 10: Fetch & store open market orders (stub)
			if (shouldSync('open-market-orders')) {
				await step.do(
					'fetch-open-market-orders',
					{
						retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
						timeout: '30 seconds',
					},
					async () => {
						logger.debug('[Step] Fetching open market orders (stub)', { characterId })
						return await refreshOpenMarketOrders.refreshOpenMarketOrders(
							this.env,
							characterId
						)
					}
				)
			} else {
				logger.debug('[Step] Skipping open market orders sync (filtered)', { characterId })
			}

			logger.info('[EveCharacterSyncWorkflow] Character sync completed successfully', {
				characterId,
				trigger,
				stats: {
					characterName: publicInfoResult?.characterName,
					hasAuthenticatedData: authenticatedDataResult?.success,
					killmailCount: killmailsResult?.killmailCount,
					walletJournalEntries: walletJournalResult?.entryCount,
					marketTransactions: marketDataResult?.transactionCount,
					marketOrders: marketDataResult?.orderCount,
				},
			})

			const result = {
				success: true,
				characterId,
				trigger,
				stats: {
					characterName: publicInfoResult?.characterName,
					hasAuthenticatedData: authenticatedDataResult?.success,
					killmailCount: killmailsResult?.killmailCount,
					walletJournalEntries: walletJournalResult?.entryCount,
					marketTransactions: marketDataResult?.transactionCount,
					marketOrders: marketDataResult?.orderCount,
				},
			}

			await updater.markCompleted()

			return result
		} catch (error) {
			logger.error('[EveCharacterSyncWorkflow] Character sync failed with error', {
				characterId,
				trigger,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				errorType: error?.constructor?.name,
			})

			await updater.markFailed(error)
			throw error
		}
	}
}

