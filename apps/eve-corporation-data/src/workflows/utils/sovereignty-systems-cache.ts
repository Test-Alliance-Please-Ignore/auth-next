import * as esiFetch from '../../services/esi-fetch'
import { createTokenStore, getGlobalCorporationDataStub } from './services'

import type { EsiSovereigntySystem } from '@repo/eve-corporation-data'
import type { Env } from '../../context'

const SHARED_SOVEREIGNTY_SYSTEMS_CACHE_TTL_SECONDS = 300
const SHARED_SOVEREIGNTY_SYSTEMS_CACHE_KEY = 'default'

/**
 * Read the shared sovereignty snapshot if it is still fresh enough.
 */
export async function readSharedSovereigntySystems(
	env: Env
): Promise<EsiSovereigntySystem[] | null> {
	const globalCorpData = getGlobalCorporationDataStub(env)
	return await globalCorpData.getSovereigntySystems(
		SHARED_SOVEREIGNTY_SYSTEMS_CACHE_KEY,
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
	await globalCorpData.storeSovereigntySystems(
		SHARED_SOVEREIGNTY_SYSTEMS_CACHE_KEY,
		sovereigntySystems
	)
	return sovereigntySystems
}

/**
 * Return the shared sovereignty snapshot, refreshing it only when missing or stale.
 */
export async function getSharedSovereigntySystems(env: Env): Promise<EsiSovereigntySystem[]> {
	const cachedSovereigntySystems = await readSharedSovereigntySystems(env)
	if (cachedSovereigntySystems) {
		return cachedSovereigntySystems
	}

	return await refreshSharedSovereigntySystems(env)
}
