import { describe, expect, it, vi } from 'vitest'

import { buildSkyhookBaseStructureRow, buildSkyhookStorageRow } from '../../../durable-object'
import {
	fetchCorporationSkyhooks,
	fetchSovereigntyHubs,
	fetchStructures,
} from '../../../services/esi-fetch'

const ORBITAL_SKYHOOK_TYPE_ID = '81080'

describe('esi structure enrichment ownership handling', () => {
	it('maps the requested corporation id onto base structures', async () => {
		const tokenStore = {
			fetchEsi: vi.fn().mockResolvedValue({
				data: [
					{
						structure_id: 1001,
						type_id: 35833,
						system_id: 30000142,
						profile_id: 60012345,
						state: 'shield_vulnerable',
					},
				],
			}),
		}

		const structures = await fetchStructures(tokenStore as never, '98000001', '211')

		expect(tokenStore.fetchEsi).toHaveBeenCalledWith(
			'/corporations/98000001/structures',
			'211'
		)
		expect(structures).toHaveLength(1)
		expect(structures[0]).toMatchObject({
			structure_id: '1001',
			corporation_id: '98000001',
			type_id: '35833',
			system_id: '30000142',
			profile_id: '60012345',
			state: 'shield_vulnerable',
		})
	})

	it('fetches skyhook detail from the corp skyhook endpoints and maps the requesting corporation id', async () => {
		const tokenStore = {
			fetchEsi: vi
				.fn()
				.mockResolvedValueOnce({
					data: { skyhooks: [{ id: 71001, planet_id: 401 }] },
					pages: 1,
				})
				.mockResolvedValueOnce({
					data: {
						id: 71001,
						planet_id: 401,
						state: 'active',
						is_active: true,
						effective_workforce: 12,
						reagents: [],
						reinforcement_timer: null,
						theft_vulnerability: null,
					},
				}),
		}

		const skyhooks = await fetchCorporationSkyhooks(
			tokenStore as never,
			'98000001',
			'211'
		)

		expect(tokenStore.fetchEsi).toHaveBeenCalledTimes(2)
		expect(tokenStore.fetchEsi).toHaveBeenNthCalledWith(
			2,
			'/corporations/98000001/structures/skyhooks/71001',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(tokenStore.fetchEsi).not.toHaveBeenCalledWith(
			'/universe/structures/71001',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(skyhooks).toHaveLength(1)
		expect(skyhooks[0]).toMatchObject({
			structure_id: '71001',
			planet_id: '401',
			corporation_id: '98000001',
			state: 'active',
			is_active: true,
			effective_workforce: 12,
			reagents: [],
		})
	})

	it('uses the base structure row and requesting corporation id when building the stored skyhook row', () => {
		const stored = buildSkyhookStorageRow({
			corporationId: '98000001',
			skyhook: {
				structure_id: '71001',
				planet_id: '401',
				corporation_id: '98000001',
				state: 'active',
				is_active: true,
				effective_workforce: 12,
				reagents: [],
				reinforcement_timer: null,
				theft_vulnerability: null,
				is_raidable: false,
				becomes_raidable_at: null,
				vulnerable_at: null,
				raw: { id: 71001, planet_id: 401 },
			},
			baseStructure: {
				corporationId: '98000001',
				structureId: '71001',
				typeId: '35842',
				systemId: '30000142',
				systemName: 'Jita',
				name: 'Skyhook One',
			},
			existingRow: null,
			planet: {
				planetId: '401',
				planetName: 'Planet One',
				solarSystemName: 'Jita',
			},
			observedAt: new Date('2026-06-27T12:00:00.000Z'),
		})

		expect(stored).toMatchObject({
			structureId: '71001',
			corporationId: '98000001',
			planetId: '401',
			planetName: 'Planet One',
			systemId: '30000142',
			systemName: 'Jita',
			name: 'Skyhook One',
			typeId: '35842',
			state: 'active',
		})
	})

	it('synthesizes the base structure row for a skyhook from the requesting corp and planet geography', () => {
		const base = buildSkyhookBaseStructureRow({
			corporationId: '98000001',
			skyhook: {
				structure_id: '71001',
				planet_id: '401',
				corporation_id: '98000001',
				state: 'active',
				is_active: true,
				effective_workforce: 12,
				reagents: [],
				reinforcement_timer: {
					end: '2026-06-27T12:30:00.000Z',
				},
				theft_vulnerability: null,
				is_raidable: false,
				becomes_raidable_at: null,
				vulnerable_at: null,
				raw: { id: 71001, planet_id: 401 },
			},
			planet: {
				planetId: '401',
				planetName: 'Planet One',
				solarSystemId: '30000142',
				solarSystemName: 'Jita',
			},
			system: {
				solarSystemId: '30000142',
				solarSystemName: 'Jita',
				regionId: '10000002',
				constellationId: '20000020',
				securityStatus: '0.9',
			},
			region: {
				regionId: '10000002',
				regionName: 'The Forge',
			},
			existingRow: null,
			observedAt: new Date('2026-06-27T12:00:00.000Z'),
		})

		expect(base).toMatchObject({
			structureId: '71001',
			corporationId: '98000001',
			name: 'Planet One',
			typeId: ORBITAL_SKYHOOK_TYPE_ID,
			typeName: 'Orbital Skyhook',
			systemId: '30000142',
			systemName: 'Jita',
			regionId: '10000002',
			regionName: 'The Forge',
			profileId: 'skyhook',
			state: 'active',
			lowPower: false,
			syncStatus: 'ok',
		})
		expect(base?.stateTimerEnd?.toISOString()).toBe('2026-06-27T12:30:00.000Z')
	})

	it('skips sovereignty hub detail fetch when the authenticated universe owner does not match', async () => {
		const tokenStore = {
			fetchEsi: vi
				.fn()
				.mockResolvedValueOnce({
					data: {
						sovereignty_hubs: [{ id: 81001 }],
					},
					pages: 1,
				})
				.mockResolvedValueOnce({
					data: {
						name: 'Wrong Corp Hub',
						owner_id: 98000002,
						position: { x: 0, y: 0, z: 0 },
						solar_system_id: 30000142,
						type_id: 35835,
					},
				}),
		}

		const hubs = await fetchSovereigntyHubs(tokenStore as never, '98000001', '211')

		expect(tokenStore.fetchEsi).toHaveBeenCalledTimes(2)
		expect(tokenStore.fetchEsi).toHaveBeenCalledWith(
			'/corporations/98000001/structures/sovereignty-hubs?page=1',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(tokenStore.fetchEsi).toHaveBeenCalledWith(
			'/universe/structures/81001',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(tokenStore.fetchEsi).not.toHaveBeenCalledWith(
			'/corporations/98000001/structures/sovereignty-hubs/81001',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(hubs).toEqual([])
	})
})
