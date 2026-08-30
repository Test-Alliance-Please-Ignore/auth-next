import { disposeRpcResult, getStub, withRpcResult } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import * as esiFetch from '../../../services/esi-fetch'
import {
	buildPriorityQueuedEntries,
	STRUCTURE_ENRICHMENT_PRIORITY_LIMIT,
} from '../../../services/structure-priority'
import { getCorporationDataStub, getCorporationEsi } from '../../utils/services'
import {
	readSharedSovereigntySystemsByIds,
	readSharedSovereigntySystemsForCorporation,
	refreshSharedSovereigntySystems,
} from '../../utils/sovereignty-systems-cache'
import {
	createStructureEnrichmentScopeMismatchError,
	shouldSuppressDirectorUnhealthyOnStructureEnrichmentAuthFailure,
} from '../../utils/structure-enrichment-auth'

import type { EsiResult } from '@repo/esi'
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

export interface PosDetailEnrichmentData {
	details: esiFetch.PosDetailEnrichmentResult['details']
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

function fetchListingPage<T>(request: Promise<EsiResult<T>>): Promise<PaginatedEsiResponse<T>> {
	return request.then((response) => ({
		data: response.data,
		pages: response.meta.pages ?? undefined,
		page: response.meta.page ?? undefined,
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
	directorCharacterId: string,
	posDirectorCharacterId: string | null = directorCharacterId
): Promise<StructuresData> {
	const structures = await esiFetch.fetchStructures(
		getCorporationEsi(env, corporationId),
		corporationId,
		directorCharacterId,
		posDirectorCharacterId
	)

	logger.debug('[StructuresStep] Fetched structures', {
		corporationId,
		count: structures.structures.length,
		posListingComplete: structures.posListingComplete,
	})

	return structures
}

export async function fetchUpwellStructures(
	env: Env,
	corporationId: string,
	_directorCharacterId: string
): Promise<StructuresData['structures']> {
	return await esiFetch.fetchUpwellStructures(getCorporationEsi(env, corporationId), corporationId)
}

export async function fetchPosStructures(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<StructuresData> {
	return await esiFetch.fetchPosStructures(
		getCorporationEsi(env, corporationId),
		corporationId,
		directorCharacterId
	)
}

export async function storeStructures(
	env: Env,
	corporationId: string,
	structures: StructuresData
): Promise<void> {
	const corpData = getCorporationDataStub(env, corporationId)
	await corpData.storeStructures(corporationId, structures.structures, {
		posListingComplete: structures.posListingComplete,
	})

	logger.info('[StructuresStep] Stored structures', {
		corporationId,
		count: structures.structures.length,
	})
}

export async function fetchPosDetailEnrichment(
	env: Env,
	corporationId: string,
	structures: StructuresData,
	directorCharacterId: string
): Promise<PosDetailEnrichmentData | null> {
	if (!structures.posListingComplete) {
		logger.info('[StructuresStep] Skipping POS detail enrichment because listing was incomplete', {
			corporationId,
		})
		return null
	}

	const posStructures = structures.structures.filter((structure) => structure.profile_id === 'pos')
	if (posStructures.length === 0) {
		return null
	}

	const corpData = getCorporationDataStub(env, corporationId)
	const priorityQueue = await withRpcResult(
		corpData.getStructurePriorityQueue(
			corporationId,
			'poses',
			posStructures.map((structure) => String(structure.structure_id))
		),
		(queue) => ({
			...queue,
			newStructureIds: [...queue.newStructureIds],
			pruneCandidateIds: [...queue.pruneCandidateIds],
			syncPriorities: queue.syncPriorities.map((priority) => ({ ...priority })),
		})
	)
	const prioritizedEntries = buildPriorityQueuedEntries(
		posStructures.map((structure) => ({
			id: String(structure.structure_id),
			structure,
		})),
		priorityQueue.newStructureIds,
		priorityQueue.syncPriorities,
		{
			pruneCandidateIds: priorityQueue.pruneCandidateIds,
			maxEntries: STRUCTURE_ENRICHMENT_PRIORITY_LIMIT,
		}
	).entries
	const result = await esiFetch.fetchPosDetailEnrichment(
		getCorporationEsi(env, corporationId),
		corporationId,
		{
			directorCharacterId,
			prioritizedEntries: prioritizedEntries.map(({ index, entry }) => ({
				index,
				entry: {
					id: entry.id,
					system_id: entry.structure.system_id,
				},
			})),
		}
	)

	logger.debug('[StructuresStep] Fetched POS detail enrichment', {
		corporationId,
		posCount: posStructures.length,
		detailCount: result.details.length,
		failureCount: result.failureCount,
	})

	return result
}

export async function storePosDetailEnrichment(
	env: Env,
	corporationId: string,
	enrichment: PosDetailEnrichmentData
): Promise<void> {
	const corpData = getCorporationDataStub(env, corporationId)
	if (enrichment.details.length > 0) {
		await corpData.storePosDetailEnrichment(corporationId, enrichment.details)
	}
	if (enrichment.failures.length > 0) {
		await corpData.markStructureEnrichmentFailures(corporationId, 'poses', enrichment.failures)
	}
}

export async function fetchSovereigntyEnrichment(
	env: Env,
	corporationId: string,
	_directorCharacterId: string
): Promise<SovereigntyEnrichmentData | null> {
	try {
		const corpData = getCorporationDataStub(env, corporationId)
		const esi = getCorporationEsi(env, corporationId)
		const sovereigntyHubListing = await fetchStructureListing(
			(page) => fetchListingPage(esi.fetchCorporationSovereigntyHubsPage(corporationId, page)),
			(data) => data.sovereignty_hubs,
			'sovereignty-hubs'
		)
		const liveSystemIds = [
			...new Set(sovereigntyHubListing.map((hub) => String(hub.solar_system_id))),
		]
		let sovereigntySystems =
			liveSystemIds.length > 0
				? await readSharedSovereigntySystemsByIds(env, corporationId, liveSystemIds)
				: await readSharedSovereigntySystemsForCorporation(env, corporationId)
		if (!sovereigntySystems) {
			logger.info(
				'[StructuresStep] Shared sovereignty snapshot missing or stale; rewarming cache',
				{
					corporationId,
				}
			)
			await refreshSharedSovereigntySystems(env)
			sovereigntySystems =
				liveSystemIds.length > 0
					? await readSharedSovereigntySystemsByIds(env, corporationId, liveSystemIds)
					: await readSharedSovereigntySystemsForCorporation(env, corporationId)
			if (!sovereigntySystems) {
				throw new Error('Complete shared sovereignty snapshot was unavailable after refresh')
			}
		}
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
		const sovereigntyHubResult = await esiFetch.fetchSovereigntyHubs(esi, corporationId, {
			prioritizedEntries: prioritizedQueue.entries,
			pruneCandidateIds: prioritizedQueue.pruneCandidateIds,
		})
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
	_directorCharacterId: string
): Promise<SkyhookEnrichmentData | null> {
	try {
		const corpData = getCorporationDataStub(env, corporationId)
		const esi = getCorporationEsi(env, corporationId)
		const skyhookListing = await fetchStructureListing(
			(page) => fetchListingPage(esi.fetchCorporationSkyhooksPage(corporationId, page)),
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
		const skyhookResult = await esiFetch.fetchCorporationSkyhooks(esi, corporationId, {
			prioritizedEntries: prioritizedQueue.entries,
			pruneCandidateIds: prioritizedQueue.pruneCandidateIds,
		})
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
	const miningExtractions = await esiFetch.fetchCorporationMiningExtractions(
		getCorporationEsi(env, corporationId),
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
