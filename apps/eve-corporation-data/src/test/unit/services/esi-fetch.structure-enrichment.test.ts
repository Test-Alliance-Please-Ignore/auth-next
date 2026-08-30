import { describe, expect, it, vi } from 'vitest'

import { buildSkyhookBaseStructureRow, buildSkyhookStorageRow } from '../../../durable-object'
import {
	fetchCorporationSkyhooks,
	fetchPosDetailEnrichment,
	fetchSovereigntyHubs,
	fetchSovereigntySystems,
	fetchStructures,
} from '../../../services/esi-fetch'

const ORBITAL_SKYHOOK_TYPE_ID = '81080'
const SOVEREIGNTY_HUB_TYPE_ID = '32458'

describe('esi structure enrichment ownership handling', () => {
	it('maps the requested corporation id onto base structures', async () => {
		const esi = {
			fetchCorporationStructures: vi.fn().mockResolvedValue([
				{
					structure_id: '1001',
					type_id: '35833',
					system_id: '30000142',
					profile_id: '60012345',
					state: 'shield_vulnerable',
				},
			]),
			fetchCorporationStarbasesPageWithCharacter: vi.fn().mockResolvedValue({
				data: [],
				meta: { pages: 1 },
			}),
		}

		const structures = await fetchStructures(esi as never, '98000001', '211')

		expect(esi.fetchCorporationStructures).toHaveBeenCalledWith('98000001')
		expect(structures.posListingComplete).toBe(true)
		expect(structures.structures).toHaveLength(1)
		expect(structures.structures[0]).toMatchObject({
			structure_id: '1001',
			corporation_id: '98000001',
			type_id: '35833',
			system_id: '30000142',
			profile_id: '60012345',
			state: 'shield_vulnerable',
		})
	})

	it('adds paginated POSes with detail fuel and best-effort asset names', async () => {
		const esi = {
			fetchCorporationStructures: vi.fn().mockResolvedValue([]),
			fetchCorporationStarbasesPageWithCharacter: vi
				.fn()
				.mockResolvedValueOnce({
					data: [
						{
							starbase_id: 9001,
							type_id: 12235,
							system_id: 30000142,
							moon_id: 40100001,
							state: 'online',
							onlined_since: '2026-08-01T00:00:00.000Z',
						},
					],
					meta: { pages: 2 },
				})
				.mockResolvedValueOnce({
					data: [
						{
							starbase_id: 9002,
							type_id: 12236,
							system_id: 30000143,
							state: 'unanchoring',
							unanchor_at: '2026-08-10T00:00:00.000Z',
						},
					],
					meta: { pages: 2 },
				}),
			fetchCorporationStarbaseDetailWithCharacter: vi
				.fn()
				.mockImplementation(async (_corpId: string, id: string) => ({
					allow_alliance_members: false,
					allow_corporation_members: true,
					anchor: 'corporation_member',
					attack_if_at_war: false,
					attack_if_other_security_status_dropping: false,
					fuel_bay_take: 'corporation_member',
					fuel_bay_view: 'corporation_member',
					offline: 'corporation_member',
					online: 'corporation_member',
					unanchor: 'corporation_member',
					use_alliance_standings: false,
					fuels:
						id === '9001'
							? [
									{ type_id: 4246, quantity: 120 },
									{ type_id: 16275, quantity: 500 },
								]
							: [{ type_id: 4051, quantity: 80 }],
				})),
			fetchCorporationAssetNames: vi
				.fn()
				.mockResolvedValue([{ item_id: '9001', name: 'POS Alpha' }]),
		}

		const structures = await fetchStructures(esi as never, '98000001', '211')

		expect(esi.fetchCorporationStarbasesPageWithCharacter).toHaveBeenNthCalledWith(
			1,
			'98000001',
			'211',
			1
		)
		expect(esi.fetchCorporationStarbasesPageWithCharacter).toHaveBeenNthCalledWith(
			2,
			'98000001',
			'211',
			2
		)
		expect(esi.fetchCorporationStarbaseDetailWithCharacter).not.toHaveBeenCalled()
		expect(esi.fetchCorporationAssetNames).toHaveBeenCalledWith('98000001', ['9001', '9002'])
		expect(structures.posListingComplete).toBe(true)
		expect(structures.structures).toMatchObject([
			{
				structure_id: '9001',
				corporation_id: '98000001',
				type_id: '12235',
				profile_id: 'pos',
				moon_id: '40100001',
				state: 'online',
				name: 'POS Alpha',
			},
			{
				structure_id: '9002',
				corporation_id: '98000001',
				type_id: '12236',
				profile_id: 'pos',
				state: 'unanchoring',
				name: null,
			},
		])
	})

	it('prioritizes POS details and stops after rate-limit pressure', async () => {
		const esi = {
			fetchCorporationStarbaseDetailWithCharacter: vi
				.fn()
				.mockResolvedValueOnce({ fuels: [{ type_id: 4246, quantity: 120 }] })
				.mockRejectedValueOnce(new Error('ESI request failed: 429 Too Many Requests'))
				.mockResolvedValueOnce({ fuels: [{ type_id: 4051, quantity: 80 }] })
				.mockResolvedValueOnce({ fuels: [{ type_id: 4246, quantity: 40 }] }),
		}

		const result = await fetchPosDetailEnrichment(esi as never, '98000001', {
			directorCharacterId: '211',
			prioritizedEntries: [
				{ index: 1, entry: { id: '9002', system_id: '30000143' } },
				{ index: 0, entry: { id: '9001', system_id: '30000142' } },
				{ index: 2, entry: { id: '9003', system_id: '30000144' } },
				{ index: 3, entry: { id: '9004', system_id: '30000145' } },
				{ index: 4, entry: { id: '9005', system_id: '30000146' } },
			],
		})

		expect(esi.fetchCorporationStarbaseDetailWithCharacter).toHaveBeenCalledTimes(4)
		expect(result.details).toEqual([
			{ structureId: '9002', fuelAmount: 120 },
			{ structureId: '9003', fuelAmount: 80 },
			{ structureId: '9004', fuelAmount: 40 },
		])
		expect(result.rateLimitFailureCount).toBe(1)
		expect(result.nonRateLimitFailureCount).toBe(0)
		expect(result.failures).toEqual([
			{ structureId: '9001', failureReason: 'ESI request failed: 429 Too Many Requests' },
		])
	})

	it('marks the POS listing incomplete when a page cannot be fetched', async () => {
		const esi = {
			fetchCorporationStructures: vi.fn().mockResolvedValue([]),
			fetchCorporationAssetNames: vi.fn(),
			fetchCorporationStarbasesPageWithCharacter: vi
				.fn()
				.mockResolvedValueOnce({
					data: [{ starbase_id: 9001, type_id: 12235, system_id: 30000142 }],
					meta: { pages: 2 },
				})
				.mockRejectedValueOnce(new Error('ESI request failed: 503 Service Unavailable')),
		}

		const result = await fetchStructures(esi as never, '98000001', '211')

		expect(result.posListingComplete).toBe(false)
		expect(result.posListingFailureReason).toBe('ESI request failed: 503 Service Unavailable')
		expect(result.structures).toEqual([])
		expect(esi.fetchCorporationAssetNames).not.toHaveBeenCalled()
	})

	it('uses the typed public ESI sovereignty endpoint', async () => {
		const esi = {
			fetchSovereigntySystems: vi.fn().mockResolvedValue({ solar_systems: [] }),
		}

		const systems = await fetchSovereigntySystems(esi as never)

		expect(esi.fetchSovereigntySystems).toHaveBeenCalledOnce()
		expect(systems).toEqual([])
	})

	it('preserves typed sovereignty data for domain enrichment', async () => {
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
		const esi = {
			fetchSovereigntySystems: vi.fn().mockResolvedValue({ solar_systems: [system] }),
		}

		const systems = await fetchSovereigntySystems(esi as never)

		expect((systems[0] as unknown as { raw: Record<string, unknown> }).raw).toMatchObject({
			claim: { alliance: { alliance_id: 99000001 } },
		})
	})

	it('fetches skyhook detail from the corp skyhook endpoints and maps the requesting corporation id', async () => {
		const esi = {
			fetchCorporationSkyhookDetail: vi
				.fn()
				.mockResolvedValueOnce({
					id: 71002,
					planet_id: 402,
					state: 'active',
					is_active: true,
					effective_workforce: 6,
					reagents: [],
					reinforcement_timer: null,
					theft_vulnerability: null,
				})
				.mockResolvedValueOnce({
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
				}),
		}

		const skyhookResult = await fetchCorporationSkyhooks(esi as never, '98000001', {
			prioritizedEntries: [
				{ index: 0, entry: { id: 71002, planet_id: 402 } },
				{ index: 1, entry: { id: 71001, planet_id: 401 } },
			],
		})

		expect(esi.fetchCorporationSkyhookDetail).toHaveBeenCalledTimes(2)
		expect(esi.fetchCorporationSkyhookDetail).toHaveBeenNthCalledWith(1, '98000001', '71002')
		expect(esi.fetchCorporationSkyhookDetail).toHaveBeenNthCalledWith(2, '98000001', '71001')
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
		const esi = {
			fetchCorporationSkyhookDetail: vi
				.fn()
				.mockImplementation(async (_corpId: string, id: string) => {
					if (id === '40001') {
						return {
							id: 40001,
							planet_id: 404,
							state: 'active',
							is_active: true,
						}
					}

					if (id === '30001') {
						throw new Error('ESI request failed: 429 Too Many Requests')
					}

					if (id === '10001') {
						return {
							id: 10001,
							planet_id: 402,
							state: 'active',
							is_active: true,
						}
					}

					if (id === '20001') {
						return {
							id: 20001,
							planet_id: 403,
							state: 'active',
							is_active: true,
						}
					}

					throw new Error(`Unexpected skyhook ID: ${id}`)
				}),
		}

		const skyhookResult = await fetchCorporationSkyhooks(esi as never, '98000001', {
			prioritizedEntries: [
				{ index: 0, entry: { id: 40001, planet_id: 404 } },
				{ index: 1, entry: { id: 30001, planet_id: 401 } },
				{ index: 2, entry: { id: 10001, planet_id: 402 } },
				{ index: 3, entry: { id: 20001, planet_id: 403 } },
				{ index: 4, entry: { id: 50001, planet_id: 405 } },
			],
		})

		expect(esi.fetchCorporationSkyhookDetail).toHaveBeenNthCalledWith(1, '98000001', '40001')
		expect(esi.fetchCorporationSkyhookDetail).toHaveBeenNthCalledWith(2, '98000001', '30001')
		expect(esi.fetchCorporationSkyhookDetail).toHaveBeenNthCalledWith(3, '98000001', '10001')
		expect(esi.fetchCorporationSkyhookDetail).toHaveBeenNthCalledWith(4, '98000001', '20001')
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
		const esi = {
			fetchCorporationSovereigntyHubDetail: vi
				.fn()
				.mockResolvedValueOnce({
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
				})
				.mockResolvedValueOnce({
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
				}),
		}

		const hubResult = await fetchSovereigntyHubs(esi as never, '98000001', {
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

		expect(esi.fetchCorporationSovereigntyHubDetail).toHaveBeenCalledTimes(2)
		expect(esi.fetchCorporationSovereigntyHubDetail).toHaveBeenNthCalledWith(1, '98000001', '81002')
		expect(esi.fetchCorporationSovereigntyHubDetail).toHaveBeenNthCalledWith(2, '98000001', '81001')
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
		const makeHub = (id: number, solarSystemId: number) => ({
			id,
			solar_system_id: solarSystemId,
			fuel_access_list_id: null,
			reagent_bay: { last_updated: '2026-07-23T00:00:00.000Z', reagents: [] },
			resources: {
				power: { allocated: 0, available: 0 },
				workforce: { allocated: 0, available: 0 },
			},
			upgrades: [],
			vulnerability_window: null,
			workforce_transport: { configuration: { transit: true }, state: { transit: true } },
		})
		const esi = {
			fetchCorporationSovereigntyHubDetail: vi.fn(async (_corpId: string, id: string) => {
				if (id === '30001') throw new Error('ESI request failed: 429 Too Many Requests')
				if (id === '40001') return makeHub(40001, 404)
				if (id === '10001') return makeHub(10001, 402)
				if (id === '20001') return makeHub(20001, 403)
				throw new Error(`Unexpected sovereignty hub ID: ${id}`)
			}),
		}

		const hubResult = await fetchSovereigntyHubs(esi as never, '98000001', {
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
