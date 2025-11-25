import { WorkflowEntrypoint } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'

import { logger } from '@repo/hono-helpers'

import { sendHrDepartedMessages, updateCoreLastSync, updateSyncTimestamps } from './steps/common'
import { recordDirectorSuccess, selectDirector } from './steps/directors'
import { syncAssets } from './steps/assets'
import { fetchContracts, storeContracts } from './steps/contracts'
import { fetchIndustryJobs, storeIndustryJobs } from './steps/industry-jobs'
import { fetchKillmails, storeKillmails } from './steps/killmails'
import { fetchMembers, storeMembers } from './steps/members'
import { fetchMemberTracking, storeMemberTracking } from './steps/member-tracking'
import { fetchOrders, storeOrders } from './steps/orders'
import { fetchPublicInfo, storePublicInfo } from './steps/public-info'
import { fetchStructures, storeStructures } from './steps/structures'
import { fetchWallets, storeWallets } from './steps/wallets'
import { syncWalletJournal } from './steps/wallet-journal'
import { syncWalletTransactions } from './steps/wallet-transactions'
import { createShouldSyncPredicate } from './utils/should-sync'
import { createSyncedDataTracker } from './utils/synced-data'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { Env } from '../context'
import type {
	DirectorInfo,
	EveCorporationSyncParams,
	EveCorporationSyncResult,
	SyncStats,
} from './types'
import type { PublicInfo } from './steps/public-info'
import type { StoreMembersResult } from './steps/members'
import type { WalletsData } from './steps/wallets'
import type { StructuresData } from './steps/structures'
import type { OrdersData } from './steps/orders'
import type { ContractsData } from './steps/contracts'
import type { IndustryJobsData } from './steps/industry-jobs'
import type { KillmailsData } from './steps/killmails'

const STEP_RETRY_OPTIONS = {
	retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' } as const,
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
		const syncedDataTracker = createSyncedDataTracker()

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

		const { directorId, characterId: directorCharacterId, characterName: directorCharacterName } =
			director

		const stats: SyncStats = {}
		let publicInfo: PublicInfo | null = null
		let memberResult: StoreMembersResult | null = null
		let wallets: WalletsData | null = null
		let structures: StructuresData | null = null
		let orders: OrdersData | null = null
		let contracts: ContractsData | null = null
		let industryJobs: IndustryJobsData | null = null
		let killmails: KillmailsData | null = null

		if (shouldSync('public-info')) {
			publicInfo = await step.do(
				'fetch-public-info',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() => fetchPublicInfo(this.env, corporationId)
			)

			await step.do('store-public-info', {}, () =>
				storePublicInfo(this.env, corporationId, publicInfo!)
			)

			syncedDataTracker.add('public-info')
			stats.corporationName = publicInfo.name
		}

		if (shouldSync('members')) {
			const members = await step.do(
				'fetch-members',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() => fetchMembers(this.env, corporationId, directorCharacterId)
			)

			memberResult = await step.do('store-members', {}, () =>
				storeMembers(this.env, corporationId, members)
			)

			syncedDataTracker.add('members')
			stats.totalMembers = members.length
			stats.departedMembers = memberResult.departedMemberIds.length

			if (memberResult.departedMemberIds.length > 0) {
				await step.do('send-hr-messages', {}, () =>
					sendHrDepartedMessages(this.env, corporationId, memberResult!.departedMemberIds)
				)
			}
		}

		if (shouldSync('member-tracking')) {
			const trackingData = await step.do(
				'fetch-member-tracking',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() => fetchMemberTracking(this.env, corporationId, directorCharacterId)
			)

			await step.do('store-member-tracking', {}, () =>
				storeMemberTracking(this.env, corporationId, trackingData)
			)

			syncedDataTracker.add('member-tracking')
		}

		if (shouldSync('wallets')) {
			wallets = await step.do(
				'fetch-wallets',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() => fetchWallets(this.env, corporationId, directorCharacterId)
			)

			await step.do('store-wallets', {}, () => storeWallets(this.env, corporationId, wallets!))
			syncedDataTracker.add('wallets')
			stats.walletsCount = wallets.length
		}

		if (shouldSync('wallet-journal')) {
			await step.do(
				'sync-wallet-journal',
				{ ...STEP_RETRY_OPTIONS, timeout: '5 minutes' },
				() => syncWalletJournal(this.env, corporationId, directorCharacterId)
			)

			syncedDataTracker.add('wallet-journal')
		}

		if (shouldSync('wallet-transactions')) {
			await step.do(
				'sync-wallet-transactions',
				{ ...STEP_RETRY_OPTIONS, timeout: '5 minutes' },
				() => syncWalletTransactions(this.env, corporationId, directorCharacterId)
			)

			syncedDataTracker.add('wallet-transactions')
		}

		if (shouldSync('assets')) {
			const result = await step.do(
				'sync-assets',
				{ ...STEP_RETRY_OPTIONS, timeout: '2 minutes' },
				() => syncAssets(this.env, corporationId, directorCharacterId)
			)

			syncedDataTracker.add('assets')
			stats.assetsCount = result.assetsCount
		}

		if (shouldSync('structures')) {
			structures = await step.do(
				'fetch-structures',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() => fetchStructures(this.env, corporationId, directorCharacterId)
			)

			await step.do('store-structures', {}, () =>
				storeStructures(this.env, corporationId, structures!)
			)

			syncedDataTracker.add('structures')
			stats.structuresCount = structures.length
		}

		if (shouldSync('orders')) {
			orders = await step.do(
				'fetch-orders',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() => fetchOrders(this.env, corporationId, directorCharacterId)
			)

			await step.do('store-orders', {}, () => storeOrders(this.env, corporationId, orders!))
			syncedDataTracker.add('orders')
			stats.ordersCount = orders.length
		}

		if (shouldSync('contracts')) {
			contracts = await step.do(
				'fetch-contracts',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() => fetchContracts(this.env, corporationId, directorCharacterId)
			)

			await step.do('store-contracts', {}, () =>
				storeContracts(this.env, corporationId, contracts!)
			)

			syncedDataTracker.add('contracts')
			stats.contractsCount = contracts.length
		}

		if (shouldSync('industry-jobs')) {
			industryJobs = await step.do(
				'fetch-industry-jobs',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() => fetchIndustryJobs(this.env, corporationId, directorCharacterId)
			)

			await step.do('store-industry-jobs', {}, () =>
				storeIndustryJobs(this.env, corporationId, industryJobs!)
			)

			syncedDataTracker.add('industry-jobs')
			stats.industryJobsCount = industryJobs.length
		}

		if (shouldSync('killmails')) {
			killmails = await step.do(
				'fetch-killmails',
				{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
				() => fetchKillmails(this.env, corporationId, directorCharacterId)
			)

			await step.do('store-killmails', {}, () => storeKillmails(this.env, corporationId, killmails!))
			syncedDataTracker.add('killmails')
			stats.killmailsCount = killmails.length
		}

		await step.do('update-sync-timestamps', {}, () =>
			updateSyncTimestamps(this.env, corporationId, syncedDataTracker.get())
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
