import { WorkflowEntrypoint } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'

import { logger } from '@repo/hono-helpers'

import { syncAssets } from './steps/assets'
import { sendHrDepartedMessages, updateCoreLastSync, updateSyncTimestamps } from './steps/common'
import { fetchContracts, storeContracts } from './steps/contracts'
import { recordDirectorSuccess, selectDirector } from './steps/directors'
import { fetchIndustryJobs, storeIndustryJobs } from './steps/industry-jobs'
import { fetchKillmails, storeKillmails } from './steps/killmails'
import { fetchMemberTracking, storeMemberTracking } from './steps/member-tracking'
import { fetchMembers, storeMembers } from './steps/members'
import { fetchOrders, storeOrders } from './steps/orders'
import { fetchPublicInfo, storePublicInfo } from './steps/public-info'
import { fetchStructures, storeStructures } from './steps/structures'
import { syncWalletJournal } from './steps/wallet-journal'
import { syncWalletTransactions } from './steps/wallet-transactions'
import { fetchWallets, storeWallets } from './steps/wallets'
import { createShouldSyncPredicate } from './utils/should-sync'

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

/**
 * Result type for sync steps that tracks both the data type synced and any stats
 * All state must be derived from step returns to survive workflow hibernation
 */
interface SyncStepResult<T extends EveCorporationSyncDataType> {
	dataType: T
	stats: Partial<SyncStats>
}

export class EveCorporationSyncWorkflow extends WorkflowEntrypoint<Env, EveCorporationSyncParams> {
	async run(event: WorkflowEvent<EveCorporationSyncParams>, step: WorkflowStep) {
		const { corporationId, dataTypes, trigger } = event.payload

		logger.info('[EveCorporationSyncWorkflow] Starting sync', {
			corporationId,
			dataTypes: dataTypes || 'all',
			trigger,
			timestamp: event.timestamp,
		})

		this.validateEnv()

		const shouldSync = createShouldSyncPredicate(dataTypes)

		const director: DirectorInfo = await step.do(
			'select-director',
			{
				retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
				timeout: '30 seconds',
			},
			async () => {
				const selected = await selectDirector(this.env, corporationId)

				if (!selected) {
					throw new Error('No healthy directors available for corporation')
				}

				return selected
			}
		)

		const {
			directorId,
			characterId: directorCharacterId,
			characterName: directorCharacterName,
		} = director

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
				() => fetchPublicInfo(this.env, corporationId)
			)

			publicInfoSync = await step.do('store-public-info', {}, async () => {
				await storePublicInfo(this.env, corporationId, publicInfo)
				return {
					dataType: 'public-info' as const,
					stats: { corporationName: publicInfo.name },
				}
			})
		}

		if (shouldSync('members')) {
			const members = await step.do(
				'fetch-members',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() => fetchMembers(this.env, corporationId, directorCharacterId)
			)

			membersSync = await step.do('store-members', {}, async () => {
				const memberResult = await storeMembers(this.env, corporationId, members)

				if (memberResult.departedMemberIds.length > 0) {
					await sendHrDepartedMessages(this.env, corporationId, memberResult.departedMemberIds)
				}

				return {
					dataType: 'members' as const,
					stats: {
						totalMembers: members.length,
						departedMembers: memberResult.departedMemberIds.length,
					},
				}
			})
		}

		if (shouldSync('member-tracking')) {
			const trackingData = await step.do(
				'fetch-member-tracking',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() => fetchMemberTracking(this.env, corporationId, directorCharacterId)
			)

			memberTrackingSync = await step.do('store-member-tracking', {}, async () => {
				await storeMemberTracking(this.env, corporationId, trackingData)
				return {
					dataType: 'member-tracking' as const,
					stats: {},
				}
			})
		}

		if (shouldSync('wallets')) {
			const wallets = await step.do(
				'fetch-wallets',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() => fetchWallets(this.env, corporationId, directorCharacterId)
			)

			walletsSync = await step.do('store-wallets', {}, async () => {
				await storeWallets(this.env, corporationId, wallets)
				return {
					dataType: 'wallets' as const,
					stats: { walletsCount: wallets.length },
				}
			})
		}

		if (shouldSync('wallet-journal')) {
			walletJournalSync = await step.do(
				'sync-wallet-journal',
				{ ...STEP_RETRY_OPTIONS, timeout: '5 minutes' },
				async () => {
					await syncWalletJournal(this.env, corporationId, directorCharacterId)
					return {
						dataType: 'wallet-journal' as const,
						stats: {},
					}
				}
			)
		}

		if (shouldSync('wallet-transactions')) {
			walletTransactionsSync = await step.do(
				'sync-wallet-transactions',
				{ ...STEP_RETRY_OPTIONS, timeout: '5 minutes' },
				async () => {
					await syncWalletTransactions(this.env, corporationId, directorCharacterId)
					return {
						dataType: 'wallet-transactions' as const,
						stats: {},
					}
				}
			)
		}

		if (shouldSync('assets')) {
			assetsSync = await step.do(
				'sync-assets',
				{ ...STEP_RETRY_OPTIONS, timeout: '10 minutes' },
				async () => {
					const result = await syncAssets(this.env, corporationId, directorCharacterId)
					return {
						dataType: 'assets' as const,
						stats: { assetsCount: result.assetsCount },
					}
				}
			)
		}

		if (shouldSync('structures')) {
			const structures = await step.do(
				'fetch-structures',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() => fetchStructures(this.env, corporationId, directorCharacterId)
			)

			structuresSync = await step.do('store-structures', {}, async () => {
				await storeStructures(this.env, corporationId, structures)
				return {
					dataType: 'structures' as const,
					stats: { structuresCount: structures.length },
				}
			})
		}

		if (shouldSync('orders')) {
			const orders = await step.do(
				'fetch-orders',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() => fetchOrders(this.env, corporationId, directorCharacterId)
			)

			ordersSync = await step.do('store-orders', {}, async () => {
				await storeOrders(this.env, corporationId, orders)
				return {
					dataType: 'orders' as const,
					stats: { ordersCount: orders.length },
				}
			})
		}

		if (shouldSync('contracts')) {
			const contracts = await step.do(
				'fetch-contracts',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() => fetchContracts(this.env, corporationId, directorCharacterId)
			)

			contractsSync = await step.do('store-contracts', {}, async () => {
				await storeContracts(this.env, corporationId, contracts)
				return {
					dataType: 'contracts' as const,
					stats: { contractsCount: contracts.length },
				}
			})
		}

		if (shouldSync('industry-jobs')) {
			const industryJobs = await step.do(
				'fetch-industry-jobs',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() => fetchIndustryJobs(this.env, corporationId, directorCharacterId)
			)

			industryJobsSync = await step.do('store-industry-jobs', {}, async () => {
				await storeIndustryJobs(this.env, corporationId, industryJobs)
				return {
					dataType: 'industry-jobs' as const,
					stats: { industryJobsCount: industryJobs.length },
				}
			})
		}

		if (shouldSync('killmails')) {
			const killmails = await step.do(
				'fetch-killmails',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() => fetchKillmails(this.env, corporationId, directorCharacterId)
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

		await step.do('update-sync-timestamps', {}, () =>
			updateSyncTimestamps(this.env, corporationId, syncedDataTypes)
		)

		await step.do('update-last-sync', {}, () => updateCoreLastSync(this.env, corporationId))

		await step.do('record-director-success', {}, () =>
			recordDirectorSuccess(this.env, corporationId, directorId)
		)

		logger.info('[EveCorporationSyncWorkflow] Full sync completed successfully', {
			corporationId,
			trigger,
			director: {
				directorId,
				characterId: directorCharacterId,
				characterName: directorCharacterName,
			},
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
		if (!this.env.CORE) {
			throw new NonRetryableError('CORE service binding is missing')
		}
	}
}
