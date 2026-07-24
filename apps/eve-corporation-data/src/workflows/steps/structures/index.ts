import { logger } from '@repo/hono-helpers'
import { getStub } from '@repo/do-utils'

import * as esiFetch from '../../../services/esi-fetch'
import {
	createStructureEnrichmentScopeMismatchError,
	shouldSuppressDirectorUnhealthyOnStructureEnrichmentAuthFailure,
	type StructureEnrichmentSyncTarget,
} from '../../utils/structure-enrichment-auth'
import { createTokenStore, getCorporationDataStub } from '../../utils/services'
import {
	readSharedSovereigntySystemsByIds,
	refreshSharedSovereigntySystems,
} from '../../utils/sovereignty-systems-cache'
import type { Universe } from '@repo/universe'
import type {
	SkyhookStoreResult,
	SovereigntyHubSyncPriority,
	StructureSyncFailureTarget,
} from '@repo/eve-corporation-data'
import { buildPriorityQueuedEntries } from '../../../services/structure-priority'

import type { Env } from '../../../context'

export type StructuresData = Awaited<ReturnType<typeof esiFetch.fetchStructures>>
export type SovereigntySystemsData = Awaited<ReturnType<typeof esiFetch.fetchSovereigntySystems>>
export type SovereigntyHubsData = Awaited<ReturnType<typeof esiFetch.fetchSovereigntyHubs>>
export type CorporationSkyhooksData = Awaited<ReturnType<typeof esiFetch.fetchCorporationSkyhooks>>
export type MiningExtractionsData = Awaited<
	ReturnType<typeof esiFetch.fetchCorporationMiningExtractions>
>

export interface SovereigntyEnrichmentData {
	sovereigntySystems: SovereigntySystemsData | null
	sovereigntyHubs: SovereigntyHubsData['sovereigntyHubs']
	pruneCandidateIds: string[]
	failureCount: number
	rateLimitFailureCount: number
	nonRateLimitFailureCount: number
}

export interface SkyhookEnrichmentData {
	skyhooks: CorporationSkyhooksData['skyhooks']
	pruneCandidateIds: string[]
	failureCount: number
	rateLimitFailureCount: number
	nonRateLimitFailureCount: number
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
		const syncPriorities: SovereigntyHubSyncPriority[] =
			await corpData.getSovereigntyHubSyncPriorities(corporationId)
		const tokenStore = createTokenStore(env)
		const firstPass = await tokenStore.fetchEsi<{ sovereignty_hubs: Array<{ id: number; solar_system_id: number }> }>(
			`/corporations/${corporationId}/structures/sovereignty-hubs?page=1`,
			directorCharacterId,
			{ cacheMode: 'no-store' }
		)
		const sovereigntyHubListing = [...firstPass.data.sovereignty_hubs]
		for (let page = 2; page <= (firstPass.pages ?? 1); page += 1) {
			const pageResponse = await tokenStore.fetchEsi<{ sovereignty_hubs: Array<{ id: number; solar_system_id: number }> }>(
				`/corporations/${corporationId}/structures/sovereignty-hubs?page=${page}`,
				directorCharacterId,
				{ cacheMode: 'no-store' }
			)
			sovereigntyHubListing.push(...pageResponse.data.sovereignty_hubs)
		}
		const liveStructureIds = sovereigntyHubListing.map((hub) => String(hub.id))
		const newStructureIds = await corpData.getMissingStructureIdsForPriorityQueue(
			corporationId,
			'sovereignty',
			liveStructureIds
		)
		const prioritizedQueue = buildPriorityQueuedEntries(
			sovereigntyHubListing,
			newStructureIds,
			syncPriorities
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
				sovereigntySystems: null,
				sovereigntyHubs: [],
				pruneCandidateIds: [...sovereigntyHubResult.pruneCandidateIds],
				failureCount,
				rateLimitFailureCount,
				nonRateLimitFailureCount,
			}
		}

		const universe = getStub<Universe>(env.UNIVERSE, 'default')
		const systemGeography =
			await universe.resolveSolarSystemsByIds([...new Set(collectedHubs.map((hub) => hub.system_id))])
		let sovereigntySystems = await readSharedSovereigntySystemsByIds(
			env,
			collectedHubs.map((hub) => hub.system_id)
		)
		if (!sovereigntySystems) {
			logger.warn('[StructuresStep] Shared sovereignty snapshot missing or stale; rewarming cache', {
				corporationId,
			})
			sovereigntySystems = await refreshSharedSovereigntySystems(env)
		}

		const allianceBySystemId = buildSovereigntyAllianceBySystemId(sovereigntySystems)
		const enrichedSovereigntyHubs = collectedHubs.map((hub) => ({
			...hub,
			system_name: systemGeography[hub.system_id]?.solarSystemName ?? hub.system_name ?? null,
			controller_alliance_id: allianceBySystemId.get(hub.system_id) ?? null,
		}))

		logger.debug('[StructuresStep] Fetched sovereignty structure enrichment', {
			corporationId,
			sovereigntySystems: sovereigntySystems?.length ?? 0,
			sovereigntyHubs: collectedHubs.length,
			failureCount,
		})

		return {
			sovereigntySystems,
			sovereigntyHubs: enrichedSovereigntyHubs,
			pruneCandidateIds: prioritizedQueue.pruneCandidateIds,
			failureCount,
			rateLimitFailureCount,
			nonRateLimitFailureCount,
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
		const syncPriorities = await corpData.getSkyhookSyncPriorities(corporationId)
		const tokenStore = createTokenStore(env)
		const firstPass = await tokenStore.fetchEsi<{ skyhooks: Array<{ id: number; planet_id: number }> }>(
			`/corporations/${corporationId}/structures/skyhooks`,
			directorCharacterId,
			{ cacheMode: 'no-store' }
		)
		const skyhookListing = [...firstPass.data.skyhooks]
		for (let page = 2; page <= (firstPass.pages ?? 1); page += 1) {
			const pageResponse = await tokenStore.fetchEsi<{ skyhooks: Array<{ id: number; planet_id: number }> }>(
				`/corporations/${corporationId}/structures/skyhooks?page=${page}`,
				directorCharacterId,
				{ cacheMode: 'no-store' }
			)
			skyhookListing.push(...pageResponse.data.skyhooks)
		}
		const liveStructureIds = skyhookListing.map((skyhook) => String(skyhook.id))
		const newStructureIds = await corpData.getMissingStructureIdsForPriorityQueue(
			corporationId,
			'skyhooks',
			liveStructureIds
		)
		const prioritizedQueue = buildPriorityQueuedEntries(skyhookListing, newStructureIds, syncPriorities)
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
	const result = await corpData.storeSkyhooks(corporationId, enrichment.skyhooks, {
		pruneCandidateIds: enrichment.pruneCandidateIds,
	})

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
	enrichment: MiningExtractionsData
): Promise<void> {
	const corpData = getCorporationDataStub(env, corporationId)
	await corpData.storeMiningExtractions(corporationId, enrichment)

	logger.info('[StructuresStep] Stored mining extraction enrichment', {
		corporationId,
		miningExtractions: enrichment.length,
	})
}
