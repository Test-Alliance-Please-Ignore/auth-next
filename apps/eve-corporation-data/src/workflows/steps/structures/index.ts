import { disposeRpcResult, getStub, withRpcResult } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import * as esiFetch from '../../../services/esi-fetch'
import { buildPriorityQueuedEntries } from '../../../services/structure-priority'
import { createTokenStore, getCorporationDataStub } from '../../utils/services'
import {
	readSharedSovereigntySystemsForCorporation,
	refreshSharedSovereigntySystems,
} from '../../utils/sovereignty-systems-cache'
import {
	createStructureEnrichmentScopeMismatchError,
	shouldSuppressDirectorUnhealthyOnStructureEnrichmentAuthFailure,
} from '../../utils/structure-enrichment-auth'

import type { SkyhookStoreResult, StructureSyncFailureTarget } from '@repo/eve-corporation-data'
import type { Universe } from '@repo/universe'
import type { Env } from '../../../context'
import type { StructureEnrichmentSyncTarget } from '../../utils/structure-enrichment-auth'

export type StructuresData = Awaited<ReturnType<typeof esiFetch.fetchStructures>>
export type SovereigntySystemsData = Awaited<ReturnType<typeof esiFetch.fetchSovereigntySystems>>
export type SovereigntyHubsData = Awaited<ReturnType<typeof esiFetch.fetchSovereigntyHubs>>
export type CorporationSkyhooksData = Awaited<ReturnType<typeof esiFetch.fetchCorporationSkyhooks>>
export type MiningExtractionsData = Awaited<
	ReturnType<typeof esiFetch.fetchCorporationMiningExtractions>
>
type StructureEnrichmentFailure = esiFetch.StructureEnrichmentFailure

export interface SovereigntyEnrichmentData {
	sovereigntySystems: SovereigntySystemsData | null
	sovereigntyHubs: SovereigntyHubsData['sovereigntyHubs']
	pruneCandidateIds: string[]
	failures: StructureEnrichmentFailure[]
	failureCount: number
	rateLimitFailureCount: number
	nonRateLimitFailureCount: number
}

export interface SkyhookEnrichmentData {
	skyhooks: CorporationSkyhooksData['skyhooks']
	pruneCandidateIds: string[]
	failures: StructureEnrichmentFailure[]
	failureCount: number
	rateLimitFailureCount: number
	nonRateLimitFailureCount: number
}

type PaginatedEsiResponse<T> = {
	data: T
	pages?: number
	page?: number
}

function detachRpcValue<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((entry) => detachRpcValue(entry)) as T
	}
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, detachRpcValue(entry)])
		) as T
	}
	return value
}

function fetchListingPage<T>(
	request: Promise<PaginatedEsiResponse<T>>
): Promise<PaginatedEsiResponse<T>> {
	return withRpcResult(request, (response) => ({
		data: detachRpcValue(response.data),
		pages: response.pages,
		page: response.page,
	}))
}

async function fetchStructureListing<T, E>(
	fetchPage: (page: number) => Promise<PaginatedEsiResponse<T>>,
	extractEntries: (data: T) => E[],
	label: string
): Promise<E[]> {
	const firstResponse = await fetchPage(1)
	const totalPages = firstResponse.pages ?? 1
	const entries = [...extractEntries(firstResponse.data)]

	for (let page = 2; page <= totalPages; page += 1) {
		const response = await fetchPage(page)
		if (response.pages !== undefined && response.pages !== totalPages) {
			throw new Error(
				`ESI ${label} listing changed page count while fetching: expected ${totalPages}, got ${response.pages}`
			)
		}
		if (response.page !== undefined && response.page !== page) {
			throw new Error(
				`ESI ${label} listing returned page ${response.page} when page ${page} was requested`
			)
		}
		entries.push(...extractEntries(response.data))
	}

	return entries
}

function buildSovereigntyAllianceBySystemId(
	sovereigntySystems: SovereigntySystemsData
): Map<string, string | null> {
	return new Map(
		sovereigntySystems
			.filter((system) => system.claim_type === 'alliance')
			.map((system) => [system.system_id, system.alliance_id ?? null])
	)
}

export async function fetchStructures(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<StructuresData> {
	const tokenStore = createTokenStore(env)
	const structures = await esiFetch.fetchStructures(tokenStore, corporationId, directorCharacterId)

	logger.debug('[StructuresStep] Fetched structures', {
		corporationId,
		count: structures.length,
	})

	return structures
}

export async function storeStructures(
	env: Env,
	corporationId: string,
	structures: StructuresData
): Promise<void> {
	const corpData = getCorporationDataStub(env, corporationId)
	await corpData.storeStructures(corporationId, structures)

	logger.info('[StructuresStep] Stored structures', {
		corporationId,
		count: structures.length,
	})
}

export async function fetchSovereigntyEnrichment(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<SovereigntyEnrichmentData | null> {
	try {
		const corpData = getCorporationDataStub(env, corporationId)
		const tokenStore = createTokenStore(env)
		let sovereigntySystems = await readSharedSovereigntySystemsForCorporation(env, corporationId)
		if (!sovereigntySystems) {
			logger.info(
				'[StructuresStep] Shared sovereignty snapshot missing or stale; rewarming cache',
				{
					corporationId,
				}
			)
			await refreshSharedSovereigntySystems(env)
			sovereigntySystems = await readSharedSovereigntySystemsForCorporation(env, corporationId)
			if (!sovereigntySystems) {
				throw new Error('Complete shared sovereignty snapshot was unavailable after refresh')
			}
		}
		const sovereigntyHubListing = await fetchStructureListing(
			(page) =>
				fetchListingPage(
					tokenStore.fetchEsi<{
						sovereignty_hubs: Array<{ id: number; solar_system_id: number }>
					}>(
						`/corporations/${corporationId}/structures/sovereignty-hubs?page=${page}`,
						directorCharacterId,
						{ cacheMode: 'no-store' }
					)
				),
			(data) => data.sovereignty_hubs,
			'sovereignty-hubs'
		)
		const liveStructureIds = sovereigntyHubListing.map((hub) => String(hub.id))
		const priorityQueue = await withRpcResult(
			corpData.getStructurePriorityQueue(corporationId, 'sovereignty', liveStructureIds),
			(queue) => ({
				...queue,
				newStructureIds: [...queue.newStructureIds],
				pruneCandidateIds: [...queue.pruneCandidateIds],
				syncPriorities: queue.syncPriorities.map((priority) => ({ ...priority })),
			})
		)
		const prioritizedQueue = buildPriorityQueuedEntries(
			sovereigntyHubListing,
			priorityQueue.newStructureIds,
			priorityQueue.syncPriorities,
			{ pruneCandidateIds: priorityQueue.pruneCandidateIds }
		)
		const sovereigntyHubResult = await esiFetch.fetchSovereigntyHubs(
			tokenStore,
			corporationId,
			directorCharacterId,
			{
				prioritizedEntries: prioritizedQueue.entries,
				pruneCandidateIds: prioritizedQueue.pruneCandidateIds,
			}
		)
		const collectedHubs = sovereigntyHubResult.sovereigntyHubs
		const failureCount = sovereigntyHubResult.failureCount
		const rateLimitFailureCount = sovereigntyHubResult.rateLimitFailureCount
		const nonRateLimitFailureCount = sovereigntyHubResult.nonRateLimitFailureCount

		if (collectedHubs.length === 0) {
			return {
				sovereigntySystems,
				sovereigntyHubs: [],
				pruneCandidateIds: [...sovereigntyHubResult.pruneCandidateIds],
				failures: sovereigntyHubResult.failures,
				failureCount,
				rateLimitFailureCount,
				nonRateLimitFailureCount,
			}
		}

		const universe = getStub<Universe>(env.UNIVERSE, 'default')
		const systemGeography = await universe.resolveSolarSystemsByIds([
			...new Set(collectedHubs.map((hub) => hub.system_id)),
		])
		try {
			const allianceBySystemId = buildSovereigntyAllianceBySystemId(sovereigntySystems)
			const enrichedSovereigntyHubs = collectedHubs.map((hub) => ({
				...hub,
				system_name: systemGeography[hub.system_id]?.solarSystemName ?? hub.system_name ?? null,
				controller_alliance_id: allianceBySystemId.get(hub.system_id) ?? null,
			}))

			logger.debug('[StructuresStep] Fetched sovereignty structure enrichment', {
				corporationId,
				sovereigntySystems: sovereigntySystems.length,
				sovereigntyHubs: collectedHubs.length,
				failureCount,
			})

			return {
				sovereigntySystems,
				sovereigntyHubs: enrichedSovereigntyHubs,
				pruneCandidateIds: prioritizedQueue.pruneCandidateIds,
				failures: sovereigntyHubResult.failures,
				failureCount,
				rateLimitFailureCount,
				nonRateLimitFailureCount,
			}
		} finally {
			disposeRpcResult(systemGeography)
		}
	} catch (error) {
		if (shouldSuppressDirectorUnhealthyOnStructureEnrichmentAuthFailure(error)) {
			throw createStructureEnrichmentScopeMismatchError('sovereignty-hubs')
		}
		throw error
	}
}

export async function fetchSkyhookEnrichment(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<SkyhookEnrichmentData | null> {
	try {
		const corpData = getCorporationDataStub(env, corporationId)
		const tokenStore = createTokenStore(env)
		const skyhookListing = await fetchStructureListing(
			(page) =>
				fetchListingPage(
					tokenStore.fetchEsi<{ skyhooks: Array<{ id: number; planet_id: number }> }>(
						`/corporations/${corporationId}/structures/skyhooks${page === 1 ? '' : `?page=${page}`}`,
						directorCharacterId,
						{ cacheMode: 'no-store' }
					)
				),
			(data) => data.skyhooks,
			'skyhooks'
		)
		const liveStructureIds = skyhookListing.map((skyhook) => String(skyhook.id))
		const priorityQueue = await withRpcResult(
			corpData.getStructurePriorityQueue(corporationId, 'skyhooks', liveStructureIds),
			(queue) => ({
				...queue,
				newStructureIds: [...queue.newStructureIds],
				pruneCandidateIds: [...queue.pruneCandidateIds],
				syncPriorities: queue.syncPriorities.map((priority) => ({ ...priority })),
			})
		)
		const prioritizedQueue = buildPriorityQueuedEntries(
			skyhookListing,
			priorityQueue.newStructureIds,
			priorityQueue.syncPriorities,
			{ pruneCandidateIds: priorityQueue.pruneCandidateIds }
		)
		const skyhookResult = await esiFetch.fetchCorporationSkyhooks(
			tokenStore,
			corporationId,
			directorCharacterId,
			{
				prioritizedEntries: prioritizedQueue.entries,
				pruneCandidateIds: prioritizedQueue.pruneCandidateIds,
			}
		)
		const skyhooks = skyhookResult.skyhooks
		const failureCount = skyhookResult.failureCount
		const rateLimitFailureCount = skyhookResult.rateLimitFailureCount
		const nonRateLimitFailureCount = skyhookResult.nonRateLimitFailureCount

		logger.debug('[StructuresStep] Fetched skyhook enrichment', {
			corporationId,
			skyhooks: skyhooks.length,
			failureCount,
		})

		return {
			skyhooks,
			pruneCandidateIds: prioritizedQueue.pruneCandidateIds,
			failures: skyhookResult.failures,
			failureCount,
			rateLimitFailureCount,
			nonRateLimitFailureCount,
		}
	} catch (error) {
		if (shouldSuppressDirectorUnhealthyOnStructureEnrichmentAuthFailure(error)) {
			throw createStructureEnrichmentScopeMismatchError('skyhooks')
		}
		throw error
	}
}

export async function markStructureSyncFailureReason(
	env: Env,
	corporationId: string,
	target: StructureSyncFailureTarget,
	failureReason: string
): Promise<void> {
	const corpData = getCorporationDataStub(env, corporationId)
	await corpData.markStructureSyncFailureReason(corporationId, target, failureReason)

	logger.warn('[StructuresStep] Marked structure sync failure reason', {
		corporationId,
		target,
		failureReason,
	})
}

export async function markStructureEnrichmentSyncFailure(
	env: Env,
	corporationId: string,
	target: StructureEnrichmentSyncTarget,
	failureReason: string
): Promise<void> {
	const mappedTarget = target === 'sovereignty-hubs' ? 'sovereignty' : 'skyhooks'
	await markStructureSyncFailureReason(env, corporationId, mappedTarget, failureReason)
}

export async function storeSovereigntyEnrichment(
	env: Env,
	corporationId: string,
	enrichment: SovereigntyEnrichmentData
): Promise<void> {
	const corpData = getCorporationDataStub(env, corporationId)

	await Promise.all([
		enrichment.sovereigntySystems
			? corpData.storeSovereigntySystems(corporationId, enrichment.sovereigntySystems)
			: Promise.resolve(),
		corpData.storeSovereigntyHubs(corporationId, enrichment.sovereigntyHubs, {
			pruneCandidateIds: enrichment.pruneCandidateIds,
		}),
	])
	if (enrichment.failures.length > 0) {
		await corpData.markStructureEnrichmentFailures(
			corporationId,
			'sovereignty-hubs',
			enrichment.failures
		)
	}

	logger.info('[StructuresStep] Stored sovereignty enrichment', {
		corporationId,
		sovereigntySystems: enrichment.sovereigntySystems?.length ?? 0,
		sovereigntyHubs: enrichment.sovereigntyHubs.length,
	})
}

export async function storeSkyhookEnrichment(
	env: Env,
	corporationId: string,
	enrichment: SkyhookEnrichmentData
): Promise<SkyhookStoreResult> {
	const corpData = getCorporationDataStub(env, corporationId)
	const result = await withRpcResult(
		corpData.storeSkyhooks(corporationId, enrichment.skyhooks, {
			pruneCandidateIds: enrichment.pruneCandidateIds,
		}),
		({ prunedCount }) => ({ prunedCount })
	)
	if (enrichment.failures.length > 0) {
		await corpData.markStructureEnrichmentFailures(corporationId, 'skyhooks', enrichment.failures)
	}

	logger.info('[StructuresStep] Stored skyhook enrichment', {
		corporationId,
		skyhooks: enrichment.skyhooks.length,
		prunedSkyhooks: result.prunedCount,
	})

	return result
}

export async function fetchMiningExtractionEnrichment(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<MiningExtractionsData> {
	const tokenStore = createTokenStore(env)
	const miningExtractions = await esiFetch.fetchCorporationMiningExtractions(
		tokenStore,
		corporationId,
		directorCharacterId
	)

	logger.debug('[StructuresStep] Fetched mining extraction enrichment', {
		corporationId,
		miningExtractions: miningExtractions.length,
	})

	return miningExtractions
}

export async function storeMiningExtractionEnrichment(
	env: Env,
	corporationId: string,
	enrichment: MiningExtractionsData,
	options: {
		pruneCandidateIds?: readonly string[]
		historyExtractions?: ReadonlyArray<MiningExtractionsData[number]>
	} = {}
): Promise<void> {
	const corpData = getCorporationDataStub(env, corporationId)
	await corpData.storeMiningExtractions(corporationId, enrichment, options)

	logger.info('[StructuresStep] Stored mining extraction enrichment', {
		corporationId,
		miningExtractions: enrichment.length,
	})
}
