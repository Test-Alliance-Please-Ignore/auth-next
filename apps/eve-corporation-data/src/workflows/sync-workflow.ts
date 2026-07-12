import { WorkflowEntrypoint } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'
import { logger, withWorkerLogContext } from '@repo/hono-helpers'
import {
	esiRetryOptions,
	NonRetryableError,
	parseEsiErrorMetadata,
	withEsiRetryClassification,
} from '@repo/workflow-utils'

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
import {
	reconcileDirectorsFromCorporationRoles,
	recordDirectorFailure,
	recordDirectorSuccess,
	selectDirector,
	verifyAllDirectorsHealth,
} from './steps/directors'
import { fetchIndustryJobs, storeIndustryJobs } from './steps/industry-jobs'
import { fetchKillmails, storeKillmails } from './steps/killmails'
import { fetchMemberTracking, storeMemberTracking } from './steps/member-tracking'
import { fetchMembers, sendMembershipChangedMessages, storeMembers } from './steps/members'
import { fetchOrders, storeOrders } from './steps/orders'
import { fetchPublicInfo, storePublicInfo } from './steps/public-info'
import {
	fetchMiningEnrichment,
	fetchSkyhookEnrichment,
	fetchSovereigntyEnrichment,
	fetchStructures,
	storeMiningEnrichment,
	storeSkyhookEnrichment,
	storeSovereigntyEnrichment,
	storeStructures,
} from './steps/structures'
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
import type {
	CorporationRole,
	EveCorporationData,
	EveCorporationSyncDataType,
} from '@repo/eve-corporation-data'
import type { Env } from '../context'
import type {
	DirectorInfo,
	EveCorporationSyncParams,
	EveCorporationSyncResult,
	SyncStats,
} from './types'

const STEP_RETRY_OPTIONS = esiRetryOptions

function readEnvFlag(value: boolean | string | undefined, defaultValue: boolean): boolean {
	if (typeof value === 'boolean') return value
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase()
		if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
		if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
	}
	return defaultValue
}

const ROLE_REQUIREMENTS_BY_DATA_TYPE: Partial<
	Record<EveCorporationSyncDataType, CorporationRole[]>
> = {
	members: ['Director'],
	'member-tracking': ['Director'],
	wallets: ['Accountant', 'Junior_Accountant'],
	'wallet-journal': ['Accountant', 'Junior_Accountant'],
	'wallet-transactions': ['Accountant', 'Junior_Accountant'],
	assets: ['Director'],
	structures: ['Station_Manager'],
	orders: ['Accountant', 'Junior_Accountant', 'Trader'],
	contracts: ['Director'],
	'industry-jobs': ['Factory_Manager'],
	killmails: ['Director'],
}

function getRequiredRoleSets(
	shouldSync: (type: EveCorporationSyncDataType) => boolean
): CorporationRole[][] {
	const targetTypes = Object.keys(ROLE_REQUIREMENTS_BY_DATA_TYPE) as EveCorporationSyncDataType[]

	const deduped = new Map<string, CorporationRole[]>()
	for (const type of targetTypes) {
		if (!shouldSync(type)) continue
		const anyOf = ROLE_REQUIREMENTS_BY_DATA_TYPE[type]
		if (!anyOf || anyOf.length === 0) continue
		const key = [...anyOf].sort().join('|')
		if (!deduped.has(key)) {
			deduped.set(key, anyOf)
		}
	}

	return [...deduped.values()]
}

/**
 * Result type for sync steps that tracks both the data type synced and any stats
 * All state must be derived from step returns to survive workflow hibernation
 */
interface SyncStepResult<T extends EveCorporationSyncDataType> {
	dataType: T
	stats: Partial<SyncStats>
}

async function syncCoreAuthHealthSnapshot(
	env: Env,
	corporationId: string,
	workflowInstanceId: string
): Promise<{ healthyDirectorCount: number; isVerified: boolean }> {
	const corpStub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, corporationId)
	const directors = await corpStub.getDirectors(corporationId)
	const healthyDirectorCount = directors.filter((director) => director.isHealthy).length
	const isVerified = healthyDirectorCount > 0
	await env.CORE.updateCorporationAuthHealth(corporationId, {
		healthyDirectorCount,
		isVerified,
		lastVerified: new Date().toISOString(),
	})
	logger.info('[EveCorporationSyncWorkflow] Synced corporation auth health snapshot to Core', {
		corporationId,
		workflowInstanceId,
		healthyDirectorCount,
		isVerified,
		directorCount: directors.length,
	})
	return { healthyDirectorCount, isVerified }
}

export class EveCorporationSyncWorkflow extends WorkflowEntrypoint<Env, EveCorporationSyncParams> {
	async run(event: WorkflowEvent<EveCorporationSyncParams>, step: WorkflowStep) {
		return await withWorkerLogContext('EveCorporationSyncWorkflow', this.env, async () => {
			const { corporationId, dataTypes, trigger } = event.payload
			const workflowInstanceId = event.instanceId
			const assetsSyncEnabled = readEnvFlag(this.env.ASSETS_SYNC_ENABLED, true)
			const structureEnrichmentEnabled = readEnvFlag(this.env.STRUCTURE_ENRICHMENT_ENABLED, false)

			logger.info('[EveCorporationSyncWorkflow] Starting sync', {
				corporationId,
				dataTypes: dataTypes || 'all',
				trigger,
				timestamp: event.timestamp,
			})

			this.validateEnv()
			const corpData = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)

			const corporationConfig = await step.do(
				'load-corporation-sync-config',
				{ timeout: '30 seconds' },
				async () => {
					try {
						return await corpData.getCorporationSyncConfig(corporationId)
					} catch (error) {
						logger.warn(
							'[EveCorporationSyncWorkflow] Failed to load corporation config for asset gating',
							{
								corporationId,
								error: error instanceof Error ? error.message : String(error),
							}
						)
						return null
					}
				}
			)

			const structureAssetSyncEnabled = corporationConfig?.includeInStructureAssetSync ?? false
			const shouldSync = createShouldSyncPredicate(dataTypes, {
				disabledDataTypes: assetsSyncEnabled && structureAssetSyncEnabled ? [] : ['assets'],
			})
			const requiredRoleSets = getRequiredRoleSets(shouldSync)

			const wantsAssets = !dataTypes || dataTypes.length === 0 || dataTypes.includes('assets')
			if (wantsAssets && (!assetsSyncEnabled || !structureAssetSyncEnabled)) {
				const assetSyncLog = {
					corporationId,
					requestedDataTypes: dataTypes ?? 'all',
					assetsSyncEnabled,
					structureAssetSyncEnabled,
				}
				if (assetsSyncEnabled) {
					logger.info(
						'[EveCorporationSyncWorkflow] Asset sync skipped by configuration',
						assetSyncLog
					)
				} else {
					logger.warn(
						'[EveCorporationSyncWorkflow] Asset sync skipped by configuration',
						assetSyncLog
					)
				}
			}

			await step.do(
				'verify-all-directors-health',
				{
					retries: { limit: 2, delay: '3 seconds', backoff: 'exponential' },
					timeout: '1 minute',
				},
				async () => {
					const verification = await verifyAllDirectorsHealth(this.env, corporationId)
					logger.info('[EveCorporationSyncWorkflow] Director health verification complete', {
						corporationId,
						verified: verification.verified,
						failed: verification.failed,
					})
					return verification
				}
			)
			await step.do('sync-core-auth-health-after-director-verify', {}, () =>
				syncCoreAuthHealthSnapshot(this.env, corporationId, workflowInstanceId)
			)

			let director: DirectorInfo | null = await step.do(
				'select-director',
				{
					retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
					timeout: '30 seconds',
				},
				async () => {
					try {
						return await selectDirector(this.env, corporationId, { requiredRoleSets })
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

			if (director) {
				await step.do(
					'reconcile-directors-from-roles',
					{
						retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
						timeout: '1 minute',
					},
					async () => {
						return await withEsiRetryClassification('reconcile-directors-from-roles', () =>
							reconcileDirectorsFromCorporationRoles(this.env, corporationId, director!.characterId)
						)
					}
				)
			}

			const shouldSyncAuthenticated = (type: EveCorporationSyncDataType) =>
				director !== null && shouldSync(type)

			const isDirectorAuthFailure = (error: unknown): boolean => {
				if (error instanceof Error) {
					const metadata = parseEsiErrorMetadata(error.message)
					const status = metadata?.status
					if (status === 401 || status === 403) {
						return true
					}
				}
				const message =
					error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
				return (
					message.includes('esi request failed: 403') ||
					message.includes('esi request failed: 401') ||
					message.includes('forbidden') ||
					message.includes('unauthorized')
				)
			}

			const buildDirectorFailureReason = (
				stepName: string,
				error: unknown,
				requiredRoles?: string[]
			): string => {
				const rawMessage = error instanceof Error ? error.message : String(error)
				const metadata = error instanceof Error ? parseEsiErrorMetadata(error.message) : null
				const status = typeof metadata?.status === 'number' ? metadata.status : null
				const path = typeof metadata?.path === 'string' ? metadata.path : null
				const lower = rawMessage.toLowerCase()
				const roleHint = lower.includes('required role') ? 'required_roles_missing' : null
				const classifyDetailCode = (): string => {
					if (status === 401 && lower.includes('no token')) {
						return 'no_token_provided'
					}
					if (status === 401 && lower.includes('expired')) {
						return 'token_expired'
					}
					if (status === 403 && lower.includes('required role')) {
						return 'required_roles_missing'
					}
					if (status === 403) {
						return 'forbidden'
					}
					if (status === 401) {
						return 'unauthorized'
					}
					return 'auth_failure'
				}
				const classifyReasonCode = (): string => {
					if (roleHint === 'required_roles_missing') {
						return 'required_roles_missing'
					}
					if (status === 401) {
						return 'unauthorized'
					}
					if (status === 403) {
						return 'forbidden'
					}
					return 'auth_failure'
				}
				const detailCode = classifyDetailCode()
				const reasonCode = classifyReasonCode()
				const parts = [
					`step=${stepName}`,
					status !== null ? `status=${status}` : null,
					path ? `path=${path}` : null,
					`reasonCode=${reasonCode}`,
					detailCode ? `detailCode=${detailCode}` : null,
					roleHint ? `hint=${roleHint}` : null,
					requiredRoles && requiredRoles.length > 0
						? `requiredRoles=${requiredRoles.join('|')}`
						: null,
					roleHint && requiredRoles && requiredRoles.length > 0
						? `missingRoles=unknown_from_esi`
						: null,
				].filter((part): part is string => Boolean(part))
				return `Director auth failure (${parts.join(', ')})`
			}

			const runDirectorStepWithFailover = async <T>(params: {
				stepName: string
				timeout: '1 minute' | '5 minutes' | '10 minutes'
				requiredRoles?: string[]
				run: (directorCharacterId: string) => Promise<T>
			}): Promise<T> => {
				if (!director) {
					throw new Error(`No director available for authenticated step: ${params.stepName}`)
				}

				const stepOptions = { ...STEP_RETRY_OPTIONS, timeout: params.timeout }
				try {
					return (await step.do(
						params.stepName,
						stepOptions,
						async () =>
							(await withEsiRetryClassification(params.stepName, () =>
								params.run(director!.characterId)
							)) as any
					)) as T
				} catch (error) {
					if (!isDirectorAuthFailure(error)) {
						throw error
					}

					const errorMessage = error instanceof Error ? error.message : String(error)
					const failureReason = buildDirectorFailureReason(
						params.stepName,
						error,
						params.requiredRoles
					)
					logger.warn(
						'[EveCorporationSyncWorkflow] Director auth failure on authenticated step, failing over',
						{
							corporationId,
							stepName: params.stepName,
							directorId: director.directorId,
							directorCharacterId: director.characterId,
							error: errorMessage,
							failureReason,
						}
					)

					await step.do(`record-director-failure-${params.stepName}`, {}, () =>
						recordDirectorFailure(this.env, corporationId, director!.directorId, failureReason, {
							forceUnhealthy: true,
						})
					)

					const replacementDirector = await step.do(
						`reselect-director-after-${params.stepName}-auth-failure`,
						{
							retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
							timeout: '30 seconds',
						},
						() => selectDirector(this.env, corporationId, { requiredRoleSets })
					)

					if (!replacementDirector) {
						throw error
					}

					director = replacementDirector
					return (await step.do(
						`${params.stepName}-with-failover-director`,
						stepOptions,
						async () =>
							(await withEsiRetryClassification(`${params.stepName}-with-failover-director`, () =>
								params.run(director!.characterId)
							)) as any
					)) as T
				}
			}

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
			let ownedStructureIdsForAssets: string[] | undefined = undefined

			if (shouldSync('public-info')) {
				const publicInfo = await step.do(
					'fetch-public-info',
					{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
					() =>
						withEsiRetryClassification('fetch-public-info', () =>
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
				let members: Awaited<ReturnType<typeof fetchMembers>>
				try {
					members = await step.do(
						'fetch-members',
						{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
						() =>
							withEsiRetryClassification('fetch-members', () =>
								fetchMembers(this.env, corporationId, director!.characterId)
							)
					)
				} catch (error) {
					if (!director || !isDirectorAuthFailure(error)) {
						throw error
					}

					const errorMessage = error instanceof Error ? error.message : String(error)
					const failureReason = buildDirectorFailureReason('fetch-members', error, ['Director'])
					logger.warn(
						'[EveCorporationSyncWorkflow] Director auth failure on fetch-members, failing over',
						{
							corporationId,
							directorId: director.directorId,
							directorCharacterId: director.characterId,
							error: errorMessage,
							failureReason,
						}
					)

					await step.do('record-director-failure-fetch-members', {}, () =>
						recordDirectorFailure(this.env, corporationId, director!.directorId, failureReason, {
							forceUnhealthy: true,
						})
					)

					const replacementDirector = await step.do(
						'reselect-director-after-fetch-members-auth-failure',
						{
							retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
							timeout: '30 seconds',
						},
						() => selectDirector(this.env, corporationId, { requiredRoleSets })
					)

					if (!replacementDirector) {
						throw error
					}

					director = replacementDirector
					members = await step.do(
						'fetch-members-with-failover-director',
						{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
						() =>
							withEsiRetryClassification('fetch-members-with-failover-director', () =>
								fetchMembers(this.env, corporationId, director!.characterId)
							)
					)
				}

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
				let trackingData: Awaited<ReturnType<typeof fetchMemberTracking>>
				try {
					trackingData = await step.do(
						'fetch-member-tracking',
						{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
						() =>
							withEsiRetryClassification('fetch-member-tracking', () =>
								fetchMemberTracking(this.env, corporationId, director!.characterId)
							)
					)
				} catch (error) {
					if (!director || !isDirectorAuthFailure(error)) {
						throw error
					}

					const errorMessage = error instanceof Error ? error.message : String(error)
					const failureReason = buildDirectorFailureReason('fetch-member-tracking', error, [
						'Director',
					])
					logger.warn(
						'[EveCorporationSyncWorkflow] Director auth failure on fetch-member-tracking, failing over',
						{
							corporationId,
							directorId: director.directorId,
							directorCharacterId: director.characterId,
							error: errorMessage,
							failureReason,
						}
					)

					await step.do('record-director-failure-fetch-member-tracking', {}, () =>
						recordDirectorFailure(this.env, corporationId, director!.directorId, failureReason, {
							forceUnhealthy: true,
						})
					)

					const replacementDirector = await step.do(
						'reselect-director-after-fetch-member-tracking-auth-failure',
						{
							retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
							timeout: '30 seconds',
						},
						() => selectDirector(this.env, corporationId)
					)

					if (!replacementDirector) {
						throw error
					}

					director = replacementDirector
					trackingData = await step.do(
						'fetch-member-tracking-with-failover-director',
						{ ...STEP_RETRY_OPTIONS, timeout: '1 minute' },
						() =>
							withEsiRetryClassification('fetch-member-tracking-with-failover-director', () =>
								fetchMemberTracking(this.env, corporationId, director!.characterId)
							)
					)
				}

				memberTrackingSync = await step.do('store-member-tracking', {}, async () => {
					await storeMemberTracking(this.env, corporationId, trackingData)
					return {
						dataType: 'member-tracking' as const,
						stats: {},
					}
				})
			}

			if (shouldSyncAuthenticated('wallets')) {
				const wallets = await runDirectorStepWithFailover({
					stepName: 'fetch-wallets',
					timeout: '1 minute',
					requiredRoles: ['Accountant', 'Junior_Accountant'],
					run: (directorCharacterId) => fetchWallets(this.env, corporationId, directorCharacterId),
				})

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
						const walletJournalResult = await runDirectorStepWithFailover({
							stepName: 'sync-wallet-journal',
							timeout: '5 minutes',
							requiredRoles: ['Accountant', 'Junior_Accountant'],
							run: (directorCharacterId) =>
								syncWalletJournal(this.env, corporationId, directorCharacterId),
						})
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
						const walletTransactionsResult = await runDirectorStepWithFailover({
							stepName: 'sync-wallet-transactions',
							timeout: '5 minutes',
							requiredRoles: ['Accountant', 'Junior_Accountant'],
							run: (directorCharacterId) =>
								syncWalletTransactions(this.env, corporationId, directorCharacterId),
						})
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

			if (shouldSyncAuthenticated('structures')) {
				// Keep the structure refresh from blocking the asset projection refresh.
				// The inventory path can fall back to the DB or refresh structures on its own.
				try {
					const structures = await runDirectorStepWithFailover({
						stepName: 'fetch-structures',
						timeout: '1 minute',
						requiredRoles: ['Station_Manager'],
						run: (directorCharacterId) =>
							fetchStructures(this.env, corporationId, directorCharacterId),
					})
					ownedStructureIdsForAssets = structures.map((structure) => String(structure.structure_id))

					await step.do('store-structures', {}, async () => {
						await storeStructures(this.env, corporationId, structures)
					})

					const sovereigntyEnrichment = structureEnrichmentEnabled
						? await runDirectorStepWithFailover({
								stepName: 'fetch-structure-sovereignty-enrichment',
								timeout: '5 minutes',
								requiredRoles: ['Station_Manager'],
								run: (directorCharacterId) =>
									fetchSovereigntyEnrichment(this.env, corporationId, directorCharacterId),
							})
						: null
					const skyhookEnrichment = structureEnrichmentEnabled
						? await runDirectorStepWithFailover({
								stepName: 'fetch-structure-skyhook-enrichment',
								timeout: '5 minutes',
								requiredRoles: ['Station_Manager'],
								run: (directorCharacterId) =>
									fetchSkyhookEnrichment(this.env, corporationId, directorCharacterId),
							})
						: null
					const miningExtractions = structureEnrichmentEnabled
						? await runDirectorStepWithFailover({
								stepName: 'fetch-structure-mining-enrichment',
								timeout: '5 minutes',
								requiredRoles: ['Station_Manager'],
								run: (directorCharacterId) =>
									fetchMiningEnrichment(this.env, corporationId, directorCharacterId),
							})
						: null

					if (sovereigntyEnrichment) {
						await step.do('store-structure-sovereignty-enrichment', {}, async () => {
							await storeSovereigntyEnrichment(this.env, corporationId, sovereigntyEnrichment)
						})
					}
					if (skyhookEnrichment) {
						await step.do('store-structure-skyhook-enrichment', {}, async () => {
							await storeSkyhookEnrichment(this.env, corporationId, skyhookEnrichment)
						})
					}
					if (miningExtractions) {
						await step.do('store-structure-mining-enrichment', {}, async () => {
							await storeMiningEnrichment(this.env, corporationId, miningExtractions)
						})
					}

					structuresSync = {
						dataType: 'structures' as const,
						stats: {
							structuresCount: structures.length,
							sovereigntySystemsCount: sovereigntyEnrichment?.sovereigntySystems?.length ?? 0,
							sovereigntyHubsCount: sovereigntyEnrichment?.sovereigntyHubs.length ?? 0,
							skyhooksCount: skyhookEnrichment?.skyhooks.length ?? 0,
							miningExtractionsCount: miningExtractions?.length ?? 0,
						},
					}
				} catch (error) {
					logger.warn(
						'[EveCorporationSyncWorkflow] Structure sync failed; continuing to asset sync',
						{
							corporationId,
							error: error instanceof Error ? error.message : String(error),
						}
					)
				}
			}

			if (shouldSyncAuthenticated('assets')) {
				logger.info('[EveCorporationSyncWorkflow] Asset sync selected for this run', {
					corporationId,
					trigger,
					hasDirector: director !== null,
					structureAssetSyncEnabled,
				})
				assetsSync = await step.do(
					'sync-assets',
					{ ...STEP_RETRY_OPTIONS, timeout: '10 minutes' },
					async () => {
						const result = await runDirectorStepWithFailover({
							stepName: 'sync-assets',
							timeout: '10 minutes',
							requiredRoles: ['Director'],
							run: (directorCharacterId) =>
								syncAssets(
									this.env,
									corporationId,
									directorCharacterId,
									ownedStructureIdsForAssets
								),
						})
						return {
							dataType: 'assets' as const,
							stats: { assetsCount: result.assetsCount },
						}
					}
				)
			}

			if (shouldSyncAuthenticated('orders')) {
				const orders = await runDirectorStepWithFailover({
					stepName: 'fetch-orders',
					timeout: '1 minute',
					run: (directorCharacterId) => fetchOrders(this.env, corporationId, directorCharacterId),
				})

				ordersSync = await step.do('store-orders', {}, async () => {
					await storeOrders(this.env, corporationId, orders)
					return {
						dataType: 'orders' as const,
						stats: { ordersCount: orders.length },
					}
				})
			}

			if (shouldSyncAuthenticated('contracts')) {
				const contracts = await runDirectorStepWithFailover({
					stepName: 'fetch-contracts',
					timeout: '1 minute',
					requiredRoles: ['Director'],
					run: (directorCharacterId) =>
						fetchContracts(this.env, corporationId, directorCharacterId),
				})

				contractsSync = await step.do('store-contracts', {}, async () => {
					await storeContracts(this.env, corporationId, contracts)
					return {
						dataType: 'contracts' as const,
						stats: { contractsCount: contracts.length },
					}
				})
			}

			if (shouldSyncAuthenticated('industry-jobs')) {
				const industryJobs = await runDirectorStepWithFailover({
					stepName: 'fetch-industry-jobs',
					timeout: '1 minute',
					run: (directorCharacterId) =>
						fetchIndustryJobs(this.env, corporationId, directorCharacterId),
				})

				industryJobsSync = await step.do('store-industry-jobs', {}, async () => {
					await storeIndustryJobs(this.env, corporationId, industryJobs)
					return {
						dataType: 'industry-jobs' as const,
						stats: { industryJobsCount: industryJobs.length },
					}
				})
			}

			if (shouldSyncAuthenticated('killmails')) {
				const killmails = await runDirectorStepWithFailover({
					stepName: 'fetch-killmails',
					timeout: '1 minute',
					requiredRoles: ['Director'],
					run: (directorCharacterId) =>
						fetchKillmails(this.env, corporationId, directorCharacterId),
				})

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
					walletTransactionsMaxDate:
						walletTransactionsSync?.stats.walletTransactionsMaxDate ?? null,
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
					walletTransactionsMaxDate:
						walletTransactionsSync?.stats.walletTransactionsMaxDate ?? null,
				},
			})

			await step.do('update-sync-timestamps', {}, () =>
				updateSyncTimestamps(this.env, corporationId, syncedDataTypes)
			)

			await step.do('update-last-sync', {}, () => updateCoreLastSync(this.env, corporationId))

			if (director?.directorId) {
				await step.do('record-director-success', {}, () =>
					recordDirectorSuccess(this.env, corporationId, director!.directorId)
				)
			}

			await step.do('sync-core-auth-health-final', {}, () =>
				syncCoreAuthHealthSnapshot(this.env, corporationId, workflowInstanceId)
			)

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

			if ((walletJournalSync || walletTransactionsSync) && director?.directorId) {
				const taxProjectionDispatch = await dispatchTaxProjectionRefresh({
					deps: {
						trigger: async () => {
							await step.do(
								'trigger-tax-projection-refresh',
								{
									retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
									timeout: '1 minute',
								},
								() =>
									triggerTaxProjectionRefresh(this.env, director!.directorId, taxProjectionInput)
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
									director!.directorId,
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
				logger.info(
					'[EveCorporationSyncWorkflow] Skipping tax projection trigger (no wallet rows)',
					{
						corporationId,
						workflowInstanceId,
						taxProjectionTriggerRunId,
						walletJournalFetched,
						walletTransactionsFetched,
						walletJournalPersistedNewRows,
						walletTransactionsPersistedNewRows,
					}
				)
			}

			logger.info('[EveCorporationSyncWorkflow] Full sync completed successfully', {
				corporationId,
				trigger,
				director: director
					? {
							directorId: director.directorId,
							characterId: director.characterId,
							characterName: director.characterName,
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
		})
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
