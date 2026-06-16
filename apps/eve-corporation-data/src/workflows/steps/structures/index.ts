import { logger } from '@repo/hono-helpers'

import * as esiFetch from '../../../services/esi-fetch'
import { shouldSuppressDirectorUnhealthyOnStructureEnrichmentAuthFailure } from '../../utils/structure-enrichment-auth'
import { createTokenStore, getCorporationDataStub } from '../../utils/services'
import { readSharedSovereigntySystemsByIds } from '../../utils/sovereignty-systems-cache'

import type { Env } from '../../../context'

export type StructuresData = Awaited<ReturnType<typeof esiFetch.fetchStructures>>
export type SovereigntySystemsData = Awaited<ReturnType<typeof esiFetch.fetchSovereigntySystems>>
export type SovereigntyHubsData = Awaited<ReturnType<typeof esiFetch.fetchSovereigntyHubs>>
export type CorporationSkyhooksData = Awaited<ReturnType<typeof esiFetch.fetchCorporationSkyhooks>>
export type MiningStatesData = Awaited<ReturnType<typeof esiFetch.deriveMiningStatesFromSkyhooks>>

export interface StructuresEnrichmentData {
	sovereigntySystems: SovereigntySystemsData | null
	sovereigntyHubs: SovereigntyHubsData
	skyhooks: CorporationSkyhooksData
	miningStates: MiningStatesData
}

export interface StructureSovereigntyEnrichmentData {
	sovereigntySystems: SovereigntySystemsData | null
	sovereigntyHubs: SovereigntyHubsData
}

export interface StructureSkyhookEnrichmentData {
	skyhooks: CorporationSkyhooksData
	miningStates: MiningStatesData
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

export async function fetchStructureEnrichment(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<StructuresEnrichmentData> {
	const [sovereigntyEnrichment, skyhookEnrichment] = await Promise.all([
		fetchStructureSovereigntyEnrichment(env, corporationId, directorCharacterId),
		fetchStructureSkyhookEnrichment(env, corporationId, directorCharacterId),
	])

	return {
		sovereigntySystems: sovereigntyEnrichment?.sovereigntySystems ?? null,
		sovereigntyHubs: sovereigntyEnrichment?.sovereigntyHubs ?? [],
		skyhooks: skyhookEnrichment?.skyhooks ?? [],
		miningStates: skyhookEnrichment?.miningStates ?? [],
	}
}

export async function fetchStructureSovereigntyEnrichment(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<StructureSovereigntyEnrichmentData | null> {
	const tokenStore = createTokenStore(env)

	try {
		const sovereigntyHubs = await esiFetch.fetchSovereigntyHubs(
			tokenStore,
			corporationId,
			directorCharacterId
		)
		const sovereigntySystems = await readSharedSovereigntySystemsByIds(
			env,
			sovereigntyHubs.map((hub) => hub.system_id)
		)
		if (!sovereigntySystems) {
			logger.warn(
				'[StructuresStep] Shared sovereignty snapshot missing or stale; skipping system enrichment',
				{ corporationId }
			)
		}

		const allianceBySystemId = new Map(
			(sovereigntySystems ?? [])
				.filter((system) => system.claim_type === 'alliance' && system.alliance_id !== undefined)
				.map((system) => [system.system_id, system.alliance_id ?? null])
		)
		const enrichedSovereigntyHubs = sovereigntyHubs.map((hub) => ({
			...hub,
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
			logger.warn('[StructuresStep] Skipping sovereignty enrichment after scope-gated auth failure', {
				corporationId,
				error: error instanceof Error ? error.message : String(error),
			})
			// TODO: once the new structure scopes are fully deployed, treat these as director failures again.
			return null
		}
		throw error
	}
}

export async function fetchStructureSkyhookEnrichment(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<StructureSkyhookEnrichmentData | null> {
	const tokenStore = createTokenStore(env)

	try {
		const skyhooks = await esiFetch.fetchCorporationSkyhooks(
			tokenStore,
			corporationId,
			directorCharacterId
		)
		const mergedSkyhooks = skyhooks.map((skyhook) => ({ ...skyhook }))
		const miningStates = esiFetch.deriveMiningStatesFromSkyhooks(mergedSkyhooks)

		logger.debug('[StructuresStep] Fetched skyhook enrichment', {
			corporationId,
			skyhooks: mergedSkyhooks.length,
			miningStates: miningStates.length,
		})

		return {
			skyhooks: mergedSkyhooks,
			miningStates,
		}
	} catch (error) {
		if (shouldSuppressDirectorUnhealthyOnStructureEnrichmentAuthFailure(error)) {
			logger.warn('[StructuresStep] Skipping skyhook enrichment after scope-gated auth failure', {
				corporationId,
				error: error instanceof Error ? error.message : String(error),
			})
			// TODO: once the new structure scopes are fully deployed, treat these as director failures again.
			return null
		}
		throw error
	}
}

export async function storeStructureEnrichment(
	env: Env,
	corporationId: string,
	enrichment: StructuresEnrichmentData
): Promise<void> {
	const corpData = getCorporationDataStub(env, corporationId)
	const writes = [
		enrichment.sovereigntySystems
			? corpData.storeSovereigntySystems(corporationId, enrichment.sovereigntySystems)
			: Promise.resolve(),
		corpData.storeSovereigntyHubs(corporationId, enrichment.sovereigntyHubs),
		corpData.storeSkyhooks(corporationId, enrichment.skyhooks),
		corpData.storeMiningStates(corporationId, enrichment.miningStates),
	]
	await Promise.all(writes)

	logger.info('[StructuresStep] Stored structure enrichment', {
		corporationId,
		sovereigntySystems: enrichment.sovereigntySystems?.length ?? 0,
		sovereigntyHubs: enrichment.sovereigntyHubs.length,
		skyhooks: enrichment.skyhooks.length,
		miningStates: enrichment.miningStates.length,
	})
}

export async function storeSovereigntyEnrichment(
	env: Env,
	corporationId: string,
	enrichment: StructureSovereigntyEnrichmentData
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
	enrichment: StructureSkyhookEnrichmentData
): Promise<void> {
	const corpData = getCorporationDataStub(env, corporationId)
	await Promise.all([
		corpData.storeSkyhooks(corporationId, enrichment.skyhooks),
		corpData.storeMiningStates(corporationId, enrichment.miningStates),
	])

	logger.info('[StructuresStep] Stored skyhook enrichment', {
		corporationId,
		skyhooks: enrichment.skyhooks.length,
		miningStates: enrichment.miningStates.length,
	})
}
