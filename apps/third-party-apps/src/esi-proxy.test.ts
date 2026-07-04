import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('@repo/hono-helpers', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

import { getStub } from '@repo/do-utils'

import { proxyEsiRequest } from './esi-proxy'

class MemoryKv {
	private readonly store = new Map<string, string>()

	async get<T>(key: string, type?: 'json'): Promise<T | string | null> {
		const value = this.store.get(key)
		if (value === undefined) {
			return null
		}
		if (type === 'json') {
			return JSON.parse(value) as T
		}
		return value
	}

	async put(key: string, value: string): Promise<void> {
		this.store.set(key, value)
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key)
	}
}

describe('proxyEsiRequest', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('always sends application/json to the ESI upstream', async () => {
		const quota = {
			consume: vi.fn().mockResolvedValue({ allowed: true, limit: 10, remaining: 9 }),
			observe: vi.fn().mockResolvedValue(undefined),
		}
		vi.mocked(getStub).mockReturnValue(quota as never)

		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ balance: 12345.67 }), {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					Expires: new Date(Date.now() + 60_000).toUTCString(),
				},
			})
		)

		const response = await proxyEsiRequest({
			env: {
				EVE_SSO_CLIENT_ID: 'client-id',
				ESI_RATE_LIMITS: new MemoryKv() as never,
				ESI_PROXY_CACHE: new MemoryKv() as never,
				THIRD_PARTY_APP_QUOTA: {} as never,
			} as never,
			request: new Request(
				'http://third-party-apps.internal/oauth/api/esi-proxy/latest/characters/123/wallet/?character_id=123',
				{
					method: 'GET',
					headers: {
						Authorization: 'Bearer token',
						Accept: '*/*',
					},
				}
			),
			path: '/latest/characters/123/wallet/',
			clientId: 'client-id',
			characterId: '123',
			accessToken: 'token',
			cacheScope: { scope: 'character', scopeId: '123' },
		})

		expect(fetchSpy).toHaveBeenCalledTimes(1)
		const requestInit = fetchSpy.mock.calls[0]?.[1]
		expect(requestInit).toBeTruthy()
		const headers = new Headers((requestInit?.headers ?? {}) as HeadersInit)
		expect(headers.get('Accept')).toBe('application/json')

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toContain('application/json')
		await expect(response.json()).resolves.toEqual({ balance: 12345.67 })
	})

	it('ignores cached ESI responses that do not advertise a JSON content-type', async () => {
		const quota = {
			consume: vi.fn().mockResolvedValue({ allowed: true, limit: 10, remaining: 9 }),
			observe: vi.fn().mockResolvedValue(undefined),
		}
		vi.mocked(getStub).mockReturnValue(quota as never)

		const rateLimits = new MemoryKv()
		const proxyCache = new MemoryKv()
		await proxyCache.put(
			'esi:proxy:character:123:/latest/characters/123/wallet/',
			JSON.stringify({
				data: {
					status: 200,
					statusText: 'OK',
					headers: [['content-type', 'text/plain; charset=utf-8']],
					body: 'cached text payload',
				},
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
				etag: null,
				pages: null,
				page: null,
			})
		)

		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ balance: 67890.12 }), {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					Expires: new Date(Date.now() + 60_000).toUTCString(),
				},
			})
		)

		const response = await proxyEsiRequest({
			env: {
				EVE_SSO_CLIENT_ID: 'client-id',
				ESI_RATE_LIMITS: rateLimits as never,
				ESI_PROXY_CACHE: proxyCache as never,
				THIRD_PARTY_APP_QUOTA: {} as never,
			} as never,
			request: new Request(
				'http://third-party-apps.internal/oauth/api/esi-proxy/latest/characters/123/wallet/?character_id=123',
				{
					method: 'GET',
					headers: {
						Authorization: 'Bearer token',
						Accept: '*/*',
					},
				}
			),
			path: '/latest/characters/123/wallet/',
			clientId: 'client-id',
			characterId: '123',
			accessToken: 'token',
			cacheScope: { scope: 'character', scopeId: '123' },
		})

		expect(fetchSpy).toHaveBeenCalledTimes(1)
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toContain('application/json')
		await expect(response.json()).resolves.toEqual({ balance: 67890.12 })
	})
})
