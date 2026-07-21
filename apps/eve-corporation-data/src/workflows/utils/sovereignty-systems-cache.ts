import * as esiFetch from '../../services/esi-fetch'
import { createTokenStore, getGlobalCorporationDataStub } from './services'

import type { EsiSovereigntySystem } from '@repo/eve-corporation-data'
import type { Env } from '../../context'

const SHARED_SOVEREIGNTY_SYSTEMS_CACHE_TTL_SECONDS = 60 * 60
const SHARED_SOVEREIGNTY_SYSTEMS_REFRESH_RETRY_DELAYS_MS = [250, 500, 1000]

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

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
	const globalCorpData = getGlobalCorporationDataStub(env)
	const freshSnapshot = await globalCorpData.getSharedSovereigntySystemsSnapshot(
		SHARED_SOVEREIGNTY_SYSTEMS_CACHE_TTL_SECONDS
	)
	if (freshSnapshot) {
		return freshSnapshot
	}

	const leaseToken = await globalCorpData.acquireSharedSovereigntySystemsRefreshLease()

	if (leaseToken) {
		try {
			await globalCorpData.clearSharedSovereigntySystems()
			const tokenStore = createTokenStore(env)
			const sovereigntySystems = await esiFetch.fetchSovereigntySystems(tokenStore)
			await globalCorpData.storeSharedSovereigntySystems(sovereigntySystems)
			return sovereigntySystems
		} finally {
			await globalCorpData.releaseSharedSovereigntySystemsRefreshLease(leaseToken)
		}
	}

	for (const delayMs of SHARED_SOVEREIGNTY_SYSTEMS_REFRESH_RETRY_DELAYS_MS) {
		const snapshot = await globalCorpData.getSharedSovereigntySystemsSnapshot(
			SHARED_SOVEREIGNTY_SYSTEMS_CACHE_TTL_SECONDS
		)
		if (snapshot) {
			return snapshot
		}
		await sleep(delayMs)
	}

	return (
		(await globalCorpData.getSharedSovereigntySystemsSnapshot(
			SHARED_SOVEREIGNTY_SYSTEMS_CACHE_TTL_SECONDS
		)) ?? []
	)
}
