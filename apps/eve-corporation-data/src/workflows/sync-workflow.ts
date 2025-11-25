import { WorkflowEntrypoint } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { DirectorManager } from '../services/director-manager'
import * as esiFetch from '../services/esi-fetch'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { EveCorporationData, EveCorporationSyncDataType } from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../context'

/**
 * Workflow parameters for corporation data synchronization
 */
export interface EveCorporationSyncParams {
	/** Corporation ID to sync */
	corporationId: string
	/** Optional: specific data types to sync (defaults to all) */
	dataTypes?: EveCorporationSyncDataType[]
	/** Trigger source (cron or api) */
	trigger: 'cron' | 'api'
}

/**
 * Director info returned from selection step (JSON-serializable)
 */
interface DirectorInfo {
	directorId: string
	characterId: string
	characterName: string
}

/**
 * EveCorporationSyncWorkflow
 *
 * Orchestrates the synchronization of all 12 corporation data types from ESI.
 * Each workflow instance represents a single sync operation for one corporation.
 *
 * IMPORTANT: Cloudflare Workflows hibernate between steps, discarding all in-memory state.
 * All state must be returned from step.do() callbacks and passed to subsequent steps.
 * Services (db, tokenStore, DirectorManager) must be recreated inside each step.
 *
 * Data Types Synced:
 * 1. Public info (no auth required)
 * 2. Members
 * 3. Member tracking
 * 4. Wallets
 * 5. Wallet journal (all 7 divisions)
 * 6. Wallet transactions (all 7 divisions)
 * 7. Assets
 * 8. Structures
 * 9. Market orders
 * 10. Contracts
 * 11. Industry jobs
 * 12. Killmails
 */
export class EveCorporationSyncWorkflow extends WorkflowEntrypoint<Env, EveCorporationSyncParams> {
	/**
	 * Create services needed for workflow steps.
	 * MUST be called inside each step.do() callback since services don't survive hibernation.
	 */
	private createServices(corporationId: string) {
		const db = createDb(this.env.DATABASE_URL)
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(db, corporationId, tokenStore)
		return { db, tokenStore, directorManager }
	}

	async run(event: WorkflowEvent<EveCorporationSyncParams>, step: WorkflowStep) {
		const { corporationId, dataTypes, trigger } = event.payload

		logger.info('[EveCorporationSyncWorkflow] Starting sync', {
			corporationId,
			dataTypes: dataTypes || 'all',
			trigger,
			timestamp: event.timestamp,
		})

		// Validate environment - use NonRetryableError for permanent failures
		if (!this.env.DATABASE_URL || this.env.DATABASE_URL.trim() === '') {
			throw new NonRetryableError('DATABASE_URL environment variable is missing or empty')
		}
		if (!this.env.EVE_TOKEN_STORE) {
			throw new NonRetryableError('EVE_TOKEN_STORE binding is missing')
		}
		if (!this.env.EVE_CORPORATION_DATA) {
			throw new NonRetryableError('EVE_CORPORATION_DATA binding is missing')
		}
		if (!this.env.CORE) {
			throw new NonRetryableError('CORE service binding is missing')
		}

		// Helper to check if a data type should be synced
		const requestedTypes = dataTypes ? new Set<EveCorporationSyncDataType>(dataTypes) : null
		const shouldSync = (type: EveCorporationSyncDataType) =>
			!requestedTypes || requestedTypes.size === 0 || requestedTypes.has(type)

		// Track synced data types as array (JSON-serializable, unlike Set)
		let syncedDataTypes: EveCorporationSyncDataType[] = []

		// Step 1: Select a healthy director
		// Director info is returned and persisted as step output
		const director: DirectorInfo = await step.do(
			'select-director',
			{
				retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
				timeout: '30 seconds',
			},
			async () => {
				logger.debug('[Step] Selecting healthy director', { corporationId })
				const { directorManager } = this.createServices(corporationId)

				const selected = await directorManager.selectDirector()

				if (!selected) {
					throw new Error('No healthy directors available for corporation')
				}

				logger.info('[Step] Director selected', {
					corporationId,
					characterId: selected.characterId,
					characterName: selected.characterName,
				})

				return selected
			}
		)

		// Director info is now available as step output (survives hibernation)
		const { directorId, characterId: directorCharacterId, characterName: directorCharacterName } = director

		// Step 2: Fetch & store public info
		let publicInfo: Awaited<ReturnType<typeof esiFetch.fetchPublicInfo>> | null = null
		if (shouldSync('public-info')) {
			publicInfo = await step.do(
				'fetch-public-info',
				{
					retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
					timeout: '1 minute',
				},
				async () => {
					logger.debug('[Step] Fetching public info', { corporationId })
					const { tokenStore } = this.createServices(corporationId)
					const info = await esiFetch.fetchPublicInfo(tokenStore, corporationId)
					logger.info('[Step] Public info fetched', {
						corporationId,
						name: info.name,
						ticker: info.ticker,
					})
					return info
				}
			)

			syncedDataTypes = await step.do('store-public-info', {}, async () => {
				const corpDataDO = getStub<EveCorporationData>(
					this.env.EVE_CORPORATION_DATA,
					corporationId
				)
				await corpDataDO.storePublicInfo(corporationId, publicInfo!)

				logger.debug('[Step] Public info stored', { corporationId })
				// Return updated array (state must be returned from steps)
				return [...syncedDataTypes, 'public-info'] as EveCorporationSyncDataType[]
			})
		} else {
			logger.debug('[Step] Skipping public info sync (filtered)', { corporationId })
		}

		// Step 3: Fetch & store members
		let memberResult: {
			stored: number
			departed: number
			departedMemberIds: string[]
			syncedDataTypes: EveCorporationSyncDataType[]
		} | null = null
		if (shouldSync('members')) {
			memberResult = await step.do(
				'fetch-store-members',
				{
					retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
					timeout: '1 minute',
				},
				async () => {
					const { tokenStore } = this.createServices(corporationId)
					const corpDataDO = getStub<EveCorporationData>(
						this.env.EVE_CORPORATION_DATA,
						corporationId
					)

					const memberIds = await esiFetch.fetchMembers(
						tokenStore,
						corporationId,
						directorCharacterId
					)
					logger.debug('[Step] Members fetched', { corporationId, count: memberIds.length })

					const result = await corpDataDO.storeMembers(corporationId, memberIds)

					logger.info('[Step] Members stored', {
						corporationId,
						stored: memberIds.length,
						departed: result.departedMemberIds.length,
					})

					return {
						stored: memberIds.length,
						departed: result.departedMemberIds.length,
						departedMemberIds: result.departedMemberIds,
						// Return updated syncedDataTypes
						syncedDataTypes: [...syncedDataTypes, 'members'] as EveCorporationSyncDataType[],
					}
				}
			)
			// Update syncedDataTypes from step result
			syncedDataTypes = memberResult.syncedDataTypes
		} else {
			logger.debug('[Step] Skipping members sync (filtered)', { corporationId })
		}

		// Step 4: Send HR cleanup messages for departed members
		if (shouldSync('members') && memberResult && memberResult.departedMemberIds.length > 0) {
			await step.do('send-hr-messages', {}, async () => {
				const hrQueue = this.env['hr-member-departed']
				const messages = memberResult.departedMemberIds.map((characterId: string) => ({
					body: { corporationId, characterId },
				}))
				await hrQueue.sendBatch(messages)
				logger.info('[Step] HR messages sent', { count: messages.length })
			})
		}

		// Step 5: Fetch & store member tracking
		if (shouldSync('member-tracking')) {
			syncedDataTypes = await step.do(
				'fetch-store-member-tracking',
				{
					retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
					timeout: '1 minute',
				},
				async () => {
					const { tokenStore } = this.createServices(corporationId)
					const corpDataDO = getStub<EveCorporationData>(
						this.env.EVE_CORPORATION_DATA,
						corporationId
					)

					const data = await esiFetch.fetchMemberTracking(
						tokenStore,
						corporationId,
						directorCharacterId
					)
					logger.debug('[Step] Member tracking fetched', { corporationId, count: data.length })

					await corpDataDO.storeMemberTracking(corporationId, data)

					logger.info('[Step] Member tracking stored', { corporationId, count: data.length })

					return [...syncedDataTypes, 'member-tracking'] as EveCorporationSyncDataType[]
				}
			)
		} else {
			logger.debug('[Step] Skipping member tracking sync (filtered)', { corporationId })
		}

		// Step 6: Fetch & store wallets
		let wallets: Awaited<ReturnType<typeof esiFetch.fetchWallets>> | null = null
		if (shouldSync('wallets')) {
			wallets = await step.do(
				'fetch-wallets',
				{
					retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
					timeout: '1 minute',
				},
				async () => {
					const { tokenStore } = this.createServices(corporationId)
					const data = await esiFetch.fetchWallets(
						tokenStore,
						corporationId,
						directorCharacterId
					)
					logger.debug('[Step] Wallets fetched', { corporationId, count: data.length })
					return data
				}
			)

			syncedDataTypes = await step.do('store-wallets', {}, async () => {
				const corpDataDO = getStub<EveCorporationData>(
					this.env.EVE_CORPORATION_DATA,
					corporationId
				)
				await corpDataDO.storeWallets(corporationId, wallets!)

				logger.debug('[Step] Wallets stored', { corporationId, count: wallets!.length })
				return [...syncedDataTypes, 'wallets'] as EveCorporationSyncDataType[]
			})
		} else {
			logger.debug('[Step] Skipping wallets sync (filtered)', { corporationId })
		}

		// Step 7: Fetch & store wallet journal (all 7 divisions in parallel)
		if (shouldSync('wallet-journal')) {
			syncedDataTypes = await step.do(
				'fetch-store-wallet-journal',
				{
					retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
					timeout: '5 minutes',
				},
				async () => {
					const { tokenStore } = this.createServices(corporationId)
					const corpDataDO = getStub<EveCorporationData>(
						this.env.EVE_CORPORATION_DATA,
						corporationId
					)

					const divisions = [1, 2, 3, 4, 5, 6, 7]
					const results = await Promise.allSettled(
						divisions.map(async (division) => {
							const entries = await esiFetch.fetchWalletJournal(
								tokenStore,
								corporationId,
								division,
								directorCharacterId
							)
							await corpDataDO.storeWalletJournal(corporationId, division, entries)
							return { division, count: entries.length }
						})
					)

					const divisionResults = results
						.filter((r) => r.status === 'fulfilled')
						.map((r) => r.value)
					const totalEntries = divisionResults.reduce((sum, r) => sum + (r?.count || 0), 0)

					// Log any division failures
					const failures = results.filter((r) => r.status === 'rejected')
					if (failures.length > 0) {
						failures.forEach((failure) => {
							logger.error('[Step] Wallet journal division failed', {
								corporationId,
								division: divisions[results.indexOf(failure)],
								error:
									failure.reason instanceof Error
										? failure.reason.message
										: String(failure.reason),
							})
						})
					}

					logger.info('[Step] Wallet journal stored', {
						corporationId,
						divisionsProcessed: divisionResults.length,
						totalEntries,
					})

					return [...syncedDataTypes, 'wallet-journal'] as EveCorporationSyncDataType[]
				}
			)
		} else {
			logger.debug('[Step] Skipping wallet journal sync (filtered)', { corporationId })
		}

		// Step 8: Fetch & store wallet transactions (all 7 divisions in parallel)
		if (shouldSync('wallet-transactions')) {
			syncedDataTypes = await step.do(
				'fetch-store-wallet-transactions',
				{
					retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
					timeout: '5 minutes',
				},
				async () => {
					const { tokenStore } = this.createServices(corporationId)
					const corpDataDO = getStub<EveCorporationData>(
						this.env.EVE_CORPORATION_DATA,
						corporationId
					)

					const divisions = [1, 2, 3, 4, 5, 6, 7]
					const results = await Promise.allSettled(
						divisions.map(async (division) => {
							const txs = await esiFetch.fetchWalletTransactions(
								tokenStore,
								corporationId,
								division,
								directorCharacterId
							)
							await corpDataDO.storeWalletTransactions(corporationId, division, txs)
							return { division, count: txs.length }
						})
					)

					const divisionResults = results
						.filter((r) => r.status === 'fulfilled')
						.map((r) => r.value)
					const totalTransactions = divisionResults.reduce((sum, r) => sum + (r?.count || 0), 0)

					// Log any division failures
					const failures = results.filter((r) => r.status === 'rejected')
					if (failures.length > 0) {
						failures.forEach((failure) => {
							logger.error('[Step] Wallet transactions division failed', {
								corporationId,
								division: divisions[results.indexOf(failure)],
								error:
									failure.reason instanceof Error
										? failure.reason.message
										: String(failure.reason),
							})
						})
					}

					logger.info('[Step] Wallet transactions stored', {
						corporationId,
						divisionsProcessed: divisionResults.length,
						totalTransactions,
					})

					return [...syncedDataTypes, 'wallet-transactions'] as EveCorporationSyncDataType[]
				}
			)
		} else {
			logger.debug('[Step] Skipping wallet transactions sync (filtered)', { corporationId })
		}

		// Step 9: Fetch & store assets
		let assetsResult: { stored: number } | null = null
		if (shouldSync('assets')) {
			const result = await step.do(
				'fetch-store-assets',
				{
					retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
					timeout: '2 minutes',
				},
				async () => {
					const { tokenStore } = this.createServices(corporationId)
					const corpDataDO = getStub<EveCorporationData>(
						this.env.EVE_CORPORATION_DATA,
						corporationId
					)

					const data = await esiFetch.fetchAssets(
						tokenStore,
						corporationId,
						directorCharacterId
					)
					logger.debug('[Step] Assets fetched', { corporationId, count: data.length })

					await corpDataDO.storeAssets(corporationId, data)

					logger.info('[Step] Assets stored', { corporationId, count: data.length })

					return {
						stored: data.length,
						syncedDataTypes: [...syncedDataTypes, 'assets'] as EveCorporationSyncDataType[],
					}
				}
			)
			assetsResult = { stored: result.stored }
			syncedDataTypes = result.syncedDataTypes
		} else {
			logger.debug('[Step] Skipping assets sync (filtered)', { corporationId })
		}

		// Step 10: Fetch & store structures
		let structuresResult: { stored: number } | null = null
		if (shouldSync('structures')) {
			const result = await step.do(
				'fetch-store-structures',
				{
					retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
					timeout: '1 minute',
				},
				async () => {
					const { tokenStore } = this.createServices(corporationId)
					const corpDataDO = getStub<EveCorporationData>(
						this.env.EVE_CORPORATION_DATA,
						corporationId
					)

					const data = await esiFetch.fetchStructures(
						tokenStore,
						corporationId,
						directorCharacterId
					)
					logger.debug('[Step] Structures fetched', { corporationId, count: data.length })

					await corpDataDO.storeStructures(corporationId, data)
					logger.info('[Step] Structures stored', { corporationId, count: data.length })

					return {
						stored: data.length,
						syncedDataTypes: [...syncedDataTypes, 'structures'] as EveCorporationSyncDataType[],
					}
				}
			)
			structuresResult = { stored: result.stored }
			syncedDataTypes = result.syncedDataTypes
		} else {
			logger.debug('[Step] Skipping structures sync (filtered)', { corporationId })
		}

		// Step 11: Fetch & store market orders
		let ordersResult: { stored: number } | null = null
		if (shouldSync('orders')) {
			const result = await step.do(
				'fetch-store-orders',
				{
					retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
					timeout: '1 minute',
				},
				async () => {
					const { tokenStore } = this.createServices(corporationId)
					const corpDataDO = getStub<EveCorporationData>(
						this.env.EVE_CORPORATION_DATA,
						corporationId
					)

					const data = await esiFetch.fetchOrders(
						tokenStore,
						corporationId,
						directorCharacterId
					)
					logger.debug('[Step] Orders fetched', { corporationId, count: data.length })

					await corpDataDO.storeOrders(corporationId, data)

					logger.info('[Step] Orders stored', { corporationId, count: data.length })

					return {
						stored: data.length,
						syncedDataTypes: [...syncedDataTypes, 'orders'] as EveCorporationSyncDataType[],
					}
				}
			)
			ordersResult = { stored: result.stored }
			syncedDataTypes = result.syncedDataTypes
		} else {
			logger.debug('[Step] Skipping orders sync (filtered)', { corporationId })
		}

		// Step 12: Fetch & store contracts
		let contractsResult: { stored: number } | null = null
		if (shouldSync('contracts')) {
			const result = await step.do(
				'fetch-store-contracts',
				{
					retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
					timeout: '1 minute',
				},
				async () => {
					const { tokenStore } = this.createServices(corporationId)
					const corpDataDO = getStub<EveCorporationData>(
						this.env.EVE_CORPORATION_DATA,
						corporationId
					)

					const data = await esiFetch.fetchContracts(
						tokenStore,
						corporationId,
						directorCharacterId
					)
					logger.debug('[Step] Contracts fetched', { corporationId, count: data.length })

					await corpDataDO.storeContracts(corporationId, data)

					logger.info('[Step] Contracts stored', { corporationId, count: data.length })

					return {
						stored: data.length,
						syncedDataTypes: [...syncedDataTypes, 'contracts'] as EveCorporationSyncDataType[],
					}
				}
			)
			contractsResult = { stored: result.stored }
			syncedDataTypes = result.syncedDataTypes
		} else {
			logger.debug('[Step] Skipping contracts sync (filtered)', { corporationId })
		}

		// Step 13: Fetch & store industry jobs
		let industryJobsResult: { stored: number } | null = null
		if (shouldSync('industry-jobs')) {
			const result = await step.do(
				'fetch-store-industry-jobs',
				{
					retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
					timeout: '1 minute',
				},
				async () => {
					const { tokenStore } = this.createServices(corporationId)
					const corpDataDO = getStub<EveCorporationData>(
						this.env.EVE_CORPORATION_DATA,
						corporationId
					)

					const data = await esiFetch.fetchIndustryJobs(
						tokenStore,
						corporationId,
						directorCharacterId
					)
					logger.debug('[Step] Industry jobs fetched', { corporationId, count: data.length })

					await corpDataDO.storeIndustryJobs(corporationId, data)

					logger.info('[Step] Industry jobs stored', { corporationId, count: data.length })

					return {
						stored: data.length,
						syncedDataTypes: [...syncedDataTypes, 'industry-jobs'] as EveCorporationSyncDataType[],
					}
				}
			)
			industryJobsResult = { stored: result.stored }
			syncedDataTypes = result.syncedDataTypes
		} else {
			logger.debug('[Step] Skipping industry jobs sync (filtered)', { corporationId })
		}

		// Step 14: Fetch & store killmails
		let killmailsResult: { stored: number } | null = null
		if (shouldSync('killmails')) {
			const result = await step.do(
				'fetch-store-killmails',
				{
					retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
					timeout: '1 minute',
				},
				async () => {
					const { tokenStore } = this.createServices(corporationId)
					const corpDataDO = getStub<EveCorporationData>(
						this.env.EVE_CORPORATION_DATA,
						corporationId
					)

					const data = await esiFetch.fetchKillmails(
						tokenStore,
						corporationId,
						directorCharacterId
					)
					logger.debug('[Step] Killmails fetched', { corporationId, count: data.length })

					await corpDataDO.storeKillmails(corporationId, data)

					logger.info('[Step] Killmails stored', { corporationId, count: data.length })

					return {
						stored: data.length,
						syncedDataTypes: [...syncedDataTypes, 'killmails'] as EveCorporationSyncDataType[],
					}
				}
			)
			killmailsResult = { stored: result.stored }
			syncedDataTypes = result.syncedDataTypes
		} else {
			logger.debug('[Step] Skipping killmails sync (filtered)', { corporationId })
		}

		// Step 15: Update all sync timestamps for successfully synced data types
		await step.do('update-sync-timestamps', {}, async () => {
			// Map data types to their sync property names
			const syncPropertyMap: Partial<Record<EveCorporationSyncDataType, string>> = {
				members: 'membersLastSync',
				'member-tracking': 'memberTrackingLastSync',
				wallets: 'walletsLastSync',
				'wallet-journal': 'walletJournalLastSync',
				'wallet-transactions': 'walletTransactionsLastSync',
				assets: 'assetsLastSync',
				structures: 'structuresLastSync',
				orders: 'ordersLastSync',
				contracts: 'contractsLastSync',
				'industry-jobs': 'industryJobsLastSync',
				killmails: 'killmailsLastSync',
				// Note: public-info doesn't have a sync timestamp field
			}

			// Collect sync properties for all successfully synced data types (excluding public-info)
			const syncProperties = syncedDataTypes
				.filter((type) => type !== 'public-info' && syncPropertyMap[type])
				.map((dataType) => syncPropertyMap[dataType]!)
				.filter(Boolean)

			if (syncProperties.length > 0) {
				const syncTimestampDO = getStub<EveCorporationData>(
					this.env.EVE_CORPORATION_DATA,
					'default'
				)

				// Batch update all sync timestamps in a single database operation
				await syncTimestampDO.batchUpdateCorporationSyncTimestamps(corporationId, syncProperties)

				logger.info('[Step] Sync timestamps updated', {
					corporationId,
					syncedDataTypes,
					syncProperties,
					count: syncProperties.length,
				})
			} else {
				logger.debug('[Step] No sync timestamps to update', {
					corporationId,
					syncedDataTypes,
				})
			}
		})

		// Step 16: Update last sync timestamp in core service
		await step.do('update-last-sync', {}, async () => {
			await this.env.CORE.updateCorporationLastSync(corporationId)
			logger.info('[Step] Last sync timestamp updated', { corporationId })
		})

		// Step 17: Record director success
		// Note: Must recreate services inside step since they don't survive hibernation
		await step.do('record-director-success', {}, async () => {
			const { directorManager } = this.createServices(corporationId)
			await directorManager.recordSuccess(directorId)
			logger.info('[Step] Director success recorded', {
				corporationId,
				directorId,
				directorCharacterId,
			})
		})

		logger.info('[EveCorporationSyncWorkflow] Full sync completed successfully', {
			corporationId,
			trigger,
			director: {
				directorId,
				characterId: directorCharacterId,
				characterName: directorCharacterName,
			},
			stats: {
				corporationName: publicInfo?.name,
				totalMembers: memberResult?.stored,
				departedMembers: memberResult?.departedMemberIds.length,
				walletsCount: wallets?.length,
				assetsCount: assetsResult?.stored,
				structuresCount: structuresResult?.stored,
				ordersCount: ordersResult?.stored,
				contractsCount: contractsResult?.stored,
				industryJobsCount: industryJobsResult?.stored,
				killmailsCount: killmailsResult?.stored,
			},
		})

		return {
			success: true,
			corporationId,
			trigger,
			stats: {
				corporationName: publicInfo?.name,
				totalMembers: memberResult?.stored,
				departedMembers: memberResult?.departedMemberIds.length,
				walletsCount: wallets?.length,
				assetsCount: assetsResult?.stored,
				structuresCount: structuresResult?.stored,
				ordersCount: ordersResult?.stored,
				contractsCount: contractsResult?.stored,
				industryJobsCount: industryJobsResult?.stored,
				killmailsCount: killmailsResult?.stored,
			},
		}
	}
}
