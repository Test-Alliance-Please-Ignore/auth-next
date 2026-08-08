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

		expect(tokenStore.fetchEsi).toHaveBeenCalledWith('/corporations/98000001/structures', '211')
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

	it('detaches nested sovereignty data before disposing the RPC response', async () => {
		const system = {
			solar_system_id: 30000142,
			claim: {
				alliance: {
					alliance_id: 99000001,
					corporation_id: 98000001,
					claimed_since: '2026-07-01T00:00:00.000Z',
					is_capital_system: false,
					sovereignty_hub: { id: 81001 },
					development: {
						activity_defense_multiplier: 1,
						military_level: 3,
						industrial_level: 2,
						strategic_level: 1,
					},
				},
			},
		}
		const response = {
			data: { solar_systems: [system] },
			[Symbol.dispose]: vi.fn(() => {
				Object.assign(system, { claim: { unclaimed: true } })
			}),
		}
		const tokenStore = {
			fetchPublicEsi: vi.fn().mockResolvedValue(response),
		}

		const systems = await fetchSovereigntySystems(tokenStore as never)

		expect(response[Symbol.dispose]).toHaveBeenCalledOnce()
		expect((systems[0] as unknown as { raw: Record<string, unknown> }).raw).toMatchObject({
			claim: { alliance: { alliance_id: 99000001 } },
		})
	})

	it('fetches skyhook detail from the corp skyhook endpoints and maps the requesting corporation id', async () => {
		const tokenStore = {
			fetchEsi: vi
				.fn()
				.mockResolvedValueOnce({
					data: {
						id: 71002,
						planet_id: 402,
						state: 'active',
						is_active: true,
						effective_workforce: 6,
						reagents: [],
						reinforcement_timer: null,
						theft_vulnerability: null,
					},
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

		const skyhookResult = await fetchCorporationSkyhooks(tokenStore as never, '98000001', '211', {
			prioritizedEntries: [
				{ index: 0, entry: { id: 71002, planet_id: 402 } },
				{ index: 1, entry: { id: 71001, planet_id: 401 } },
			],
		})

		expect(tokenStore.fetchEsi).toHaveBeenCalledTimes(2)
		expect(tokenStore.fetchEsi).toHaveBeenNthCalledWith(
			1,
			'/corporations/98000001/structures/skyhooks/71002',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(tokenStore.fetchEsi).toHaveBeenNthCalledWith(
			2,
			'/corporations/98000001/structures/skyhooks/71001',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(tokenStore.fetchEsi).not.toHaveBeenCalledWith(
			'/corporations/98000001/structures/skyhooks/99999',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(tokenStore.fetchEsi).not.toHaveBeenCalledWith('/universe/structures/71001', '211', {
			cacheMode: 'no-store',
		})
		expect(skyhookResult.failureCount).toBe(0)
		expect(skyhookResult.skyhooks.map((skyhook) => skyhook.structure_id)).toEqual([
			'71002',
			'71001',
		])
		expect(skyhookResult.skyhooks[0]).toMatchObject({
			structure_id: '71002',
			planet_id: '402',
			corporation_id: '98000001',
			state: 'active',
			is_active: true,
			effective_workforce: 6,
			reagents: [],
		})
		expect(skyhookResult.skyhooks[1]).toMatchObject({
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

	it('prioritizes stale skyhooks first and keeps partial successes when one detail request fails', async () => {
		const tokenStore = {
			fetchEsi: vi.fn().mockImplementation(async (path: string) => {
				if (path === '/corporations/98000001/structures/skyhooks') {
					return {
						data: {
							skyhooks: [
								{ id: 40001, planet_id: 404 },
								{ id: 30001, planet_id: 401 },
								{ id: 10001, planet_id: 402 },
								{ id: 20001, planet_id: 403 },
							],
						},
						pages: 1,
					}
				}

				if (path === '/corporations/98000001/structures/skyhooks/40001') {
					return {
						data: {
							id: 40001,
							planet_id: 404,
							state: 'active',
							is_active: true,
						},
					}
				}

				if (path === '/corporations/98000001/structures/skyhooks/30001') {
					throw new Error('ESI request failed: 429 Too Many Requests')
				}

				if (path === '/corporations/98000001/structures/skyhooks/10001') {
					return {
						data: {
							id: 10001,
							planet_id: 402,
							state: 'active',
							is_active: true,
						},
					}
				}

				if (path === '/corporations/98000001/structures/skyhooks/20001') {
					return {
						data: {
							id: 20001,
							planet_id: 403,
							state: 'active',
							is_active: true,
						},
					}
				}

				throw new Error(`Unexpected path: ${path}`)
			}),
		}

		const skyhookResult = await fetchCorporationSkyhooks(tokenStore as never, '98000001', '211', {
			prioritizedEntries: [
				{ index: 0, entry: { id: 40001, planet_id: 404 } },
				{ index: 1, entry: { id: 30001, planet_id: 401 } },
				{ index: 2, entry: { id: 10001, planet_id: 402 } },
				{ index: 3, entry: { id: 20001, planet_id: 403 } },
				{ index: 4, entry: { id: 50001, planet_id: 405 } },
			],
		})

		expect(tokenStore.fetchEsi).toHaveBeenNthCalledWith(
			1,
			'/corporations/98000001/structures/skyhooks/40001',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(tokenStore.fetchEsi).toHaveBeenNthCalledWith(
			2,
			'/corporations/98000001/structures/skyhooks/30001',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(tokenStore.fetchEsi).toHaveBeenNthCalledWith(
			3,
			'/corporations/98000001/structures/skyhooks/10001',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(tokenStore.fetchEsi).toHaveBeenNthCalledWith(
			4,
			'/corporations/98000001/structures/skyhooks/20001',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(skyhookResult.failureCount).toBe(1)
		expect(skyhookResult.failures).toEqual([
			{
				structureId: '30001',
				failureReason: 'ESI request failed: 429 Too Many Requests',
			},
		])
		expect(skyhookResult.skyhooks).toHaveLength(3)
		expect(skyhookResult.skyhooks.map((skyhook) => skyhook.structure_id)).toEqual([
			'40001',
			'10001',
			'20001',
		])
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
						id: 81002,
						solar_system_id: 30000143,
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

		const hubResult = await fetchSovereigntyHubs(tokenStore as never, '98000001', '211', {
			prioritizedEntries: [
				{
					index: 0,
					entry: { id: 81002, solar_system_id: 30000143 },
				},
				{
					index: 1,
					entry: { id: 81001, solar_system_id: 30000142 },
				},
			],
		})

		expect(tokenStore.fetchEsi).toHaveBeenCalledTimes(2)
		expect(tokenStore.fetchEsi).toHaveBeenNthCalledWith(
			1,
			'/corporations/98000001/structures/sovereignty-hubs/81002',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(tokenStore.fetchEsi).not.toHaveBeenCalledWith(
			'/corporations/98000001/structures/sovereignty-hubs/99999',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(tokenStore.fetchEsi).toHaveBeenNthCalledWith(
			2,
			'/corporations/98000001/structures/sovereignty-hubs/81001',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(hubResult.failureCount).toBe(0)
		expect(hubResult.sovereigntyHubs).toHaveLength(2)
		expect(hubResult.sovereigntyHubs).toEqual([
			expect.objectContaining({
				structure_id: '81002',
				corporation_id: '98000001',
				system_id: '30000143',
				type_id: SOVEREIGNTY_HUB_TYPE_ID,
				name: null,
			}),
			expect.objectContaining({
				structure_id: '81001',
				corporation_id: '98000001',
				system_id: '30000142',
				type_id: SOVEREIGNTY_HUB_TYPE_ID,
				name: null,
			}),
		])
	})

	it('prioritizes stale sovereignty hubs first and keeps partial successes when one detail request fails', async () => {
		const tokenStore = {
			fetchEsi: vi.fn().mockImplementation(async (path: string) => {
				if (path === '/corporations/98000001/structures/sovereignty-hubs?page=1') {
					return {
						data: {
							sovereignty_hubs: [
								{ id: 40001, solar_system_id: 404 },
								{ id: 30001, solar_system_id: 401 },
								{ id: 10001, solar_system_id: 402 },
								{ id: 20001, solar_system_id: 403 },
							],
						},
						pages: 1,
					}
				}

				if (path === '/corporations/98000001/structures/sovereignty-hubs/40001') {
					return {
						data: {
							id: 40001,
							solar_system_id: 404,
							fuel_access_list_id: null,
							reagent_bay: {
								last_updated: '2026-07-23T00:00:00.000Z',
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
					}
				}

				if (path === '/corporations/98000001/structures/sovereignty-hubs/30001') {
					throw new Error('ESI request failed: 429 Too Many Requests')
				}

				if (path === '/corporations/98000001/structures/sovereignty-hubs/10001') {
					return {
						data: {
							id: 10001,
							solar_system_id: 402,
							fuel_access_list_id: null,
							reagent_bay: {
								last_updated: '2026-07-23T00:00:00.000Z',
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
					}
				}

				if (path === '/corporations/98000001/structures/sovereignty-hubs/20001') {
					return {
						data: {
							id: 20001,
							solar_system_id: 403,
							fuel_access_list_id: null,
							reagent_bay: {
								last_updated: '2026-07-23T00:00:00.000Z',
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
					}
				}

				throw new Error(`Unexpected path: ${path}`)
			}),
		}

		const hubResult = await fetchSovereigntyHubs(tokenStore as never, '98000001', '211', {
			prioritizedEntries: [
				{ index: 0, entry: { id: 40001, solar_system_id: 404 } },
				{ index: 1, entry: { id: 30001, solar_system_id: 401 } },
				{ index: 2, entry: { id: 10001, solar_system_id: 402 } },
				{ index: 3, entry: { id: 20001, solar_system_id: 403 } },
				{ index: 4, entry: { id: 50001, solar_system_id: 405 } },
			],
		})

		expect(hubResult.failureCount).toBe(1)
		expect(hubResult.failures).toHaveLength(1)
		expect(hubResult.failures[0]).toMatchObject({ structureId: '30001' })
		expect(hubResult.sovereigntyHubs.map((hub) => hub.structure_id)).toEqual([
			'40001',
			'10001',
			'20001',
		])
	})
})
