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
import type { SkyhookStoreResult } from '@repo/eve-corporation-data'

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
	sovereigntyHubs: SovereigntyHubsData
}

export interface SkyhookEnrichmentData {
	skyhooks: CorporationSkyhooksData
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
	const tokenStore = createTokenStore(env)

	try {
		const sovereigntyHubs = await esiFetch.fetchSovereigntyHubs(
			tokenStore,
			corporationId,
			directorCharacterId
		)
		const universe = getStub<Universe>(env.UNIVERSE, 'default')
		const systemGeography =
			sovereigntyHubs.length > 0
				? await universe.resolveSolarSystemsByIds(
						[...new Set(sovereigntyHubs.map((hub) => hub.system_id))]
					)
				: {}
		let sovereigntySystems = await readSharedSovereigntySystemsByIds(
			env,
			sovereigntyHubs.map((hub) => hub.system_id)
		)
		if (!sovereigntySystems) {
			logger.warn('[StructuresStep] Shared sovereignty snapshot missing or stale; rewarming cache', {
				corporationId,
			})
			sovereigntySystems = await refreshSharedSovereigntySystems(env)
		}

		const allianceBySystemId = new Map(
			sovereigntySystems
				.filter((system) => system.claim_type === 'alliance' && system.alliance_id !== undefined)
				.map((system) => [system.system_id, system.alliance_id ?? null])
		)
		const enrichedSovereigntyHubs = sovereigntyHubs.map((hub) => ({
			...hub,
			name: systemGeography[hub.system_id]?.solarSystemName ?? hub.name ?? null,
			system_name: systemGeography[hub.system_id]?.solarSystemName ?? hub.system_name ?? null,
			controller_alliance_id: allianceBySystemId.get(hub.system_id) ?? null,
		}))

		logger.debug('[StructuresStep] Fetched sovereignty structure enrichment', {
			corporationId,
			sovereigntySystems: sovereigntySystems?.length ?? 0,
			sovereigntyHubs: sovereigntyHubs.length,
		})

		return {
			sovereigntySystems,
			sovereigntyHubs: enrichedSovereigntyHubs,
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
	const tokenStore = createTokenStore(env)

	try {
		const skyhooks = await esiFetch.fetchCorporationSkyhooks(
			tokenStore,
			corporationId,
			directorCharacterId
		)

		logger.debug('[StructuresStep] Fetched skyhook enrichment', {
			corporationId,
			skyhooks: skyhooks.length,
		})

		return {
			skyhooks,
		}
	} catch (error) {
		if (shouldSuppressDirectorUnhealthyOnStructureEnrichmentAuthFailure(error)) {
			throw createStructureEnrichmentScopeMismatchError('skyhooks')
		}
		throw error
	}
}

export async function markStructureEnrichmentSyncFailure(
	env: Env,
	corporationId: string,
	target: StructureEnrichmentSyncTarget,
	failureReason: string
): Promise<void> {
	const corpData = getCorporationDataStub(env, corporationId)
	await corpData.markStructureEnrichmentSyncFailure(corporationId, target, failureReason)

	logger.warn('[StructuresStep] Marked structure enrichment sync failure', {
		corporationId,
		target,
		failureReason,
	})
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
		corpData.storeSovereigntyHubs(corporationId, enrichment.sovereigntyHubs),
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
	const result = await corpData.storeSkyhooks(corporationId, enrichment.skyhooks)

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
