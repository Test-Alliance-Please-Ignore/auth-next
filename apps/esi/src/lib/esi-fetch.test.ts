import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EsiRequestClient } from '@repo/esi'
import { EsiRateLimitStore } from '@repo/esi-rate-limit'

import { EsiFetcher } from './esi-fetch'

import type { Env } from '../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

describe('EsiFetcher cache policy', () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it('bypasses cache reads and writes when cacheMode is no-store', async () => {
		const fetcher = new EsiFetcher(
			{} as DurableObjectState,
			{
				ESI_GLOBAL_CACHE: {} as KVNamespace,
				ESI_RATE_LIMITS: {} as KVNamespace,
			} as Env
		)

		const cache = {
			getCachedResponse: vi.fn(),
			setCachedResponse: vi.fn(),
		}
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify([]), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})
		)
		const requestClient = new EsiRequestClient({
			rateLimits: new EsiRateLimitStore({} as KVNamespace),
			cache,
			fetchImpl,
		})

		;(fetcher as unknown as { requestClient: EsiRequestClient }).requestClient = requestClient

		const response = await fetcher.fetchEsi('/characters/affiliation', {
			method: 'POST',
			body: [2124170938],
			cacheMode: 'no-store',
		})

		expect(response.data).toEqual([])
		expect(fetchImpl).toHaveBeenCalledTimes(1)
		expect(cache.getCachedResponse).not.toHaveBeenCalled()
		expect(cache.setCachedResponse).not.toHaveBeenCalled()
	})
})
