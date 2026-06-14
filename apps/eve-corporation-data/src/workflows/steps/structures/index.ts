import { logger } from '@repo/hono-helpers'

import * as esiFetch from '../../../services/esi-fetch'
import { createTokenStore, getCorporationDataStub } from '../../utils/services'
import { getSharedSovereigntySystems } from '../../utils/sovereignty-systems-cache'

import type { Env } from '../../../context'

export type StructuresData = Awaited<ReturnType<typeof esiFetch.fetchStructures>>
export type SovereigntySystemsData = Awaited<ReturnType<typeof esiFetch.fetchSovereigntySystems>>
export type SovereigntyHubsData = Awaited<ReturnType<typeof esiFetch.fetchSovereigntyHubs>>
export type CorporationSkyhooksData = Awaited<ReturnType<typeof esiFetch.fetchCorporationSkyhooks>>
export type MiningStatesData = Awaited<ReturnType<typeof esiFetch.deriveMiningStatesFromSkyhooks>>

export interface StructuresEnrichmentData {
	sovereigntySystems: SovereigntySystemsData
	sovereigntyHubs: SovereigntyHubsData
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
	const tokenStore = createTokenStore(env)
	const sovereigntySystems = await getSharedSovereigntySystems(env)
	const [sovereigntyHubs, skyhooks] = await Promise.all([
		esiFetch.fetchSovereigntyHubs(tokenStore, corporationId, directorCharacterId),
		esiFetch.fetchCorporationSkyhooks(tokenStore, corporationId, directorCharacterId),
	])

	const allianceBySystemId = new Map(
		sovereigntySystems
			.filter((system) => system.claim_type === 'alliance' && system.alliance_id !== undefined)
			.map((system) => [system.system_id, system.alliance_id ?? null])
	)
	const enrichedSovereigntyHubs = sovereigntyHubs.map((hub) => ({
		...hub,
		controller_alliance_id: allianceBySystemId.get(hub.system_id) ?? null,
	}))

	const mergedSkyhooks = skyhooks.map((skyhook) => ({ ...skyhook }))

	const miningStates = esiFetch.deriveMiningStatesFromSkyhooks(mergedSkyhooks)

	logger.debug('[StructuresStep] Fetched structure enrichment', {
		corporationId,
		sovereigntySystems: sovereigntySystems.length,
		sovereigntyHubs: sovereigntyHubs.length,
		skyhooks: mergedSkyhooks.length,
		miningStates: miningStates.length,
	})

	return {
		sovereigntySystems,
		sovereigntyHubs: enrichedSovereigntyHubs,
		skyhooks: mergedSkyhooks,
		miningStates,
	}
}

export async function storeStructureEnrichment(
	env: Env,
	corporationId: string,
	enrichment: StructuresEnrichmentData
): Promise<void> {
	const corpData = getCorporationDataStub(env, corporationId)
	await Promise.all([
		corpData.storeSovereigntySystems(corporationId, enrichment.sovereigntySystems),
		corpData.storeSovereigntyHubs(corporationId, enrichment.sovereigntyHubs),
		corpData.storeSkyhooks(corporationId, enrichment.skyhooks),
		corpData.storeMiningStates(corporationId, enrichment.miningStates),
	])

	logger.info('[StructuresStep] Stored structure enrichment', {
		corporationId,
		sovereigntySystems: enrichment.sovereigntySystems.length,
		sovereigntyHubs: enrichment.sovereigntyHubs.length,
		skyhooks: enrichment.skyhooks.length,
		miningStates: enrichment.miningStates.length,
	})
}
