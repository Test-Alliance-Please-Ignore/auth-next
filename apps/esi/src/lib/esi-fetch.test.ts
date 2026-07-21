import { beforeEach, describe, expect, it, vi } from 'vitest'

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

		;(fetcher as unknown as { cache: typeof cache }).cache = cache

		await fetcher.fetchEsi('/characters/affiliation', {
			method: 'POST',
			body: [2124170938],
			cacheMode: 'no-store',
		})

		expect(cache.getCachedResponse).not.toHaveBeenCalled()
		expect(cache.setCachedResponse).not.toHaveBeenCalled()
	})
})
