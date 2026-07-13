import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
	const fetchSovereigntyHubsMock = vi.fn()
	const readSharedSovereigntySystemsByIdsMock = vi.fn()
	const resolveSolarSystemsByIdsMock = vi.fn()
	const getStubMock = vi.fn(() => ({
		resolveSolarSystemsByIds: resolveSolarSystemsByIdsMock,
	}))
	const createTokenStoreMock = vi.fn()

	return {
		fetchSovereigntyHubsMock,
		readSharedSovereigntySystemsByIdsMock,
		resolveSolarSystemsByIdsMock,
		getStubMock,
		createTokenStoreMock,
	}
})

vi.mock('@repo/do-utils', () => ({
	getStub: mocks.getStubMock,
}))

vi.mock('../../../services/esi-fetch', () => ({
	fetchSovereigntyHubs: (...args: unknown[]) => mocks.fetchSovereigntyHubsMock(...args),
}))

vi.mock('../../../workflows/utils/services', () => ({
	createTokenStore: (...args: unknown[]) => mocks.createTokenStoreMock(...args),
	getCorporationDataStub: vi.fn(),
}))

vi.mock('../../../workflows/utils/sovereignty-systems-cache', () => ({
	readSharedSovereigntySystemsByIds: (...args: unknown[]) =>
		mocks.readSharedSovereigntySystemsByIdsMock(...args),
}))

import { fetchSovereigntyEnrichment } from '../../../workflows/steps/structures'

describe('fetchSovereigntyEnrichment', () => {
	it('enriches sovereignty hub names from resolved solar systems before persistence', async () => {
		mocks.createTokenStoreMock.mockReturnValue({})
		mocks.fetchSovereigntyHubsMock.mockResolvedValue([
			{
				structure_id: 'hub-1',
				corporation_id: 'corp-1',
				system_id: '30000142',
				system_name: null,
				name: null,
				type_id: '35835',
				controller_alliance_id: null,
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
				raw: { detail: { id: 1 } },
			},
		])
		mocks.readSharedSovereigntySystemsByIdsMock.mockResolvedValue([])
		mocks.resolveSolarSystemsByIdsMock.mockResolvedValue({
			'30000142': {
				solarSystemName: 'Jita',
			},
		})

		const result = await fetchSovereigntyEnrichment(
			{
				UNIVERSE: {} as never,
			} as never,
			'corp-1',
			'character-1'
		)

		expect(mocks.fetchSovereigntyHubsMock).toHaveBeenCalledWith({}, 'corp-1', 'character-1')
		expect(mocks.getStubMock).toHaveBeenCalledWith({}, 'default')
		expect(mocks.resolveSolarSystemsByIdsMock).toHaveBeenCalledWith(['30000142'])
		expect(result?.sovereigntyHubs[0]).toMatchObject({
			name: 'Jita',
			system_name: 'Jita',
		})
	})
})
