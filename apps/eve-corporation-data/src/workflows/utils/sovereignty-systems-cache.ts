import * as esiFetch from '../../services/esi-fetch'
import { createTokenStore, getGlobalCorporationDataStub } from './services'

import type { EsiSovereigntySystem } from '@repo/eve-corporation-data'
import type { Env } from '../../context'

const SHARED_SOVEREIGNTY_SYSTEMS_CACHE_TTL_SECONDS = 300

/**
 * Read the shared sovereignty snapshot subset for the requested system IDs if it is still fresh enough.
 */
export async function readSharedSovereigntySystemsByIds(
	env: Env,
	systemIds: string[]
): Promise<EsiSovereigntySystem[] | null> {
	const globalCorpData = getGlobalCorporationDataStub(env)
	return await globalCorpData.getSharedSovereigntySystemsByIds(
		systemIds,
		SHARED_SOVEREIGNTY_SYSTEMS_CACHE_TTL_SECONDS
	)
}

/**
 * Fetch the live sovereignty snapshot and write it to the shared cache.
 */
export async function refreshSharedSovereigntySystems(
	env: Env
): Promise<EsiSovereigntySystem[]> {
	const tokenStore = createTokenStore(env)
	const sovereigntySystems = await esiFetch.fetchSovereigntySystems(tokenStore)
	const globalCorpData = getGlobalCorporationDataStub(env)
	await globalCorpData.storeSharedSovereigntySystems(sovereigntySystems)
	return sovereigntySystems
}
