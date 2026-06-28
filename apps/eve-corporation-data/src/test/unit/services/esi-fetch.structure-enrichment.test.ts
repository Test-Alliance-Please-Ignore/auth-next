import { describe, expect, it, vi } from 'vitest'

import {
	fetchCorporationSkyhooks,
	fetchSovereigntyHubs,
	fetchStructures,
} from '../../../services/esi-fetch'

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

	it('only fetches skyhook detail when the authenticated universe owner maps to the corporation', async () => {
		const tokenStore = {
			fetchEsi: vi
				.fn()
				.mockResolvedValueOnce({
					data: { skyhooks: [{ id: 71001, planet_id: 401 }] },
					pages: 1,
				})
				.mockResolvedValueOnce({
					data: {
						name: 'Skyhook One',
						owner_id: 98000001,
						position: { x: 0, y: 0, z: 0 },
						solar_system_id: 30000142,
						type_id: 35842,
					},
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

		expect(tokenStore.fetchEsi).toHaveBeenCalledTimes(3)
		expect(tokenStore.fetchEsi).toHaveBeenNthCalledWith(
			2,
			'/universe/structures/71001',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(tokenStore.fetchEsi).toHaveBeenNthCalledWith(
			3,
			'/corporations/98000001/structures/skyhooks/71001',
			'211',
			{ cacheMode: 'no-store' }
		)
		expect(skyhooks).toHaveLength(1)
		expect(skyhooks[0]).toMatchObject({
			structure_id: '71001',
			corporation_id: '98000001',
			system_id: '30000142',
			type_id: '35842',
			name: 'Skyhook One',
		})
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
