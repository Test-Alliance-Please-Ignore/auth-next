import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import type { Env } from './context'

vi.mock(
	'cloudflare:workers',
	() => ({
		DurableObject: class DurableObject {
			constructor(
				public state: DurableObjectState,
				public env: Env
			) {}
		},
	})
)

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

async function createResolver() {
	const { EsiTypeResolverDO } = await import('./durable-object-id-resolver')
	const state = {
		storage: {
			kv: {
				get: vi.fn().mockResolvedValue(null),
				put: vi.fn().mockResolvedValue(undefined),
			},
		},
	} as unknown as DurableObjectState

	const env = {
		ESI: { binding: 'esi' } as unknown as DurableObjectNamespace,
		UNIVERSE: { binding: 'universe' } as unknown as DurableObjectNamespace,
		ESI_GLOBAL_CACHE: {
			get: vi.fn().mockResolvedValue(null),
			put: vi.fn().mockResolvedValue(undefined),
		} as unknown as KVNamespace,
	} as Env

	return {
		resolver: new EsiTypeResolverDO(state, env),
		env,
	}
}

describe('EsiTypeResolverDO local-first resolution', () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it('resolves local universe IDs first without calling ESI names endpoint', async () => {
		const { resolver, env } = await createResolver()

		const universeStub = {
			resolveTypeNamesByIds: vi.fn().mockResolvedValue({
				'34': { typeName: 'Tritanium' },
			}),
			resolveRegionsByIds: vi.fn().mockResolvedValue({
				'10000002': { regionName: 'The Forge' },
			}),
			resolveSolarSystemsByIds: vi.fn().mockResolvedValue({
				'30000142': { solarSystemName: 'Jita' },
			}),
			resolveNpcStationsByIds: vi.fn().mockResolvedValue({
				'60003760': { stationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant' },
			}),
			resolveStargatesByIds: vi.fn().mockResolvedValue({
				'50000001': { stargateName: 'Jita Stargate' },
			}),
			resolvePlanetsByIds: vi.fn().mockResolvedValue({
				'40000001': { planetName: 'Jita I' },
			}),
			resolveStaticMoonsByIds: vi.fn().mockResolvedValue({}),
		}

		const mockedGetStub = vi.mocked(getStub)
		mockedGetStub.mockImplementation((binding) => {
			if (binding === env.UNIVERSE) return universeStub as never
			throw new Error('Unexpected binding in test')
		})

		const fetchSpy = vi.spyOn(globalThis, 'fetch')

		const result = await resolver.resolveIds([
			'34',
			'10000002',
			'30000142',
			'60003760',
			'50000001',
			'40000001',
		])

		expect(result).toMatchObject({
			'34': 'Tritanium',
			'10000002': 'The Forge',
			'30000142': 'Jita',
			'60003760': 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
			'50000001': 'Jita Stargate',
			'40000001': 'Jita I',
		})
		expect(fetchSpy).not.toHaveBeenCalled()
		expect(universeStub.resolveTypeNamesByIds).toHaveBeenCalledWith(['34'])
		expect(universeStub.resolveRegionsByIds).toHaveBeenCalledWith(['10000002'])
		expect(universeStub.resolveSolarSystemsByIds).toHaveBeenCalledWith(['30000142'])
		expect(universeStub.resolveNpcStationsByIds).toHaveBeenCalledWith(['60003760'])
		expect(universeStub.resolveStargatesByIds).toHaveBeenCalledWith(['50000001'])
		expect(universeStub.resolvePlanetsByIds).toHaveBeenCalledWith(['40000001'])
		expect(universeStub.resolveStaticMoonsByIds).toHaveBeenCalledWith(['40000001'])
	})

	it('falls back to ESI names endpoint for unresolved local IDs', async () => {
		const { resolver, env } = await createResolver()

		const universeStub = {
			resolveTypeNamesByIds: vi.fn().mockResolvedValue({}),
			resolveRegionsByIds: vi.fn().mockResolvedValue({
				'10000002': null,
			}),
			resolveSolarSystemsByIds: vi.fn().mockResolvedValue({}),
			resolveNpcStationsByIds: vi.fn().mockResolvedValue({}),
			resolveStargatesByIds: vi.fn().mockResolvedValue({}),
			resolvePlanetsByIds: vi.fn().mockResolvedValue({}),
			resolveStaticMoonsByIds: vi.fn().mockResolvedValue({}),
		}

		const mockedGetStub = vi.mocked(getStub)
		mockedGetStub.mockImplementation((binding) => {
			if (binding === env.UNIVERSE) return universeStub as never
			throw new Error('Unexpected binding in test')
		})

		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify([
					{ id: 10000002, name: 'The Forge', category: 'region' },
				]),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			)
		)

		const result = await resolver.resolveIds(['10000002'])

		expect(result['10000002']).toBe('The Forge')
		expect(fetchSpy).toHaveBeenCalledTimes(1)
		expect(universeStub.resolveRegionsByIds).toHaveBeenCalledWith(['10000002'])
	})
})
