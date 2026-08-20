import { describe, expect, it, vi } from 'vitest'

import { fetchSovereigntyEnrichment } from '../../../workflows/steps/structures'

const SOVEREIGNTY_HUB_TYPE_ID = '32458'

const mocks = vi.hoisted(() => {
	const fetchSovereigntyHubsMock = vi.fn()
	const readSharedSovereigntySystemsByIdsMock = vi.fn()
	const readSharedSovereigntySystemsForCorporationMock = vi.fn()
	const refreshSharedSovereigntySystemsMock = vi.fn()
	const resolveSolarSystemsByIdsMock = vi.fn()
	const getSovereigntyHubSyncPrioritiesMock = vi.fn()
	const getMissingStructureIdsForPriorityQueueMock = vi.fn()
	const getStructureIdsMissingFromLiveListingMock = vi.fn()
	const getStructurePriorityQueueMock = vi.fn()
	const fetchCorporationSovereigntyHubsPageMock = vi.fn()
	const getCorporationEsiMock = vi.fn()
	const getStubMock = vi.fn(() => ({
		resolveSolarSystemsByIds: resolveSolarSystemsByIdsMock,
	}))

	return {
		fetchSovereigntyHubsMock,
		readSharedSovereigntySystemsByIdsMock,
		readSharedSovereigntySystemsForCorporationMock,
		refreshSharedSovereigntySystemsMock,
		resolveSolarSystemsByIdsMock,
		getSovereigntyHubSyncPrioritiesMock,
		getMissingStructureIdsForPriorityQueueMock,
		getStructureIdsMissingFromLiveListingMock,
		getStructurePriorityQueueMock,
		fetchCorporationSovereigntyHubsPageMock,
		getCorporationEsiMock,
		getStubMock,
	}
})

vi.mock('@repo/do-utils', () => ({
	getStub: mocks.getStubMock,
	withRpcResult: async <T, R>(request: Promise<T>, consume: (result: T) => R | Promise<R>) =>
		consume(await request),
	disposeRpcResult: () => undefined,
}))

vi.mock('../../../services/esi-fetch', () => ({
	fetchSovereigntyHubs: (...args: unknown[]) => mocks.fetchSovereigntyHubsMock(...args),
}))

vi.mock('../../../workflows/utils/services', () => ({
	getCorporationEsi: (...args: unknown[]) => mocks.getCorporationEsiMock(...args),
	getCorporationDataStub: vi.fn(() => ({
		getSovereigntyHubSyncPriorities: (...args: unknown[]) =>
			mocks.getSovereigntyHubSyncPrioritiesMock(...args),
		getMissingStructureIdsForPriorityQueue: (...args: unknown[]) =>
			mocks.getMissingStructureIdsForPriorityQueueMock(...args),
		getStructureIdsMissingFromLiveListing: (...args: unknown[]) =>
			mocks.getStructureIdsMissingFromLiveListingMock(...args),
		getStructurePriorityQueue: (...args: unknown[]) => mocks.getStructurePriorityQueueMock(...args),
	})),
}))

vi.mock('../../../workflows/utils/sovereignty-systems-cache', () => ({
	readSharedSovereigntySystemsByIds: (...args: unknown[]) =>
		mocks.readSharedSovereigntySystemsByIdsMock(...args),
	readSharedSovereigntySystemsForCorporation: (...args: unknown[]) =>
		mocks.readSharedSovereigntySystemsForCorporationMock(...args),
	refreshSharedSovereigntySystems: (...args: unknown[]) =>
		mocks.refreshSharedSovereigntySystemsMock(...args),
}))

describe('fetchSovereigntyEnrichment', () => {
	it('enriches sovereignty hub names from resolved solar systems before persistence', async () => {
		mocks.getCorporationEsiMock.mockReturnValue({
			fetchCorporationSovereigntyHubsPage: mocks.fetchCorporationSovereigntyHubsPageMock,
		})
		mocks.getStructurePriorityQueueMock.mockResolvedValueOnce({
			newStructureIds: [],
			pruneCandidateIds: ['departed-hub'],
			syncPriorities: [
				{
					structureId: '1',
					lastAttemptedSyncAt: null,
					lastSyncedAt: new Date('2026-07-22T00:00:00.000Z'),
				},
			],
		})
		mocks.fetchCorporationSovereigntyHubsPageMock.mockResolvedValueOnce({
			data: {
				sovereignty_hubs: [{ id: 1, solar_system_id: 30000142 }],
			},
			meta: { pages: 1, page: 1 },
		})
		mocks.readSharedSovereigntySystemsByIdsMock.mockResolvedValue([
			{
				system_id: '30000142',
				claim_type: 'alliance',
				alliance_id: '123456789',
				corporation_id: 'corp-1',
				claimed_since: '2026-07-12T19:36:46.834Z',
				is_capital_system: false,
				sovereignty_hub_structure_id: 'hub-1',
				vulnerability_window: null,
				activity_defense_multiplier: '1.0000',
				military_level: 1,
				industrial_level: 1,
				strategic_level: 1,
				raw: { claim: {} },
			},
		])
		mocks.fetchSovereigntyHubsMock.mockResolvedValue({
			sovereigntyHubs: [
				{
					structure_id: 'hub-1',
					corporation_id: 'corp-1',
					system_id: '30000142',
					system_name: null,
					name: null,
					type_id: SOVEREIGNTY_HUB_TYPE_ID,
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
			],
			failures: [],
			failureCount: 0,
			rateLimitFailureCount: 0,
			nonRateLimitFailureCount: 0,
		})
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

		expect(mocks.fetchSovereigntyHubsMock).toHaveBeenCalledWith(
			{
				fetchCorporationSovereigntyHubsPage: mocks.fetchCorporationSovereigntyHubsPageMock,
			},
			'corp-1',
			{
				prioritizedEntries: [
					{
						index: 0,
						entry: { id: 1, solar_system_id: 30000142 },
						priority: {
							structureId: '1',
							lastAttemptedSyncAt: null,
							lastSyncedAt: new Date('2026-07-22T00:00:00.000Z'),
						},
					},
				],
				pruneCandidateIds: ['departed-hub'],
			}
		)
		expect(mocks.readSharedSovereigntySystemsForCorporationMock).not.toHaveBeenCalled()
		expect(mocks.readSharedSovereigntySystemsByIdsMock).toHaveBeenCalledWith(
			{
				UNIVERSE: {},
			},
			'corp-1',
			['30000142']
		)
		expect(mocks.getStubMock).toHaveBeenCalledWith({}, 'default')
		expect(mocks.resolveSolarSystemsByIdsMock).toHaveBeenCalledWith(['30000142'])
		expect(result?.sovereigntyHubs[0]).toMatchObject({
			name: null,
			system_name: 'Jita',
			controller_alliance_id: '123456789',
		})
	})

	it('bubbles sovereignty scope mismatches so the workflow can surface sync failure state', async () => {
		mocks.getCorporationEsiMock.mockReturnValue({
			fetchCorporationSovereigntyHubsPage: mocks.fetchCorporationSovereigntyHubsPageMock,
		})
		mocks.getStructurePriorityQueueMock.mockResolvedValueOnce({
			newStructureIds: [],
			pruneCandidateIds: [],
			syncPriorities: [],
		})
		mocks.readSharedSovereigntySystemsForCorporationMock.mockResolvedValue([])
		mocks.readSharedSovereigntySystemsByIdsMock.mockReset()
		mocks.fetchCorporationSovereigntyHubsPageMock.mockRejectedValue(
			new Error(
				'ESI request failed: 401 Unauthorized - {"error":"missing scope"} | metadata={"status":401,"path":"/corporations/123/structures/sovereignty-hubs/"}'
			)
		)

		const promise = fetchSovereigntyEnrichment(
			{
				UNIVERSE: {} as never,
			} as never,
			'corp-1',
			'character-1'
		)

		await expect(promise).rejects.toThrow(
			'Sovereignty hub enrichment requires updated director scopes.'
		)
		await promise.catch((error) => {
			expect(error).toBeInstanceOf(Error)
			expect((error as { target?: string }).target).toBe('sovereignty-hubs')
		})
	})

	it('uses the corporation-scoped cache fallback when no live hubs are listed', async () => {
		mocks.getCorporationEsiMock.mockReturnValue({
			fetchCorporationSovereigntyHubsPage: mocks.fetchCorporationSovereigntyHubsPageMock,
		})
		mocks.fetchCorporationSovereigntyHubsPageMock.mockResolvedValueOnce({
			data: { sovereignty_hubs: [] },
			meta: { pages: 1, page: 1 },
		})
		mocks.readSharedSovereigntySystemsForCorporationMock.mockResolvedValue([
			{
				system_id: '30000142',
				claim_type: 'alliance',
				alliance_id: '123456789',
				corporation_id: 'corp-1',
				claimed_since: null,
				is_capital_system: false,
				sovereignty_hub_structure_id: null,
				vulnerability_window: null,
				activity_defense_multiplier: '1.0000',
				military_level: 1,
				industrial_level: 1,
				strategic_level: 1,
				raw: { claim: {} },
			},
		])
		mocks.getStructurePriorityQueueMock.mockResolvedValueOnce({
			newStructureIds: [],
			pruneCandidateIds: [],
			syncPriorities: [],
		})
		mocks.fetchSovereigntyHubsMock.mockResolvedValueOnce({
			sovereigntyHubs: [],
			pruneCandidateIds: [],
			failures: [],
			failureCount: 0,
			rateLimitFailureCount: 0,
			nonRateLimitFailureCount: 0,
		})

		const result = await fetchSovereigntyEnrichment(
			{
				UNIVERSE: {} as never,
			} as never,
			'corp-1',
			'character-1'
		)

		expect(mocks.readSharedSovereigntySystemsForCorporationMock).toHaveBeenCalledWith(
			{
				UNIVERSE: {},
			},
			'corp-1'
		)
		expect(mocks.readSharedSovereigntySystemsByIdsMock).not.toHaveBeenCalled()
		expect(result?.sovereigntySystems).toHaveLength(1)
	})
})
