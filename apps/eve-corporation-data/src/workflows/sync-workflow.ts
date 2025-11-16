import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'

import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'
import { createWorkflowInstanceUpdater } from '@repo/orchestrator'

import { createDb } from '../db'
import { corporationConfig } from '../db/schema'
import { DirectorManager } from '../services/director-manager'
import * as esiFetch from '../services/esi-fetch'

import type { EveCorporationData, EveCorporationSyncDataType } from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../context'
import type { SelectedDirector } from '../services/director-manager'

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

type CorporationSyncProperty =
	| 'memberTrackingLastSync'
	| 'membersLastSync'
	| 'walletsLastSync'
	| 'walletJournalLastSync'
	| 'walletTransactionsLastSync'
	| 'assetsLastSync'
	| 'structuresLastSync'
	| 'ordersLastSync'
	| 'contractsLastSync'
	| 'industryJobsLastSync'
	| 'killmailsLastSync'

type CorporationConfigUpdate = Partial<typeof corporationConfig.$inferInsert>

async function updateLastSync(
	env: Env,
	corporationId: string,
	syncProperty: CorporationSyncProperty
): Promise<void> {
	logger.debug('[updateLastSync] Starting update', { corporationId, syncProperty })

	try {
		// Validate DATABASE_URL before creating database client
		if (!env.DATABASE_URL || typeof env.DATABASE_URL !== 'string' || env.DATABASE_URL.trim() === '') {
			throw new Error('DATABASE_URL environment variable is missing or empty')
		}

		let db: ReturnType<typeof createDb>
		try {
			db = createDb(env.DATABASE_URL)
		} catch (error) {
			throw new Error(`Failed to create database client: ${error instanceof Error ? error.message : String(error)}`)
		}

		const timestamp = new Date()

		logger.debug('[updateLastSync] Executing database update', {
			corporationId,
			syncProperty,
			timestamp: timestamp.toISOString(),
		})

		const result = await db
			.update(corporationConfig)
			.set({
				[syncProperty]: timestamp,
			} satisfies CorporationConfigUpdate)
			.where(eq(corporationConfig.corporationId, corporationId))

		logger.debug('[updateLastSync] Database update completed', {
			corporationId,
			syncProperty,
			result,
		})
	} catch (error) {
		logger.error('[updateLastSync] Database update failed', {
			corporationId,
			syncProperty,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		throw error
	}
}

/**
 * EveCorporationSyncWorkflow
 *
 * Orchestrates the synchronization of all 12 corporation data types from ESI.
 * Each workflow instance represents a single sync operation for one corporation.
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
	async run(event: WorkflowEvent<EveCorporationSyncParams>, step: WorkflowStep) {
		const { corporationId, dataTypes, trigger } = event.payload

		// Validate environment variables and bindings before any operations
		if (!this.env.DATABASE_URL || typeof this.env.DATABASE_URL !== 'string' || this.env.DATABASE_URL.trim() === '') {
			const error = new Error('DATABASE_URL environment variable is missing or empty')
			logger.error('[EveCorporationSyncWorkflow] Environment validation failed', {
				corporationId,
				trigger,
				error: error.message,
			})
			throw error
		}

		if (!this.env.EVE_TOKEN_STORE) {
			const error = new Error('EVE_TOKEN_STORE binding is missing')
			logger.error('[EveCorporationSyncWorkflow] Environment validation failed', {
				corporationId,
				trigger,
				error: error.message,
			})
			throw error
		}

		if (!this.env.EVE_CORPORATION_DATA) {
			const error = new Error('EVE_CORPORATION_DATA binding is missing')
			logger.error('[EveCorporationSyncWorkflow] Environment validation failed', {
				corporationId,
				trigger,
				error: error.message,
			})
			throw error
		}

		if (!this.env.CORE) {
			const error = new Error('CORE service binding is missing')
			logger.error('[EveCorporationSyncWorkflow] Environment validation failed', {
				corporationId,
				trigger,
				error: error.message,
			})
			throw error
		}

		// Initialize workflow instance updater with error handling (non-blocking)
		// This is for observability only - failures should not stop the workflow
		let updater: ReturnType<typeof createWorkflowInstanceUpdater> | null = null
		try {
			updater = createWorkflowInstanceUpdater(event.instanceId, this.env.DATABASE_URL)
			try {
				await updater.markRunning()
			} catch (error) {
				// Log but don't throw - workflow instance updater is for tracking only
				logger.warn('[EveCorporationSyncWorkflow] Failed to mark workflow as running (non-blocking)', {
					corporationId,
					trigger,
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				})
			}
		} catch (error) {
			// Log but don't throw - workflow instance updater is for tracking only
			logger.warn('[EveCorporationSyncWorkflow] Failed to create workflow instance updater (non-blocking)', {
				corporationId,
				trigger,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
			// Continue without updater - it's just for observability
		}

		let directorManager: DirectorManager | null = null
		let director: SelectedDirector | null = null
		let directorId: string | null = null
		let directorCharacterId: string | null = null
		let directorCharacterName: string | null = null

		try {
			const requestedTypes = dataTypes ? new Set<EveCorporationSyncDataType>(dataTypes) : null
			const shouldSync = (type: EveCorporationSyncDataType) =>
				!requestedTypes || requestedTypes.size === 0 || requestedTypes.has(type)

			// Initialize database client with error handling
			let db: ReturnType<typeof createDb>
			try {
				db = createDb(this.env.DATABASE_URL)
			} catch (error) {
				const errorMessage = `Failed to create database client: ${error instanceof Error ? error.message : String(error)}`
				logger.error('[EveCorporationSyncWorkflow] Database initialization failed', {
					corporationId,
					trigger,
					error: errorMessage,
					stack: error instanceof Error ? error.stack : undefined,
				})
				throw new Error(errorMessage)
			}

			using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
			directorManager = new DirectorManager(db, corporationId, tokenStore)

			logger.info('[EveCorporationSyncWorkflow] Starting full sync', {
				corporationId,
				dataTypes: dataTypes || 'all',
				trigger,
				timestamp: event.timestamp,
			})

			// Step 1: Select a healthy director
			director = await step.do(
				'select-director',
				{
					retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
					timeout: '30 seconds',
				},
				async () => {
					logger.debug('[Step] Selecting healthy director', { corporationId })
					if (!directorManager) {
						throw new Error('DirectorManager not initialized')
					}

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
			if (!director) {
				throw new Error('Director selection failed to return a director')
			}
			directorId = director.directorId
			directorCharacterId = director.characterId
			directorCharacterName = director.characterName
			const activeDirectorId = directorId!
			const activeDirectorCharacterId = directorCharacterId!
			const activeDirectorCharacterName = directorCharacterName!

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
						const info = await esiFetch.fetchPublicInfo(tokenStore, corporationId)
						logger.info('[Step] Public info fetched', {
							corporationId,
							name: info.name,
							ticker: info.ticker,
						})
						return info
					}
				)

				await step.do('store-public-info', {}, async () => {
					using corpDataDO = getStub<EveCorporationData>(
						this.env.EVE_CORPORATION_DATA,
						corporationId
					)
					await corpDataDO.storePublicInfo(corporationId, publicInfo!)

					return {
						stored: true,
						corporationName: publicInfo!.name,
						ticker: publicInfo!.ticker,
						memberCount: publicInfo!.memberCount,
					}
				})
			} else {
				logger.debug('[Step] Skipping public info sync (filtered)', { corporationId })
			}

			// Step 3: Fetch & store members
			let memberResult: {
				stored: number
				departed: number
				departedMemberIds: string[]
			} | null = null
			if (shouldSync('members')) {
				memberResult = await step.do(
					'fetch-store-members',
					{
						retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
						timeout: '1 minute',
					},
					async () => {
						using corpDataDO = getStub<EveCorporationData>(
							this.env.EVE_CORPORATION_DATA,
							corporationId
						)

						const memberIds = await esiFetch.fetchMembers(
							tokenStore,
							corporationId,
							activeDirectorCharacterId
						)
						logger.debug('[Step] Members fetched', { corporationId, count: memberIds.length })

						const result = await corpDataDO.storeMembers(corporationId, memberIds)

						logger.debug('[Step] Updating membersLastSync', { corporationId })
						try {
							await updateLastSync(this.env, corporationId, 'membersLastSync')
							logger.debug('[Step] membersLastSync updated successfully', { corporationId })
						} catch (error) {
							logger.error('[Step] Failed to update membersLastSync', {
								corporationId,
								error: error instanceof Error ? error.message : String(error),
								stack: error instanceof Error ? error.stack : undefined,
							})
							throw error
						}

						logger.info('[Step] Members stored', {
							corporationId,
							stored: memberIds.length,
							departed: result.departedMemberIds.length,
						})

						return {
							stored: memberIds.length,
							departed: result.departedMemberIds.length,
							departedMemberIds: result.departedMemberIds,
						}
					}
				)
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
				await step.do(
					'fetch-store-member-tracking',
					{
						retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
						timeout: '1 minute',
					},
					async () => {
						using corpDataDO = getStub<EveCorporationData>(
							this.env.EVE_CORPORATION_DATA,
							corporationId
						)

						const data = await esiFetch.fetchMemberTracking(
							tokenStore,
							corporationId,
							activeDirectorCharacterId
						)
						logger.debug('[Step] Member tracking fetched', { corporationId, count: data.length })

						await corpDataDO.storeMemberTracking(corporationId, data)

						logger.debug('[Step] Updating memberTrackingLastSync', { corporationId })
						try {
							await updateLastSync(this.env, corporationId, 'memberTrackingLastSync')
							logger.debug('[Step] memberTrackingLastSync updated successfully', { corporationId })
						} catch (error) {
							logger.error('[Step] Failed to update memberTrackingLastSync', {
								corporationId,
								error: error instanceof Error ? error.message : String(error),
								stack: error instanceof Error ? error.stack : undefined,
							})
							throw error
						}

						logger.info('[Step] Member tracking stored', { corporationId, count: data.length })

						return {
							stored: data.length,
						}
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
						const data = await esiFetch.fetchWallets(
							tokenStore,
							corporationId,
							activeDirectorCharacterId
						)
						logger.debug('[Step] Wallets fetched', { corporationId, count: data.length })
						return data
					}
				)

				await step.do('store-wallets', {}, async () => {
					using corpDataDO = getStub<EveCorporationData>(
						this.env.EVE_CORPORATION_DATA,
						corporationId
					)
					await corpDataDO.storeWallets(corporationId, wallets!)

					logger.debug('[Step] Updating walletsLastSync', { corporationId })
					try {
						await updateLastSync(this.env, corporationId, 'walletsLastSync')
						logger.debug('[Step] walletsLastSync updated successfully', { corporationId })
					} catch (error) {
						logger.error('[Step] Failed to update walletsLastSync', {
							corporationId,
							error: error instanceof Error ? error.message : String(error),
							stack: error instanceof Error ? error.stack : undefined,
						})
						throw error
					}

					return {
						divisions: wallets!.length,
						totalBalance: wallets!.reduce((sum, w) => sum + Number(w.balance), 0),
					}
				})
			} else {
				logger.debug('[Step] Skipping wallets sync (filtered)', { corporationId })
			}

			// Step 7: Fetch & store wallet journal (all 7 divisions in parallel)
			if (shouldSync('wallet-journal')) {
				await step.do(
					'fetch-store-wallet-journal',
					{
						retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
						timeout: '5 minutes',
					},
					async () => {
						using corpDataDO = getStub<EveCorporationData>(
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
									activeDirectorCharacterId
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
							failures.forEach((failure, index) => {
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

						await updateLastSync(this.env, corporationId, 'walletJournalLastSync')
						return {
							divisionsProcessed: divisionResults.length,
							divisionsFailed: failures.length,
							totalEntries,
							byDivision: divisionResults,
						}
					}
				)
			} else {
				logger.debug('[Step] Skipping wallet journal sync (filtered)', { corporationId })
			}

			// Step 8: Fetch & store wallet transactions (all 7 divisions in parallel)
			if (shouldSync('wallet-transactions')) {
				await step.do(
					'fetch-store-wallet-transactions',
					{
						retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
						timeout: '5 minutes',
					},
					async () => {
						using corpDataDO = getStub<EveCorporationData>(
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
									activeDirectorCharacterId
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
							failures.forEach((failure, index) => {
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

						await updateLastSync(this.env, corporationId, 'walletTransactionsLastSync')

						return {
							divisionsProcessed: divisionResults.length,
							divisionsFailed: failures.length,
							totalTransactions,
							byDivision: divisionResults,
						}
					}
				)
			} else {
				logger.debug('[Step] Skipping wallet transactions sync (filtered)', { corporationId })
			}

			// Step 9: Fetch & store assets
			let assetsResult: { stored: number } | null = null
			if (shouldSync('assets')) {
				assetsResult = await step.do(
					'fetch-store-assets',
					{
						retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
						timeout: '2 minutes',
					},
					async () => {
						using corpDataDO = getStub<EveCorporationData>(
							this.env.EVE_CORPORATION_DATA,
							corporationId
						)

						const data = await esiFetch.fetchAssets(
							tokenStore,
							corporationId,
							activeDirectorCharacterId
						)
						logger.debug('[Step] Assets fetched', { corporationId, count: data.length })

						await corpDataDO.storeAssets(corporationId, data)
						logger.info('[Step] Assets stored', { corporationId, count: data.length })

						await updateLastSync(this.env, corporationId, 'assetsLastSync')
						return {
							stored: data.length,
						}
					}
				)
			} else {
				logger.debug('[Step] Skipping assets sync (filtered)', { corporationId })
			}

			// Step 10: Fetch & store structures
			let structuresResult: { stored: number } | null = null
			if (shouldSync('structures')) {
				structuresResult = await step.do(
					'fetch-store-structures',
					{
						retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
						timeout: '1 minute',
					},
					async () => {
						using corpDataDO = getStub<EveCorporationData>(
							this.env.EVE_CORPORATION_DATA,
							corporationId
						)

						const data = await esiFetch.fetchStructures(
							tokenStore,
							corporationId,
							activeDirectorCharacterId
						)
						logger.debug('[Step] Structures fetched', { corporationId, count: data.length })

						await corpDataDO.storeStructures(corporationId, data)
						logger.info('[Step] Structures stored', { corporationId, count: data.length })

						await updateLastSync(this.env, corporationId, 'structuresLastSync')

						return {
							stored: data.length,
						}
					}
				)
			} else {
				logger.debug('[Step] Skipping structures sync (filtered)', { corporationId })
			}

			// Step 11: Fetch & store market orders
			let ordersResult: { stored: number } | null = null
			if (shouldSync('orders')) {
				ordersResult = await step.do(
					'fetch-store-orders',
					{
						retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
						timeout: '1 minute',
					},
					async () => {
						using corpDataDO = getStub<EveCorporationData>(
							this.env.EVE_CORPORATION_DATA,
							corporationId
						)

						const data = await esiFetch.fetchOrders(
							tokenStore,
							corporationId,
							activeDirectorCharacterId
						)
						logger.debug('[Step] Orders fetched', { corporationId, count: data.length })

						await corpDataDO.storeOrders(corporationId, data)
						await updateLastSync(this.env, corporationId, 'ordersLastSync')

						logger.info('[Step] Orders stored', { corporationId, count: data.length })

						return {
							stored: data.length,
						}
					}
				)
			} else {
				logger.debug('[Step] Skipping orders sync (filtered)', { corporationId })
			}

			// Step 12: Fetch & store contracts
			let contractsResult: { stored: number } | null = null
			if (shouldSync('contracts')) {
				contractsResult = await step.do(
					'fetch-store-contracts',
					{
						retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
						timeout: '1 minute',
					},
					async () => {
						using corpDataDO = getStub<EveCorporationData>(
							this.env.EVE_CORPORATION_DATA,
							corporationId
						)

						const data = await esiFetch.fetchContracts(
							tokenStore,
							corporationId,
							activeDirectorCharacterId
						)
						logger.debug('[Step] Contracts fetched', { corporationId, count: data.length })

						await corpDataDO.storeContracts(corporationId, data)
						logger.info('[Step] Contracts stored', { corporationId, count: data.length })

						await updateLastSync(this.env, corporationId, 'contractsLastSync')

						return {
							stored: data.length,
						}
					}
				)
			} else {
				logger.debug('[Step] Skipping contracts sync (filtered)', { corporationId })
			}

			// Step 13: Fetch & store industry jobs
			let industryJobsResult: { stored: number } | null = null
			if (shouldSync('industry-jobs')) {
				industryJobsResult = await step.do(
					'fetch-store-industry-jobs',
					{
						retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
						timeout: '1 minute',
					},
					async () => {
						using corpDataDO = getStub<EveCorporationData>(
							this.env.EVE_CORPORATION_DATA,
							corporationId
						)

						const data = await esiFetch.fetchIndustryJobs(
							tokenStore,
							corporationId,
							activeDirectorCharacterId
						)
						logger.debug('[Step] Industry jobs fetched', { corporationId, count: data.length })

						await corpDataDO.storeIndustryJobs(corporationId, data)
						logger.info('[Step] Industry jobs stored', { corporationId, count: data.length })

						await updateLastSync(this.env, corporationId, 'industryJobsLastSync')

						return {
							stored: data.length,
						}
					}
				)
			} else {
				logger.debug('[Step] Skipping industry jobs sync (filtered)', { corporationId })
			}

			// Step 14: Fetch & store killmails
			let killmailsResult: { stored: number } | null = null
			if (shouldSync('killmails')) {
				killmailsResult = await step.do(
					'fetch-store-killmails',
					{
						retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
						timeout: '1 minute',
					},
					async () => {
						using corpDataDO = getStub<EveCorporationData>(
							this.env.EVE_CORPORATION_DATA,
							corporationId
						)

						const data = await esiFetch.fetchKillmails(
							tokenStore,
							corporationId,
							activeDirectorCharacterId
						)
						logger.debug('[Step] Killmails fetched', { corporationId, count: data.length })

						await corpDataDO.storeKillmails(corporationId, data)
						logger.info('[Step] Killmails stored', { corporationId, count: data.length })

						await updateLastSync(this.env, corporationId, 'killmailsLastSync')

						return {
							stored: data.length,
						}
					}
				)
			} else {
				logger.debug('[Step] Skipping killmails sync (filtered)', { corporationId })
			}

			// Step 15: Update last sync timestamp
			await step.do('update-last-sync', {}, async () => {
				await this.env.CORE.updateCorporationLastSync(corporationId)
				logger.info('[Step] Last sync timestamp updated', { corporationId })
			})

			// Step 16: Record director success
			await step.do('record-director-success', {}, async () => {
				if (!directorManager) {
					throw new Error('DirectorManager not initialized')
				}
				await directorManager.recordSuccess(activeDirectorId)
				logger.info('[Step] Director success recorded', {
					corporationId,
					directorId: activeDirectorId,
					directorCharacterId: activeDirectorCharacterId,
				})
			})

			logger.info('[EveCorporationSyncWorkflow] Full sync completed successfully', {
				corporationId,
				trigger,
				director: {
					directorId: activeDirectorId,
					characterId: activeDirectorCharacterId,
					characterName: activeDirectorCharacterName,
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

			const result = {
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

			// Mark workflow as completed (non-blocking)
			if (updater) {
				try {
					await updater.markCompleted()
				} catch (error) {
					logger.warn('[EveCorporationSyncWorkflow] Failed to mark workflow as completed (non-blocking)', {
						corporationId,
						trigger,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}

			return result
		} catch (error) {
			logger.error('[EveCorporationSyncWorkflow] Sync failed with error', {
				corporationId,
				trigger,
				director: director
					? {
							directorId: director.directorId,
							characterId: directorCharacterId ?? director.characterId,
							characterName: directorCharacterName ?? director.characterName,
						}
					: undefined,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				errorType: error?.constructor?.name,
			})

			if (directorManager && director) {
				try {
					await directorManager.recordFailure(
						director.directorId,
						error instanceof Error ? error.message : String(error)
					)
				} catch (recordError) {
					logger.error('[EveCorporationSyncWorkflow] Failed to record director failure', {
						corporationId,
						trigger,
						recordError: recordError instanceof Error ? recordError.message : String(recordError),
					})
				}
			}

			// Mark workflow as failed (non-blocking)
			if (updater) {
				try {
					await updater.markFailed(error)
				} catch (markFailedError) {
					logger.warn('[EveCorporationSyncWorkflow] Failed to mark workflow as failed (non-blocking)', {
						corporationId,
						trigger,
						error: markFailedError instanceof Error ? markFailedError.message : String(markFailedError),
					})
				}
			}
			throw error
		}
	}
}
