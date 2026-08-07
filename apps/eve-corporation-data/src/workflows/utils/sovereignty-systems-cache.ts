import { withRpcResult } from '@repo/do-utils'

import * as esiFetch from '../../services/esi-fetch'
import { createTokenStore, getGlobalCorporationDataStub } from './services'

import type { EsiSovereigntySystem } from '@repo/eve-corporation-data'
import type { Env } from '../../context'

const SHARED_SOVEREIGNTY_SYSTEMS_CACHE_TTL_SECONDS = 60 * 60
const SHARED_SOVEREIGNTY_SYSTEMS_REFRESH_RETRY_DELAYS_MS = [250, 500, 1000, 2000, 4000, 8000, 16000]

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

/**
 * Read the complete sovereignty-system slice owned by a corporation if the shared snapshot is fresh.
 */
export async function readSharedSovereigntySystemsForCorporation(
	env: Env,
	corporationId: string
): Promise<EsiSovereigntySystem[] | null> {
	const globalCorpData = getGlobalCorporationDataStub(env)
	return await withRpcResult(
		globalCorpData.getSharedSovereigntySystemsForCorporation(
			corporationId,
			SHARED_SOVEREIGNTY_SYSTEMS_CACHE_TTL_SECONDS
		),
		(systems) => systems?.map((system) => ({ ...system })) ?? null
	)
}

/**
 * Ensure the full sovereignty snapshot is available before structure fanout.
 */
export async function ensureSharedSovereigntySystems(env: Env): Promise<void> {
	const globalCorpData = getGlobalCorporationDataStub(env)
	const isFresh = await globalCorpData.hasFreshSharedSovereigntySystems(
		SHARED_SOVEREIGNTY_SYSTEMS_CACHE_TTL_SECONDS
	)
	if (!isFresh) {
		await refreshSharedSovereigntySystems(env)
	}
}

/**
 * Fetch the live sovereignty snapshot and write it to the shared cache.
 */
export async function refreshSharedSovereigntySystems(env: Env): Promise<void> {
	const globalCorpData = getGlobalCorporationDataStub(env)
	const leaseToken = await globalCorpData.acquireSharedSovereigntySystemsRefreshLease()

	if (leaseToken) {
		try {
			const tokenStore = createTokenStore(env)
			const sovereigntySystems = await esiFetch.fetchSovereigntySystems(tokenStore)
			await globalCorpData.storeSharedSovereigntySystems(sovereigntySystems)
		} finally {
			await globalCorpData.releaseSharedSovereigntySystemsRefreshLease(leaseToken)
		}
		return
	}

	if (
		await globalCorpData.hasFreshSharedSovereigntySystems(
			SHARED_SOVEREIGNTY_SYSTEMS_CACHE_TTL_SECONDS
		)
	) {
		return
	}

	for (const delayMs of SHARED_SOVEREIGNTY_SYSTEMS_REFRESH_RETRY_DELAYS_MS) {
		await sleep(delayMs)
		const isFresh = await globalCorpData.hasFreshSharedSovereigntySystems(
			SHARED_SOVEREIGNTY_SYSTEMS_CACHE_TTL_SECONDS
		)
		if (isFresh) {
			return
		}
	}

	const isFresh = await globalCorpData.hasFreshSharedSovereigntySystems(
		SHARED_SOVEREIGNTY_SYSTEMS_CACHE_TTL_SECONDS
	)
	if (isFresh) {
		return
	}

	throw new Error('Failed to refresh shared sovereignty systems snapshot')
}
