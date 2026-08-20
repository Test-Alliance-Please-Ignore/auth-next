import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'
import { EsiRequestClient, EsiRequestError } from '@repo/esi'
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

		const response = await fetcher.withPublicContext(
			async () =>
				await fetcher.fetchEsi('/characters/affiliation', {
					method: 'POST',
					body: [2124170938],
					cacheMode: 'no-store',
				})
		)

		expect(response.data).toEqual([])
		expect(fetchImpl).toHaveBeenCalledTimes(1)
		expect(cache.getCachedResponse).not.toHaveBeenCalled()
		expect(cache.setCachedResponse).not.toHaveBeenCalled()
	})

	it('keeps concurrent authenticated calls isolated on the same physical shard', async () => {
		const fetcher = new EsiFetcher(
			{} as DurableObjectState,
			{
				ESI_GLOBAL_CACHE: {} as KVNamespace,
				ESI_RATE_LIMITS: {} as KVNamespace,
				EVE_SSO_CLIENT_ID: 'test-client',
			} as Env
		)
		const request = vi.fn(async (options: Record<string, unknown>) => {
			await Promise.resolve()
			return { data: options }
		})

		vi.mocked(getStub).mockReturnValue({
			getAccessToken: vi.fn(async (characterId: string) => `token:${characterId}`),
		} as never)
		;(fetcher as unknown as { requestClient: { request: typeof request } }).requestClient = {
			request,
		}

		const [first, second] = await Promise.all([
			fetcher.withCharacterContext(
				'1001',
				async () =>
					await fetcher.fetchEsi<Record<string, unknown>>('/characters/1001/skills', {
						cacheMode: 'no-store',
					})
			),
			fetcher.withCharacterContext(
				'2002',
				async () =>
					await fetcher.fetchEsi<Record<string, unknown>>('/characters/2002/skills', {
						cacheMode: 'no-store',
					})
			),
		])

		expect(first.data).toMatchObject({
			accessToken: 'token:1001',
			cacheScope: { scope: 'character', scopeId: '1001' },
		})
		expect(second.data).toMatchObject({
			accessToken: 'token:2002',
			cacheScope: { scope: 'character', scopeId: '2002' },
		})
	})

	it('keeps corporation and character authentication contexts isolated', async () => {
		const fetcher = new EsiFetcher(
			{} as DurableObjectState,
			{
				ESI_GLOBAL_CACHE: {} as KVNamespace,
				ESI_RATE_LIMITS: {} as KVNamespace,
				EVE_SSO_CLIENT_ID: 'test-client',
			} as Env
		)
		const request = vi.fn(async (options: Record<string, unknown>) => {
			await Promise.resolve()
			return { data: options }
		})

		vi.mocked(getStub).mockReturnValue({
			getLoadBalancedDirector: vi.fn().mockResolvedValue('3003'),
			getAccessToken: vi.fn(async (characterId: string) => `token:${characterId}`),
		} as never)
		;(fetcher as unknown as { requestClient: { request: typeof request } }).requestClient = {
			request,
		}

		const [character, corporation] = await Promise.all([
			fetcher.withCharacterContext(
				'1001',
				async () =>
					await fetcher.fetchEsi<Record<string, unknown>>('/characters/1001/skills', {
						cacheMode: 'no-store',
					})
			),
			fetcher.withCorporationContext(
				'4004',
				async () =>
					await fetcher.fetchEsi<Record<string, unknown>>('/corporations/4004/assets', {
						cacheMode: 'no-store',
					})
			),
		])

		expect(character.data).toMatchObject({
			accessToken: 'token:1001',
			cacheScope: { scope: 'character', scopeId: '1001' },
		})
		expect(corporation.data).toMatchObject({
			accessToken: 'token:3003',
			cacheScope: { scope: 'corporation', scopeId: '4004' },
		})
	})

	it('preserves structured ESI error context for paginated failures', async () => {
		const fetcher = new EsiFetcher(
			{} as DurableObjectState,
			{
				ESI_GLOBAL_CACHE: {} as KVNamespace,
				ESI_RATE_LIMITS: {} as KVNamespace,
			} as Env
		)
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify([{ id: 1 }]), {
					status: 200,
					headers: { 'content-type': 'application/json', 'X-Pages': '2' },
				})
			)
			.mockResolvedValueOnce(
				new Response('temporarily unavailable', {
					status: 503,
					statusText: 'Service Unavailable',
					headers: {
						'X-Request-ID': 'request-123',
						'X-ESI-Error-Limit-Remain': '90',
						'X-ESI-Error-Limit-Reset': '12',
					},
				})
			)
		const requestClient = new EsiRequestClient({
			rateLimits: new EsiRateLimitStore({} as KVNamespace),
			fetchImpl,
			maxRetries: 0,
		})

		;(fetcher as unknown as { requestClient: EsiRequestClient }).requestClient = requestClient

		const request = fetcher.withPublicContext(() =>
			fetcher.fetchEsiPaginated<{ id: number }>('/characters/1001/assets', {
				maxRetries: 0,
			})
		)

		await expect(request).rejects.toMatchObject({
			name: 'EsiRequestError',
			context: {
				status: 503,
				routeKey: '/characters/:id/assets',
				upstreamRequestId: 'request-123',
			},
		})
		await expect(request).rejects.toBeInstanceOf(EsiRequestError)
	})
})
