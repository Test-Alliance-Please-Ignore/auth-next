import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import {
	canEditStructure,
	canViewDetailsStructure,
	canViewSensitiveStructure,
	computeStructureAccess,
	getStructureAccessTarget,
	getStructureDetail,
	getStructureTab,
	hasAnyStructureAccess,
	hasStructureAccessForTab,
	resolveStructureAccess,
} from '../../../services/structures.service'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('@repo/hono-helpers', () => ({
	logger: {
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	},
}))

type FakeDb = {
	query: {
		structureModuleConfig: {
			findFirst: ReturnType<typeof vi.fn>
		}
		corporationStructures: {
			findFirst: ReturnType<typeof vi.fn>
		}
		structureConfigs: {
			findFirst: ReturnType<typeof vi.fn>
		}
		managedCorporations: {
			findFirst: ReturnType<typeof vi.fn>
			findMany: ReturnType<typeof vi.fn>
		}
		structureSkyhooks: {
			findFirst: ReturnType<typeof vi.fn>
		}
		structureSkyhookReagents: {
			findFirst: ReturnType<typeof vi.fn>
		}
		structureMoonDrills: {
			findFirst: ReturnType<typeof vi.fn>
		}
		structureMiningExtractions: {
			findFirst: ReturnType<typeof vi.fn>
		}
		structureMiningExtractionHistory: {
			findMany: ReturnType<typeof vi.fn>
		}
		structureMoonGeographies: {
			findFirst: ReturnType<typeof vi.fn>
		}
		structureSovereigntyHubs: {
			findFirst: ReturnType<typeof vi.fn>
		}
		structureSovereigntySystems: {
			findFirst: ReturnType<typeof vi.fn>
		}
		corporationStructureInventory: {
			findMany: ReturnType<typeof vi.fn>
		}
		corporationStructureInventorySnapshots: {
			findFirst: ReturnType<typeof vi.fn>
		}
	}
}

function makeDb(
	options: { structure?: Record<string, unknown>; skyhook?: Record<string, unknown> } = {}
): FakeDb {
	const structure = options.structure ?? {
		structureId: 'structure-1',
		corporationId: 'corp-1',
		name: 'Structure One',
		typeId: '35832',
		typeName: 'Astrahus',
		systemId: '30000142',
		systemName: 'Jita',
		regionId: '10000002',
		regionName: 'The Forge',
		state: 'online',
		nextReinforceApply: null,
		stateTimerEnd: null,
		unanchorsAt: null,
		fuelExpires: null,
		fuelAmount: null,
		fuelBurnRate: null,
		lowPower: false,
		syncStatus: 'ok',
		syncFailureReason: null,
		lastSyncedAt: new Date('2026-01-01T00:00:00Z'),
		updatedAt: new Date('2026-01-01T00:00:00Z'),
	}

	const skyhook = options.skyhook ?? {
		structureId: 'skyhook-1',
		corporationId: 'corp-1',
		name: 'Skyhook One',
		typeId: '81080',
		typeName: 'Orbital Skyhook',
		systemId: '30000142',
		systemName: 'Jita',
		regionId: '10000002',
		regionName: 'The Forge',
		state: 'online',
		nextReinforceApply: null,
		stateTimerEnd: null,
		unanchorsAt: null,
		fuelExpires: null,
		fuelAmount: 2000,
		lowPower: false,
		syncStatus: 'ok',
		syncFailureReason: null,
		lastSyncedAt: new Date('2026-01-01T00:00:00Z'),
		updatedAt: new Date('2026-01-01T00:00:00Z'),
	}

	return {
		query: {
			structureModuleConfig: {
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
			},
			corporationStructures: {
				findFirst: vi.fn().mockResolvedValue(structure),
			},
			structureConfigs: {
				findFirst: vi.fn().mockResolvedValue({
					structureId: 'structure-1',
					hidden: false,
					lowPowerAllowed: true,
					assignedGroupId: null,
					createdAt: new Date('2026-01-01T00:00:00Z'),
					updatedAt: new Date('2026-01-01T00:00:00Z'),
				}),
			},
			managedCorporations: {
				findFirst: vi.fn().mockResolvedValue({
					corporationId: 'corp-1',
					name: 'Test Corp',
					includeInStructureAssetSync: false,
				}),
				findMany: vi.fn().mockResolvedValue([]),
			},
			structureSkyhooks: {
				findFirst: vi.fn().mockResolvedValue(options.skyhook ?? skyhook),
			},
			structureSkyhookReagents: {
				findFirst: vi.fn().mockResolvedValue({
					structureId: 'skyhook-1',
					corporationId: 'corp-1',
					magmaticGasSecuredStock: 12,
					magmaticGasUnsecuredStock: 34,
					magmaticGasLastCycle: new Date('2026-01-01T01:00:00Z'),
					superionicIceSecuredStock: 56,
					superionicIceUnsecuredStock: 78,
					superionicIceLastCycle: new Date('2026-01-01T02:00:00Z'),
					updatedAt: new Date('2026-01-01T02:00:00Z'),
				}),
			},
			structureMoonDrills: {
				findFirst: vi.fn().mockResolvedValue(null),
			},
			structureMiningExtractions: {
				findFirst: vi.fn().mockResolvedValue(null),
			},
			structureMiningExtractionHistory: {
				findMany: vi.fn().mockResolvedValue([]),
			},
			structureMoonGeographies: {
				findFirst: vi.fn().mockResolvedValue(null),
			},
			structureSovereigntyHubs: {
				findFirst: vi.fn().mockResolvedValue(null),
			},
			structureSovereigntySystems: {
				findFirst: vi.fn().mockResolvedValue(null),
			},
			corporationStructureInventory: {
				findMany: vi.fn().mockResolvedValue([]),
			},
			corporationStructureInventorySnapshots: {
				findFirst: vi.fn().mockResolvedValue({ id: 'snapshot-1' }),
			},
		},
	} as unknown as FakeDb
}

describe('structure permission gating', () => {
	it('classifies navigation structures in the general Structures family', () => {
		expect(getStructureTab({ typeId: '35841', typeName: 'Ansiblex Jump Gate' })).toBe('structures')
		expect(getStructureTab({ typeId: '81826', typeName: 'Metenox Moon Drill' })).toBe('moon-drills')
		expect(getStructureTab({ typeId: '12235', typeName: 'Control Tower' })).toBe('poses')
	})

	it('shows moon drill geography without requiring a separate moon drill row', async () => {
		const db = makeDb({
			structure: {
				structureId: 'structure-1',
				corporationId: 'corp-1',
				name: 'Moon Drill One',
				typeId: '81826',
				typeName: 'Metenox Moon Drill',
				systemId: '30000142',
				systemName: 'Jita',
				regionId: '10000002',
				regionName: 'The Forge',
				state: 'online',
				nextReinforceApply: null,
				stateTimerEnd: null,
				unanchorsAt: null,
				fuelExpires: null,
				fuelAmount: null,
				fuelBurnRate: null,
				lowPower: false,
				syncStatus: 'ok',
				syncFailureReason: null,
				lastSyncedAt: new Date('2026-01-01T00:00:00Z'),
				updatedAt: new Date('2026-01-01T00:00:00Z'),
			},
		})
		db.query.structureMoonGeographies.findFirst.mockResolvedValue({
			structureId: 'structure-1',
			corporationId: 'corp-1',
			moonId: '40129194',
			moonName: 'Moon 1',
			planetId: '40129193',
			planetName: 'Planet 1',
			systemId: '30000142',
			systemName: 'Jita',
		})
		const env = {
			MOON_SCAN: {},
			UNIVERSE: {},
		}
		const moonScan = {
			getVerifiedComposition: vi.fn().mockResolvedValue({
				moonId: '40129194',
				sourceScanId: 'scan-1',
				verifiedAt: '2026-07-31T00:00:00.000Z',
				verifiedBy: null,
				ores: [{ oreTypeId: '45490', quantity: '0.25' }],
			}),
		}
		const universe = {
			resolveTypeNamesByIds: vi.fn().mockResolvedValue({
				'45490': { typeName: 'Chromite' },
			}),
		}
		vi.mocked(getStub).mockImplementation((namespace) => {
			if (namespace === env.MOON_SCAN) return moonScan as never
			return universe as never
		})

		const result = await getStructureDetail(
			env as never,
			db as never,
			{
				id: 'user-details',
				is_admin: false,
				roles: ['urn:structures:all:details'],
			},
			'structure-1'
		)

		expect(result?.moonDrill).toEqual({
			moonId: '40129194',
			moonName: 'Moon 1',
			planetId: '40129193',
			planetName: 'Planet 1',
			systemId: '30000142',
			systemName: 'Jita',
		})
		expect(moonScan.getVerifiedComposition).toHaveBeenCalledWith('40129194')
		expect(result?.moonComposition?.ores).toEqual([
			{ typeId: '45490', typeName: 'Chromite', quantity: '0.25', rarity: 'R4' },
		])
	})

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('computes access levels for all-scope roles', () => {
		const access = computeStructureAccess(['urn:structures:all:viewer'], false)
		const target = getStructureAccessTarget(access, 'structures')

		expect(hasAnyStructureAccess(target)).toBe(true)
		expect(hasStructureAccessForTab(access, 'corp-1', 'structures')).toBe(true)
		expect(canViewDetailsStructure(access, 'corp-1', 'structures')).toBe(false)
		expect(canViewSensitiveStructure(access, 'corp-1', 'structures')).toBe(false)
		expect(canEditStructure(access, 'corp-1', 'structures')).toBe(false)
	})

	it('grants details, sensitive, and manager access in the expected order', () => {
		const detailsAccess = computeStructureAccess(['urn:structures:corp-1:details'], false)
		expect(canViewDetailsStructure(detailsAccess, 'corp-1', 'structures')).toBe(true)
		expect(canViewSensitiveStructure(detailsAccess, 'corp-1', 'structures')).toBe(false)
		expect(canEditStructure(detailsAccess, 'corp-1', 'structures')).toBe(false)

		const sensitiveAccess = computeStructureAccess(['urn:structures:corp-1:sensitive'], false)
		expect(canViewDetailsStructure(sensitiveAccess, 'corp-1', 'structures')).toBe(true)
		expect(canViewSensitiveStructure(sensitiveAccess, 'corp-1', 'structures')).toBe(true)
		expect(canEditStructure(sensitiveAccess, 'corp-1', 'structures')).toBe(false)

		const managerAccess = computeStructureAccess(['urn:structures:corp-1:manager'], false)
		expect(canViewDetailsStructure(managerAccess, 'corp-1', 'structures')).toBe(true)
		expect(canViewSensitiveStructure(managerAccess, 'corp-1', 'structures')).toBe(true)
		expect(canEditStructure(managerAccess, 'corp-1', 'structures')).toBe(true)
	})

	it('unions access across scopes and corporations', () => {
		const access = computeStructureAccess(
			['urn:structures:corp-1:viewer', 'urn:structures:corp-2:sensitive'],
			false
		)

		expect(hasStructureAccessForTab(access, 'corp-1', 'structures')).toBe(true)
		expect(hasStructureAccessForTab(access, 'corp-2', 'structures')).toBe(true)
		expect(canViewDetailsStructure(access, 'corp-1', 'structures')).toBe(false)
		expect(canViewSensitiveStructure(access, 'corp-2', 'structures')).toBe(true)
	})

	it('merges implicit sensitive access across every tab without granting edits', async () => {
		const db = makeDb()
		db.query.managedCorporations.findMany.mockResolvedValue([{ corporationId: 'corp-1' }])

		const access = await resolveStructureAccess(db as never, {
			id: 'user-ceo',
			is_admin: false,
			roles: [],
			implicitSensitiveCorporationIds: ['corp-1'],
		})

		for (const tab of [
			'structures',
			'sovereignty',
			'skyhooks',
			'poses',
			'mining-citadels',
			'moon-drills',
		] as const) {
			expect(hasStructureAccessForTab(access, 'corp-1', tab)).toBe(true)
			expect(canViewDetailsStructure(access, 'corp-1', tab)).toBe(true)
			expect(canViewSensitiveStructure(access, 'corp-1', tab)).toBe(true)
			expect(canEditStructure(access, 'corp-1', tab)).toBe(false)
		}
	})

	it('returns null for viewer-only detail access and hydrates details for details access', async () => {
		const db = makeDb()
		const env = {
			UNIVERSE: {} as never,
			EVE_CORPORATION_DATA: {} as never,
		}

		const viewerResult = await getStructureDetail(
			env as never,
			db as never,
			{
				id: 'user-viewer',
				is_admin: false,
				roles: ['urn:structures:all:viewer'],
			},
			'structure-1'
		)
		expect(viewerResult).toBeNull()

		const detailsResult = await getStructureDetail(
			env as never,
			db as never,
			{
				id: 'user-details',
				is_admin: false,
				roles: ['urn:structures:all:details'],
			},
			'structure-1'
		)
		expect(detailsResult).not.toBeNull()
		expect(detailsResult?.canEdit).toBe(false)
	})

	it('hydrates skyhook detail reagent data from the companion table', async () => {
		const skyhookStructure = {
			structureId: 'skyhook-1',
			corporationId: 'corp-1',
			name: 'Skyhook One',
			typeId: '81080',
			typeName: 'Orbital Skyhook',
			systemId: '30000142',
			systemName: 'Jita',
			regionId: '10000002',
			regionName: 'The Forge',
			state: 'online',
			nextReinforceApply: null,
			stateTimerEnd: null,
			unanchorsAt: null,
			fuelExpires: null,
			fuelAmount: null,
			fuelBurnRate: null,
			lowPower: false,
			syncStatus: 'ok',
			syncFailureReason: null,
			lastSyncedAt: new Date('2026-01-01T00:00:00Z'),
			updatedAt: new Date('2026-01-01T00:00:00Z'),
		}
		const db = makeDb({
			structure: skyhookStructure,
			skyhook: skyhookStructure,
		})
		const env = {
			UNIVERSE: {} as never,
			EVE_CORPORATION_DATA: {} as never,
		}

		const result = await getStructureDetail(
			env as never,
			db as never,
			{
				id: 'user-details',
				is_admin: false,
				roles: ['urn:structures:all:details'],
			},
			'skyhook-1'
		)

		expect(result?.skyhook).not.toBeNull()
		expect(result?.skyhook?.totalReagents).toBe(2)
		expect(result?.skyhook?.totalSecuredStock).toBe(68)
		expect(result?.skyhook?.totalUnsecuredStock).toBe(112)
		expect(result?.skyhook?.reagents).toEqual([
			expect.objectContaining({
				typeId: '81143',
				securedStock: 12,
				unsecuredStock: 34,
			}),
			expect.objectContaining({
				typeId: '81144',
				securedStock: 56,
				unsecuredStock: 78,
			}),
		])
	})

	it('serializes reinforced skyhook timestamps returned as strings', async () => {
		const reinforcementTimerEnd = '2026-01-01T06:00:00.000Z'
		const db = makeDb({
			structure: {
				structureId: 'skyhook-1',
				corporationId: 'corp-1',
				name: 'Skyhook One',
				typeId: '81080',
				typeName: 'Orbital Skyhook',
				systemId: '30000142',
				systemName: 'Jita',
				regionId: '10000002',
				regionName: 'The Forge',
				state: 'reinforced',
				nextReinforceApply: null,
				stateTimerEnd: null,
				unanchorsAt: null,
				fuelExpires: null,
				fuelAmount: null,
				fuelBurnRate: null,
				lowPower: false,
				syncStatus: 'ok',
				syncFailureReason: null,
				lastSyncedAt: new Date('2026-01-01T00:00:00Z'),
				updatedAt: new Date('2026-01-01T00:00:00Z'),
			},
			skyhook: {
				structureId: 'skyhook-1',
				corporationId: 'corp-1',
				state: 'reinforced',
				isActive: true,
				reinforcementTimerEnd,
			},
		})
		const env = {
			UNIVERSE: {} as never,
			EVE_CORPORATION_DATA: {} as never,
		}

		const result = await getStructureDetail(
			env as never,
			db as never,
			{
				id: 'user-details',
				is_admin: false,
				roles: ['urn:structures:all:details'],
			},
			'skyhook-1'
		)

		expect(result?.skyhook?.state).toBe('reinforced')
		expect(result?.skyhook?.reinforcementTimerEnd).toBe(reinforcementTimerEnd)
	})

	it('enriches an active mining extraction with the verified moon composition', async () => {
		const miningStructure = {
			structureId: 'mining-1',
			corporationId: 'corp-1',
			name: 'Mining One',
			typeId: '35835',
			typeName: 'Athanor',
			systemId: '30005196',
			systemName: 'Ahbazon',
			regionId: '10000001',
			regionName: 'Domain',
			state: 'online',
			nextReinforceApply: null,
			stateTimerEnd: null,
			unanchorsAt: null,
			fuelExpires: null,
			fuelAmount: null,
			fuelBurnRate: null,
			lowPower: false,
			syncStatus: 'ok',
			syncFailureReason: null,
			lastSyncedAt: new Date('2026-01-01T00:00:00Z'),
			updatedAt: new Date('2026-01-01T00:00:00Z'),
		}
		const db = makeDb({ structure: miningStructure })
		const miningExtraction = {
			structureId: 'mining-1',
			corporationId: 'corp-1',
			extractionStartTime: new Date('2026-08-01T00:00:00Z'),
			chunkArrivalTime: new Date('2026-08-02T00:00:00Z'),
			naturalDecayTime: new Date('2026-08-02T03:00:00Z'),
		}
		const moonGeography = {
			structureId: 'mining-1',
			corporationId: 'corp-1',
			moonId: '40129194',
			moonName: 'Moon 1',
			planetId: '40129193',
			planetName: 'Planet 1',
			systemId: '30005196',
			systemName: 'Ahbazon',
		}
		db.query.structureMiningExtractions.findFirst.mockResolvedValue(miningExtraction)
		db.query.structureMoonGeographies.findFirst.mockResolvedValue(moonGeography)

		const moonScan = {
			getVerifiedComposition: vi.fn().mockResolvedValue({
				moonId: '40129194',
				sourceScanId: 'scan-1',
				verifiedAt: '2026-07-31T00:00:00.000Z',
				verifiedBy: null,
				ores: [{ oreTypeId: '45490', quantity: '0.25' }],
			}),
			getExtractionSettings: vi.fn().mockResolvedValue({
				defaultReprocessingYield: '0.5',
				defaultCycleDays: 30,
				fuelBlockPriceOverride: '2',
				magmaticGasPriceOverride: null,
			}),
			getStructureProfiles: vi.fn().mockResolvedValue([
				{
					id: 'tatara',
					baseVolumePerHr: '1',
					rigBonus: '0',
					fuelPerHr: '1',
					magmaticGasPerHr: '99',
					isPassive: false,
					nullsecModifier: '1',
					lowsecModifier: '1',
				},
			]),
		}
		const universe = {
			getTypeMaterials: vi.fn().mockResolvedValue({ '45490': [] }),
			resolveTypeNamesByIds: vi.fn().mockResolvedValue({
				'45490': { typeName: 'Chromite' },
			}),
		}
		const markets = {
			getBatchMarketDataAtTime: vi.fn().mockResolvedValue({ prices: [], missingTypeIds: [] }),
		}
		const env = {
			MOON_SCAN: {},
			MARKETS: {},
			UNIVERSE: {},
			EVE_CORPORATION_DATA: {},
		}
		vi.mocked(getStub).mockImplementation((namespace) => {
			if (namespace === env.MOON_SCAN) return moonScan as never
			if (namespace === env.MARKETS) return markets as never
			return universe as never
		})

		const result = await getStructureDetail(
			env as never,
			db as never,
			{
				id: 'user-details',
				is_admin: false,
				roles: ['urn:structures:all:details'],
			},
			'mining-1'
		)

		expect(moonScan.getVerifiedComposition).toHaveBeenCalledWith('40129194')
		expect(universe.resolveTypeNamesByIds).toHaveBeenCalledWith(['45490'])
		expect(result?.miningExtraction?.composition).toMatchObject({
			ores: [{ typeId: '45490', typeName: 'Chromite', quantity: '0.25', rarity: 'R4' }],
			profitability: {
				structureType: 'tatara',
				cycleDays: 30,
				fuelCost: '1440',
				grossIsk: '0',
				profit: '-1440',
			},
		})
		expect(result?.miningExtractionComposition?.ores).toEqual([
			{ typeId: '45490', typeName: 'Chromite', quantity: '0.25', rarity: 'R4' },
		])
	})
})
