import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
	const getStubMock = vi.fn()
	return { getStubMock }
})

vi.mock('@repo/hono-helpers', () => ({
	logger: {
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	},
}))

vi.mock('@repo/do-utils', () => ({
	getStub: mocks.getStubMock,
}))

import { getVisibleStructureDetail, listSovereigntyStructures } from '../../../services/structures.service'

function makeDb() {
	const corporationStructures = {
		findFirst: vi.fn().mockResolvedValue(null),
		findMany: vi.fn().mockResolvedValue([]),
	}
	const structureModuleConfig = {
		findFirst: vi.fn().mockResolvedValue({
			id: 'default',
			lowFuelTimeThresholdHours: 12,
			criticalFuelTimeThresholdHours: 4,
			lowFuelAmountThreshold: 0,
			criticalFuelAmountThreshold: 0,
			updatedBy: null,
			createdAt: new Date('2026-01-01T00:00:00Z'),
			updatedAt: new Date('2026-01-01T00:00:00Z'),
		}),
	}
	const structureConfigs = {
		findFirst: vi.fn().mockResolvedValue(null),
	}
	const managedCorporations = {
		findMany: vi.fn().mockResolvedValue([
			{
				corporationId: 'corp-1',
				name: 'Test Corp',
				includeInStructureAssetSync: true,
			},
		]),
		findFirst: vi.fn().mockResolvedValue({
			corporationId: 'corp-1',
			name: 'Test Corp',
			includeInStructureAssetSync: true,
		}),
	}
	const universeStub = {
		resolveSolarSystemsByIds: vi.fn().mockResolvedValue({
			'30000142': {
				solarSystemId: '30000142',
				solarSystemName: 'Jita',
				regionId: '10000002',
				constellationId: '20000020',
				securityStatus: '0.9',
			},
		}),
		resolveRegionsByIds: vi.fn().mockResolvedValue({
			10000002: {
				regionId: '10000002',
				regionName: 'The Forge',
			},
		}),
	}
	const corporationStructureInventory = {
		findMany: vi.fn().mockResolvedValue([]),
	}
	const structureSovereigntyHubs = {
		findMany: vi.fn().mockResolvedValue([
			{
				structureId: 'hub-1',
				corporationId: 'corp-1',
				systemId: '30000142',
				systemName: 'Jita',
				name: 'Jita Hub',
				typeId: '32458',
				fuelAccessListId: null,
				controllerAllianceId: 'alliance-1',
				reagentBayLastUpdated: new Date('2026-07-12T19:36:46.834Z'),
				reagentBay: {
					lastUpdated: '2026-07-12T19:36:46.834Z',
					reagents: [
						{
							typeId: '81143',
							amount: 10,
							burningPerHour: 4,
							lastCycle: '2026-07-12T18:30:00Z',
						},
						{
							typeId: '81144',
							amount: 15,
							burningPerHour: 6,
							lastCycle: '2026-07-12T19:00:00Z',
						},
					],
				},
				resources: {
					power: { allocated: 100, available: 200 },
					workforce: { allocated: 300, available: 400 },
				},
				upgrades: [
					{
						typeId: '87710',
						powerState: 'Online',
					},
				],
				vulnerabilityWindowStart: new Date('2026-07-13T08:40:00Z'),
				vulnerabilityWindowEnd: new Date('2026-07-13T15:20:00Z'),
				workforceTransport: {
					configuration: { mode: 'unknown', systems: [] },
					state: { mode: 'unknown', systems: [] },
				},
				sourceSyncAt: new Date('2026-07-12T19:36:47.369Z'),
				lastSyncedAt: new Date('2026-07-12T19:36:47.369Z'),
				updatedAt: new Date('2026-07-12T19:36:47.369Z'),
			},
		]),
		findFirst: vi.fn().mockResolvedValue({
			structureId: 'hub-1',
			corporationId: 'corp-1',
			systemId: '30000142',
			systemName: 'Jita',
			name: 'Jita Hub',
			typeId: '32458',
			fuelAccessListId: null,
			controllerAllianceId: 'alliance-1',
			reagentBayLastUpdated: new Date('2026-07-12T19:36:46.834Z'),
			reagentBay: {
				lastUpdated: '2026-07-12T19:36:46.834Z',
				reagents: [],
			},
			resources: {
				power: { allocated: 0, available: 0 },
				workforce: { allocated: 0, available: 0 },
			},
			upgrades: [],
			vulnerabilityWindowStart: null,
			vulnerabilityWindowEnd: null,
			workforceTransport: {
				configuration: { mode: 'unknown', systems: [] },
				state: { mode: 'unknown', systems: [] },
			},
			sourceSyncAt: new Date('2026-07-12T19:36:47.369Z'),
			lastSyncedAt: new Date('2026-07-12T19:36:47.369Z'),
			updatedAt: new Date('2026-07-12T19:36:47.369Z'),
		}),
	}
	const structureSovereigntySystems = {
		findMany: vi.fn().mockResolvedValue([
			{
				systemId: '30000142',
				systemName: 'Jita',
				corporationId: 'corp-1',
				claimType: 'alliance',
				allianceId: 'alliance-1',
				corporationClaimantId: null,
				factionId: null,
				claimedSince: new Date('2026-07-12T18:00:00Z'),
				sovereigntyHubStructureId: 'hub-1',
				isCapitalSystem: false,
				vulnerabilityWindowStart: new Date('2026-07-13T08:40:00Z'),
				vulnerabilityWindowEnd: new Date('2026-07-13T15:20:00Z'),
				activityDefenseMultiplier: '1.2',
				militaryLevel: 2,
				industrialLevel: 3,
				strategicLevel: 4,
				sourceSyncAt: new Date('2026-07-12T19:36:47.369Z'),
				lastSyncedAt: new Date('2026-07-12T19:36:47.369Z'),
				updatedAt: new Date('2026-07-12T19:36:47.369Z'),
			},
		]),
		findFirst: vi.fn().mockResolvedValue({
			systemId: '30000142',
			systemName: 'Jita',
			corporationId: 'corp-1',
			claimType: 'alliance',
			allianceId: 'alliance-1',
			corporationClaimantId: null,
			factionId: null,
			claimedSince: new Date('2026-07-12T18:00:00Z'),
			sovereigntyHubStructureId: 'hub-1',
			isCapitalSystem: false,
			vulnerabilityWindowStart: new Date('2026-07-13T08:40:00Z'),
			vulnerabilityWindowEnd: new Date('2026-07-13T15:20:00Z'),
			activityDefenseMultiplier: '1.2',
			militaryLevel: 2,
			industrialLevel: 3,
			strategicLevel: 4,
			sourceSyncAt: new Date('2026-07-12T19:36:47.369Z'),
			lastSyncedAt: new Date('2026-07-12T19:36:47.369Z'),
			updatedAt: new Date('2026-07-12T19:36:47.369Z'),
		}),
	}

	return {
		universeStub,
		query: {
			corporationStructures,
			structureModuleConfig,
			structureConfigs,
			managedCorporations,
			corporationStructureInventory,
			structureSovereigntyHubs,
			structureSovereigntySystems,
		},
	}
}

describe('sovereignty hub model', () => {
	it('lists sovereignty hubs without requiring corporation structures rows', async () => {
		const db = makeDb()
		mocks.getStubMock.mockReturnValue(db.universeStub)
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(
			new Date('2026-07-12T00:00:00Z').getTime()
		)

		try {
			const result = await listSovereigntyStructures(
				{
					UNIVERSE: {} as never,
				} as never,
				db as never,
				{
					id: 'user-1',
					is_admin: true,
					roles: [],
				}
			)

			expect(mocks.getStubMock).toHaveBeenCalledWith({}, 'default')
			expect(db.query.corporationStructures.findMany).not.toHaveBeenCalled()
			expect(result.items).toHaveLength(1)
			expect(result.items[0]).toMatchObject({
				structureId: 'hub-1',
				corporationId: 'corp-1',
				corporationName: 'Test Corp',
				typeId: '32458',
				typeName: 'Sovereignty Hub',
				systemId: '30000142',
				systemName: 'Jita',
				regionId: '10000002',
				regionName: 'The Forge',
				claimType: 'alliance',
				sovereigntyHubStructureId: 'hub-1',
				controllerAllianceId: 'alliance-1',
				vulnerabilityWindowStart: '2026-07-13T08:40:00.000Z',
				vulnerabilityWindowEnd: '2026-07-13T15:20:00.000Z',
				activityDefenseMultiplier: '1.2',
				militaryLevel: 2,
				industrialLevel: 3,
				strategicLevel: 4,
				magmaticGasQuantity: 10,
				magmaticGasBurningPerHour: 4,
				magmaticGasEstimatedDepletionAt: '2026-07-12T02:30:00.000Z',
				superionicIceQuantity: 15,
				superionicIceBurningPerHour: 6,
				superionicIceEstimatedDepletionAt: '2026-07-12T02:30:00.000Z',
				resourceWorkforceAllocated: 300,
				resourceWorkforceAvailable: 400,
				resourcePowerAllocated: 100,
				resourcePowerAvailable: 200,
			})
		} finally {
			nowSpy.mockRestore()
		}
	})

	it('filters sovereignty hubs by region using universe geography', async () => {
		const db = makeDb()
		mocks.getStubMock.mockReturnValue(db.universeStub)

		const result = await listSovereigntyStructures(
			{
				UNIVERSE: {} as never,
			} as never,
			db as never,
			{
				id: 'user-1',
				is_admin: true,
				roles: [],
			},
			{
				regionId: '10000002',
			}
		)

		expect(result.items).toHaveLength(1)
		expect(result.items[0]?.regionId).toBe('10000002')
	})

	it('sorts sovereignty hubs by ADM numerically', async () => {
		const db = makeDb()
		mocks.getStubMock.mockReturnValue(db.universeStub)
		db.universeStub.resolveSolarSystemsByIds.mockResolvedValue({
			'30000142': {
				solarSystemId: '30000142',
				solarSystemName: 'Jita',
				regionId: '10000002',
				constellationId: '20000020',
				securityStatus: '0.9',
			},
			'30000143': {
				solarSystemId: '30000143',
				solarSystemName: 'Perimeter',
				regionId: '10000002',
				constellationId: '20000021',
				securityStatus: '0.8',
			},
		})
		db.query.structureSovereigntyHubs.findMany.mockResolvedValue([
			{
				structureId: 'hub-high',
				corporationId: 'corp-1',
				systemId: '30000142',
				systemName: 'Jita',
				name: 'High ADM Hub',
				typeId: '32458',
				fuelAccessListId: null,
				controllerAllianceId: 'alliance-1',
				reagentBayLastUpdated: new Date('2026-07-12T19:36:46.834Z'),
				reagentBay: {
					lastUpdated: '2026-07-12T19:36:46.834Z',
					reagents: [],
				},
				resources: {
					power: { allocated: 100, available: 200 },
					workforce: { allocated: 300, available: 400 },
				},
				upgrades: [],
				vulnerabilityWindowStart: new Date('2026-07-13T08:40:00Z'),
				vulnerabilityWindowEnd: new Date('2026-07-13T15:20:00Z'),
				workforceTransport: {
					configuration: { mode: 'unknown', systems: [] },
					state: { mode: 'unknown', systems: [] },
				},
				sourceSyncAt: new Date('2026-07-12T19:36:47.369Z'),
				lastSyncedAt: new Date('2026-07-12T19:36:47.369Z'),
				updatedAt: new Date('2026-07-12T19:36:47.369Z'),
			},
			{
				structureId: 'hub-low',
				corporationId: 'corp-1',
				systemId: '30000143',
				systemName: 'Perimeter',
				name: 'Low ADM Hub',
				typeId: '32458',
				fuelAccessListId: null,
				controllerAllianceId: 'alliance-1',
				reagentBayLastUpdated: new Date('2026-07-12T19:36:46.834Z'),
				reagentBay: {
					lastUpdated: '2026-07-12T19:36:46.834Z',
					reagents: [],
				},
				resources: {
					power: { allocated: 100, available: 200 },
					workforce: { allocated: 300, available: 400 },
				},
				upgrades: [],
				vulnerabilityWindowStart: new Date('2026-07-13T08:40:00Z'),
				vulnerabilityWindowEnd: new Date('2026-07-13T15:20:00Z'),
				workforceTransport: {
					configuration: { mode: 'unknown', systems: [] },
					state: { mode: 'unknown', systems: [] },
				},
				sourceSyncAt: new Date('2026-07-12T19:36:47.369Z'),
				lastSyncedAt: new Date('2026-07-12T19:36:47.369Z'),
				updatedAt: new Date('2026-07-12T19:36:47.369Z'),
			},
		])
		db.query.structureSovereigntySystems.findMany.mockResolvedValue([
			{
				systemId: '30000142',
				systemName: 'Jita',
				corporationId: 'corp-1',
				claimType: 'alliance',
				allianceId: 'alliance-1',
				corporationClaimantId: null,
				factionId: null,
				claimedSince: new Date('2026-07-12T18:00:00Z'),
				sovereigntyHubStructureId: 'hub-high',
				isCapitalSystem: false,
				vulnerabilityWindowStart: new Date('2026-07-13T08:40:00Z'),
				vulnerabilityWindowEnd: new Date('2026-07-13T15:20:00Z'),
				activityDefenseMultiplier: '10.0',
				militaryLevel: 2,
				industrialLevel: 3,
				strategicLevel: 4,
				sourceSyncAt: new Date('2026-07-12T19:36:47.369Z'),
				lastSyncedAt: new Date('2026-07-12T19:36:47.369Z'),
				updatedAt: new Date('2026-07-12T19:36:47.369Z'),
			},
			{
				systemId: '30000143',
				systemName: 'Perimeter',
				corporationId: 'corp-1',
				claimType: 'alliance',
				allianceId: 'alliance-1',
				corporationClaimantId: null,
				factionId: null,
				claimedSince: new Date('2026-07-12T18:00:00Z'),
				sovereigntyHubStructureId: 'hub-low',
				isCapitalSystem: false,
				vulnerabilityWindowStart: new Date('2026-07-13T08:40:00Z'),
				vulnerabilityWindowEnd: new Date('2026-07-13T15:20:00Z'),
				activityDefenseMultiplier: '2.0',
				militaryLevel: 2,
				industrialLevel: 3,
				strategicLevel: 4,
				sourceSyncAt: new Date('2026-07-12T19:36:47.369Z'),
				lastSyncedAt: new Date('2026-07-12T19:36:47.369Z'),
				updatedAt: new Date('2026-07-12T19:36:47.369Z'),
			},
		])

		const result = await listSovereigntyStructures(
			{
				UNIVERSE: {} as never,
			} as never,
			db as never,
			{
				id: 'user-1',
				is_admin: true,
				roles: [],
			},
			{
				sortBy: 'activityDefenseMultiplier',
				sortDirection: 'asc',
			}
		)

		expect(result.items.map((item) => item.structureId)).toEqual(['hub-low', 'hub-high'])
		expect(result.items.map((item) => item.activityDefenseMultiplier)).toEqual(['2.0', '10.0'])
	})

	it('sorts sovereignty hubs by magmatic gas depletion time', async () => {
		const db = makeDb()
		mocks.getStubMock.mockReturnValue(db.universeStub)
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(
			new Date('2026-07-12T00:00:00Z').getTime()
		)
		db.query.structureSovereigntyHubs.findMany.mockResolvedValue([
			{
				structureId: 'hub-slow',
				corporationId: 'corp-1',
				systemId: '30000142',
				systemName: 'Jita',
				name: 'Slow Gas Hub',
				typeId: '32458',
				fuelAccessListId: null,
				controllerAllianceId: 'alliance-1',
				reagentBayLastUpdated: new Date('2026-07-12T19:36:46.834Z'),
				reagentBay: {
					lastUpdated: '2026-07-12T19:36:46.834Z',
					reagents: [
						{
							typeId: '81143',
							amount: 20,
							burningPerHour: 1,
							lastCycle: '2026-07-12T18:30:00Z',
						},
					],
				},
				resources: {
					power: { allocated: 100, available: 200 },
					workforce: { allocated: 300, available: 400 },
				},
				upgrades: [],
				vulnerabilityWindowStart: new Date('2026-07-13T08:40:00Z'),
				vulnerabilityWindowEnd: new Date('2026-07-13T15:20:00Z'),
				workforceTransport: {
					configuration: { mode: 'unknown', systems: [] },
					state: { mode: 'unknown', systems: [] },
				},
				sourceSyncAt: new Date('2026-07-12T19:36:47.369Z'),
				lastSyncedAt: new Date('2026-07-12T19:36:47.369Z'),
				updatedAt: new Date('2026-07-12T19:36:47.369Z'),
			},
			{
				structureId: 'hub-fast',
				corporationId: 'corp-1',
				systemId: '30000143',
				systemName: 'Perimeter',
				name: 'Fast Gas Hub',
				typeId: '32458',
				fuelAccessListId: null,
				controllerAllianceId: 'alliance-1',
				reagentBayLastUpdated: new Date('2026-07-12T19:36:46.834Z'),
				reagentBay: {
					lastUpdated: '2026-07-12T19:36:46.834Z',
					reagents: [
						{
							typeId: '81143',
							amount: 10,
							burningPerHour: 5,
							lastCycle: '2026-07-12T18:30:00Z',
						},
					],
				},
				resources: {
					power: { allocated: 100, available: 200 },
					workforce: { allocated: 300, available: 400 },
				},
				upgrades: [],
				vulnerabilityWindowStart: new Date('2026-07-13T08:40:00Z'),
				vulnerabilityWindowEnd: new Date('2026-07-13T15:20:00Z'),
				workforceTransport: {
					configuration: { mode: 'unknown', systems: [] },
					state: { mode: 'unknown', systems: [] },
				},
				sourceSyncAt: new Date('2026-07-12T19:36:47.369Z'),
				lastSyncedAt: new Date('2026-07-12T19:36:47.369Z'),
				updatedAt: new Date('2026-07-12T19:36:47.369Z'),
			},
		])
		db.query.structureSovereigntySystems.findMany.mockResolvedValue([
			{
				systemId: '30000142',
				systemName: 'Jita',
				corporationId: 'corp-1',
				claimType: 'alliance',
				allianceId: 'alliance-1',
				corporationClaimantId: null,
				factionId: null,
				claimedSince: new Date('2026-07-12T18:00:00Z'),
				sovereigntyHubStructureId: 'hub-slow',
				isCapitalSystem: false,
				vulnerabilityWindowStart: new Date('2026-07-13T08:40:00Z'),
				vulnerabilityWindowEnd: new Date('2026-07-13T15:20:00Z'),
				activityDefenseMultiplier: '1.2',
				militaryLevel: 2,
				industrialLevel: 3,
				strategicLevel: 4,
				sourceSyncAt: new Date('2026-07-12T19:36:47.369Z'),
				lastSyncedAt: new Date('2026-07-12T19:36:47.369Z'),
				updatedAt: new Date('2026-07-12T19:36:47.369Z'),
			},
			{
				systemId: '30000143',
				systemName: 'Perimeter',
				corporationId: 'corp-1',
				claimType: 'alliance',
				allianceId: 'alliance-1',
				corporationClaimantId: null,
				factionId: null,
				claimedSince: new Date('2026-07-12T18:00:00Z'),
				sovereigntyHubStructureId: 'hub-fast',
				isCapitalSystem: false,
				vulnerabilityWindowStart: new Date('2026-07-13T08:40:00Z'),
				vulnerabilityWindowEnd: new Date('2026-07-13T15:20:00Z'),
				activityDefenseMultiplier: '1.2',
				militaryLevel: 2,
				industrialLevel: 3,
				strategicLevel: 4,
				sourceSyncAt: new Date('2026-07-12T19:36:47.369Z'),
				lastSyncedAt: new Date('2026-07-12T19:36:47.369Z'),
				updatedAt: new Date('2026-07-12T19:36:47.369Z'),
			},
		])

		try {
			const result = await listSovereigntyStructures(
				{
					UNIVERSE: {} as never,
				} as never,
				db as never,
				{
					id: 'user-1',
					is_admin: true,
					roles: [],
				},
				{
					sortBy: 'magmaticGasEstimatedDepletionAt',
					sortDirection: 'asc',
				}
			)

			expect(result.items.map((item) => item.structureId)).toEqual(['hub-fast', 'hub-slow'])
		} finally {
			nowSpy.mockRestore()
		}
	})

	it('loads sovereignty hub details even when the base structure row is absent', async () => {
		const db = makeDb()
		mocks.getStubMock.mockReturnValue(db.universeStub)

		const result = await getVisibleStructureDetail(
			{
				UNIVERSE: {} as never,
				EVE_CORPORATION_DATA: {} as never,
			} as never,
			db as never,
			{
				id: 'user-1',
				is_admin: true,
				roles: [],
			},
			'hub-1'
		)

		expect(result).not.toBeNull()
		expect(result).toMatchObject({
			structureId: 'hub-1',
			corporationId: 'corp-1',
			name: 'Jita Hub',
			typeId: '32458',
			typeName: 'Sovereignty Hub',
			systemId: '30000142',
			systemName: 'Jita',
			regionId: '10000002',
			regionName: 'The Forge',
		})
		expect(result?.sovereignty).toMatchObject({
			claimType: 'alliance',
			sovereigntyHubStructureId: 'hub-1',
			controllerAllianceId: 'alliance-1',
		})
		expect(result?.sovereignty?.hub).toMatchObject({
			reagentCount: 1,
			resourcePowerAllocated: 100,
			resourceWorkforceAllocated: 300,
			upgradeCount: 1,
		})
	})
})
