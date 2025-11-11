import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'
import * as esiFetch from '../services/esi-fetch'
import { DirectorManager } from '../services/director-manager'
import { createDb } from '../db'

import type { Env } from '../context'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { SelectedDirector } from '../services/director-manager'

/**
 * Workflow parameters for corporation data synchronization
 */
export interface EveCorporationSyncParams {
	/** Corporation ID to sync */
	corporationId: string
	/** Optional: specific data types to sync (defaults to all) */
	dataTypes?: string[]
	/** Trigger source (cron or api) */
	trigger: 'cron' | 'api'
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

		console.log('[EveCorporationSyncWorkflow] Starting full sync', {
			corporationId,
			dataTypes: dataTypes || 'all',
			trigger,
			timestamp: event.timestamp,
		})

		// Step 1: Select a healthy director
		const director = await step.do(
			'select-director',
			{
				retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
				timeout: '30 seconds',
			},
			async () => {
				console.log('[Step] Selecting healthy director', { corporationId })

				const db = createDb(this.env.DATABASE_URL)
				using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
				const directorManager = new DirectorManager(db, corporationId, tokenStore)
				const selected = await directorManager.selectDirector()

				if (!selected) {
					throw new Error('No healthy directors available for corporation')
				}

				console.log('[Step] Director selected', {
					corporationId,
					characterId: selected.characterId,
					characterName: selected.characterName,
				})

				return selected
			}
		)

		// Step 2: Fetch & store public info
		const publicInfo = await step.do(
			'fetch-public-info',
			{
				retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
				timeout: '1 minute',
			},
			async () => {
				console.log('[Step] Fetching public info', { corporationId })
				using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
				const info = await esiFetch.fetchPublicInfo(tokenStore, corporationId)
				console.log('[Step] Public info fetched', {
					corporationId,
					name: info.name,
					ticker: info.ticker,
				})
				return info
			}
		)

		await step.do('store-public-info', {}, async () => {
			using corpDataDO = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)
			await corpDataDO.storePublicInfo(corporationId, publicInfo)
			return {
				stored: true,
				corporationName: publicInfo.name,
				ticker: publicInfo.ticker,
				memberCount: publicInfo.memberCount,
			}
		})

		// Step 3: Fetch & store members
		const memberIds = await step.do(
			'fetch-members',
			{
				retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
				timeout: '1 minute',
			},
			async () => {
				using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
				const members = await esiFetch.fetchMembers(tokenStore, corporationId, director.characterId)
				console.log('[Step] Members fetched', { corporationId, count: members.length })
				return members
			}
		)

		const memberResult = await step.do('store-members', {}, async () => {
			using corpDataDO = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)
			const result = await corpDataDO.storeMembers(corporationId, memberIds)
			return {
				stored: memberIds.length,
				departed: result.departedMemberIds.length,
				departedMemberIds: result.departedMemberIds,
			}
		})

		// Step 4: Send HR cleanup messages for departed members
		if (memberResult.departedMemberIds.length > 0) {
			await step.do('send-hr-messages', {}, async () => {
				const hrQueue = this.env['hr-member-departed']
				const messages = memberResult.departedMemberIds.map((characterId: string) => ({
					body: { corporationId, characterId },
				}))
				await hrQueue.sendBatch(messages)
				console.log('[Step] HR messages sent', { count: messages.length })
			})
		}

		// Step 5: Fetch & store member tracking
		const trackingData = await step.do(
			'fetch-member-tracking',
			{
				retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
				timeout: '1 minute',
			},
			async () => {
				using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
				const data = await esiFetch.fetchMemberTracking(tokenStore, corporationId, director.characterId)
				console.log('[Step] Member tracking fetched', { corporationId, count: data.length })
				return data
			}
		)

		await step.do('store-member-tracking', {}, async () => {
			using corpDataDO = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)
			await corpDataDO.storeMemberTracking(corporationId, trackingData)
			return {
				stored: trackingData.length,
			}
		})

		// Step 6: Fetch & store wallets
		const wallets = await step.do(
			'fetch-wallets',
			{
				retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
				timeout: '1 minute',
			},
			async () => {
				using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
				const data = await esiFetch.fetchWallets(tokenStore, corporationId, director.characterId)
				console.log('[Step] Wallets fetched', { corporationId, count: data.length })
				return data
			}
		)

		await step.do('store-wallets', {}, async () => {
			using corpDataDO = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)
			await corpDataDO.storeWallets(corporationId, wallets)
			return {
				divisions: wallets.length,
				totalBalance: wallets.reduce((sum, w) => sum + w.balance, 0),
			}
		})

		// Step 7: Fetch & store wallet journal (all 7 divisions in parallel)
		await step.do(
			'fetch-store-wallet-journal',
			{
				retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
				timeout: '5 minutes',
			},
			async () => {
				using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
				using corpDataDO = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)

				const divisions = [1, 2, 3, 4, 5, 6, 7]
				const results = await Promise.allSettled(
					divisions.map(async (division) => {
						const entries = await esiFetch.fetchWalletJournal(
							tokenStore,
							corporationId,
							division,
							director.characterId
						)
						await corpDataDO.storeWalletJournal(corporationId, division, entries)
						return { division, count: entries.length }
					})
				)

				const divisionResults = results
					.filter((r) => r.status === 'fulfilled')
					.map((r) => r.value)
				const totalEntries = divisionResults.reduce((sum, r) => sum + (r?.count || 0), 0)

				return {
					divisionsProcessed: divisionResults.length,
					divisionsFailed: results.filter((r) => r.status === 'rejected').length,
					totalEntries,
					byDivision: divisionResults,
				}
			}
		)

		// Step 8: Fetch & store wallet transactions (all 7 divisions in parallel)
		await step.do(
			'fetch-store-wallet-transactions',
			{
				retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
				timeout: '5 minutes',
			},
			async () => {
				using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
				using corpDataDO = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)

				const divisions = [1, 2, 3, 4, 5, 6, 7]
				const results = await Promise.allSettled(
					divisions.map(async (division) => {
						const txs = await esiFetch.fetchWalletTransactions(
							tokenStore,
							corporationId,
							division,
							director.characterId
						)
						await corpDataDO.storeWalletTransactions(corporationId, division, txs)
						return { division, count: txs.length }
					})
				)

				const divisionResults = results
					.filter((r) => r.status === 'fulfilled')
					.map((r) => r.value)
				const totalTransactions = divisionResults.reduce((sum, r) => sum + (r?.count || 0), 0)

				return {
					divisionsProcessed: divisionResults.length,
					divisionsFailed: results.filter((r) => r.status === 'rejected').length,
					totalTransactions,
					byDivision: divisionResults,
				}
			}
		)

		// Step 9: Fetch & store assets
		const assets = await step.do(
			'fetch-assets',
			{
				retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
				timeout: '2 minutes',
			},
			async () => {
				using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
				const data = await esiFetch.fetchAssets(tokenStore, corporationId, director.characterId)
				console.log('[Step] Assets fetched', { corporationId, count: data.length })
				return data
			}
		)

		await step.do('store-assets', {}, async () => {
			using corpDataDO = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)
			await corpDataDO.storeAssets(corporationId, assets)
			return {
				stored: assets.length,
			}
		})

		// Step 10: Fetch & store structures
		const structures = await step.do(
			'fetch-structures',
			{
				retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
				timeout: '1 minute',
			},
			async () => {
				using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
				const data = await esiFetch.fetchStructures(tokenStore, corporationId, director.characterId)
				console.log('[Step] Structures fetched', { corporationId, count: data.length })
				return data
			}
		)

		await step.do('store-structures', {}, async () => {
			using corpDataDO = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)
			await corpDataDO.storeStructures(corporationId, structures)
			return {
				stored: structures.length,
			}
		})

		// Step 11: Fetch & store market orders
		const orders = await step.do(
			'fetch-orders',
			{
				retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
				timeout: '1 minute',
			},
			async () => {
				using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
				const data = await esiFetch.fetchOrders(tokenStore, corporationId, director.characterId)
				console.log('[Step] Orders fetched', { corporationId, count: data.length })
				return data
			}
		)

		await step.do('store-orders', {}, async () => {
			using corpDataDO = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)
			await corpDataDO.storeOrders(corporationId, orders)
			return {
				stored: orders.length,
			}
		})

		// Step 12: Fetch & store contracts
		const contracts = await step.do(
			'fetch-contracts',
			{
				retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
				timeout: '1 minute',
			},
			async () => {
				using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
				const data = await esiFetch.fetchContracts(tokenStore, corporationId, director.characterId)
				console.log('[Step] Contracts fetched', { corporationId, count: data.length })
				return data
			}
		)

		await step.do('store-contracts', {}, async () => {
			using corpDataDO = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)
			await corpDataDO.storeContracts(corporationId, contracts)
			return {
				stored: contracts.length,
			}
		})

		// Step 13: Fetch & store industry jobs
		const industryJobs = await step.do(
			'fetch-industry-jobs',
			{
				retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
				timeout: '1 minute',
			},
			async () => {
				using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
				const data = await esiFetch.fetchIndustryJobs(tokenStore, corporationId, director.characterId)
				console.log('[Step] Industry jobs fetched', { corporationId, count: data.length })
				return data
			}
		)

		await step.do('store-industry-jobs', {}, async () => {
			using corpDataDO = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)
			await corpDataDO.storeIndustryJobs(corporationId, industryJobs)
			return {
				stored: industryJobs.length,
			}
		})

		// Step 14: Fetch & store killmails
		const killmails = await step.do(
			'fetch-killmails',
			{
				retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
				timeout: '1 minute',
			},
			async () => {
				using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
				const data = await esiFetch.fetchKillmails(tokenStore, corporationId, director.characterId)
				console.log('[Step] Killmails fetched', { corporationId, count: data.length })
				return data
			}
		)

		await step.do('store-killmails', {}, async () => {
			using corpDataDO = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)
			await corpDataDO.storeKillmails(corporationId, killmails)
			return {
				stored: killmails.length,
			}
		})

		// Step 15: Update last sync timestamp
		await step.do('update-last-sync', {}, async () => {
			await this.env.CORE.updateCorporationLastSync(corporationId)
			console.log('[Step] Last sync timestamp updated', { corporationId })
		})

		// Step 16: Record director success
		await step.do('record-director-success', {}, async () => {
			const db = createDb(this.env.DATABASE_URL)
			using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
			const directorManager = new DirectorManager(db, corporationId, tokenStore)
			await directorManager.recordSuccess(director.directorId)
			console.log('[Step] Director success recorded', { corporationId })
		})

		console.log('[EveCorporationSyncWorkflow] Full sync completed successfully', {
			corporationId,
			trigger,
			stats: {
				corporationName: publicInfo.name,
				totalMembers: memberIds.length,
				departedMembers: memberResult.departedMemberIds.length,
				walletsCount: wallets.length,
				assetsCount: assets.length,
				structuresCount: structures.length,
				ordersCount: orders.length,
				contractsCount: contracts.length,
				industryJobsCount: industryJobs.length,
				killmailsCount: killmails.length,
			},
		})

		return {
			success: true,
			corporationId,
			trigger,
			stats: {
				corporationName: publicInfo.name,
				totalMembers: memberIds.length,
				departedMembers: memberResult.departedMemberIds.length,
				walletsCount: wallets.length,
				assetsCount: assets.length,
				structuresCount: structures.length,
				ordersCount: orders.length,
				contractsCount: contracts.length,
				industryJobsCount: industryJobs.length,
				killmailsCount: killmails.length,
			},
		}
	}
}
