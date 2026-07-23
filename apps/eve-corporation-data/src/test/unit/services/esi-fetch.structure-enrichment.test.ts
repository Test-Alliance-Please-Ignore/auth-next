import { describe, expect, it, vi } from 'vitest'

import { buildSkyhookBaseStructureRow, buildSkyhookStorageRow } from '../../../durable-object'
import {
	fetchCorporationSkyhooks,
	fetchSovereigntyHubs,
	fetchSovereigntySystems,
	fetchStructures,
} from '../../../services/esi-fetch'

const ORBITAL_SKYHOOK_TYPE_ID = '81080'
const SOVEREIGNTY_HUB_TYPE_ID = '32458'

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

	it('bypasses the public cache when fetching sovereignty systems', async () => {
		const tokenStore = {
			fetchPublicEsi: vi.fn().mockResolvedValue({
				data: {
					solar_systems: [],
				},
			}),
		}

		const systems = await fetchSovereigntySystems(tokenStore as never)

		expect(tokenStore.fetchPublicEsi).toHaveBeenCalledWith('/sovereignty/systems', {
			cacheMode: 'no-store',
		})
		expect(systems).toEqual([])
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
						reagents: [
							{
								type_id: 81143,
								secured_stock: 34,
								unsecured_stock: 12,
								last_cycle: '2026-06-27T11:30:00.000Z',
							},
						],
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
		expect(tokenStore.fetchEsi).toHaveBeenNthCalledWith(
			1,
			'/corporations/98000001/structures/skyhooks',
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
			reagents: [
				{
					type_id: '81143',
					secured_stock: 34,
					unsecured_stock: 12,
					last_cycle: '2026-06-27T11:30:00.000Z',
				},
			],
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
				raw: { id: 71001, planet_id: 401 },
			},
			baseStructure: {
				corporationId: '98000001',
				structureId: '71001',
				typeId: '35842',
				systemId: '30000142',
				systemName: 'Jita',
				name: null,
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
			name: null,
			typeId: '35842',
			state: 'vulnerable',
		})
	})

	it('normalizes skyhook vulnerability state labels before storage', () => {
		const stored = buildSkyhookStorageRow({
			corporationId: '98000001',
			skyhook: {
				structure_id: '71001',
				planet_id: '401',
				corporation_id: '98000001',
				state: 'ShieldVulnerable',
				is_active: true,
				effective_workforce: 12,
				reagents: [],
				reinforcement_timer: null,
				theft_vulnerability: {
					start: '2026-06-27T12:10:00.000Z',
					end: '2026-06-27T12:20:00.000Z',
				},
				raw: { id: 71001, planet_id: 401 },
			},
			baseStructure: {
				corporationId: '98000001',
				structureId: '71001',
				typeId: '35842',
				systemId: '30000142',
				systemName: 'Jita',
				name: null,
			},
			existingRow: null,
			planet: {
				planetId: '401',
				planetName: 'Planet One',
				solarSystemName: 'Jita',
			},
			observedAt: new Date('2026-06-27T12:00:00.000Z'),
		})

		expect(stored?.state).toBe('vulnerable')
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
			name: null,
			typeId: ORBITAL_SKYHOOK_TYPE_ID,
			typeName: 'Orbital Skyhook',
			systemId: '30000142',
			systemName: 'Jita',
			regionId: '10000002',
			regionName: 'The Forge',
			profileId: 'skyhook',
			state: 'reinforced',
			lowPower: false,
			syncStatus: 'ok',
		})
		expect(base?.stateTimerEnd?.toISOString()).toBe('2026-06-27T12:30:00.000Z')
	})

	it('keeps sovereignty hub details when the base structure metadata is available', async () => {
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
						id: 81001,
						solar_system_id: 30000142,
						fuel_access_list_id: null,
						reagent_bay: {
							last_updated: '2026-07-12T19:36:46.834Z',
							reagents: [],
						},
						resources: {
							power: { allocated: 0, available: 0 },
							workforce: { allocated: 0, available: 0 },
						},
						upgrades: [],
						vulnerability_window: null,
						workforce_transport: {
							configuration: { transit: true },
							state: { transit: true },
						},
					},
				}),
		}

		const hubs = await fetchSovereigntyHubs(
			tokenStore as never,
			'98000001',
			'211'
		)

		expect(tokenStore.fetchEsi).toHaveBeenCalledTimes(2)
		expect(tokenStore.fetchEsi).toHaveBeenNthCalledWith(
			1,
			'/corporations/98000001/structures/sovereignty-hubs?page=1',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(tokenStore.fetchEsi).toHaveBeenNthCalledWith(
			2,
			'/corporations/98000001/structures/sovereignty-hubs/81001',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(hubs).toHaveLength(1)
		expect(hubs[0]).toMatchObject({
			structure_id: '81001',
			corporation_id: '98000001',
			system_id: '30000142',
			type_id: SOVEREIGNTY_HUB_TYPE_ID,
			name: null,
		})
	})
})
