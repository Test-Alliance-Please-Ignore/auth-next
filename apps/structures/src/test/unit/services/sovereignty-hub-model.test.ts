import { describe, expect, it, vi } from 'vitest'

import {
	estimateSovereigntyReagentAmount,
	getEstimatedSovereigntyReagent,
	getSovereigntyReagentBaySummary,
} from '@repo/structures'

import {
	buildSovereigntyWhere,
	computeStructureAccess,
	getStructureDetail,
	listSovereigntyStructures,
} from '../../../services/structures.service'

const mocks = vi.hoisted(() => {
	const getStubMock = vi.fn()
	return { getStubMock }
})

type ReagentFixture = {
	typeId: string
	amount: number
	burningPerHour: number
	lastCycle: string
}

type ReagentBayFixture = {
	lastUpdated: string
	reagents: ReagentFixture[]
}

type SovereigntyHubFixture = {
	structureId: string
	corporationId: string
	systemId: string
	systemName: string
	name: string
	typeId: string
	fuelAccessListId: string | null
	controllerAllianceId: string | null
	controllerAllianceName?: string | null
	reagentBayLastUpdated?: Date | null
	reagentBay?: ReagentBayFixture | null
	resources?: {
		power: { allocated: number; available: number }
		workforce: { allocated: number; available: number }
	} | null
	upgrades?: Array<{ typeId: string; powerState: string }> | null
	vulnerabilityWindowStart?: Date | null
	vulnerabilityWindowEnd?: Date | null
	workforceTransport?: {
		configuration: { mode: string; systems: string[] }
		state: { mode: string; systems: string[] }
	} | null
	syncStatus?: string | null
	syncFailureReason?: string | null
	lastAttemptedSyncAt?: Date | null
	sourceSyncAt?: Date | null
	lastSyncedAt?: Date | null
	updatedAt?: Date | null
}

type SovereigntySystemFixture = {
	systemId: string
	systemName: string
	corporationId: string
	regionId?: string | null
	regionName?: string | null
	claimType: string
	allianceId: string | null
	allianceName?: string | null
	corporationClaimantId: string | null
	factionId: string | null
	claimedSince: Date | null
	sovereigntyHubStructureId: string | null
	isCapitalSystem: boolean
	vulnerabilityWindowStart: Date | null
	vulnerabilityWindowEnd: Date | null
	activityDefenseMultiplier: string | null
	militaryLevel: number
	industrialLevel: number
	strategicLevel: number
	sourceSyncAt: Date | null
	lastSyncedAt: Date | null
	updatedAt: Date | null
}

type ManagedCorporationFixture = {
	corporationId: string
	name: string
	includeInStructureAssetSync: boolean
}

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
		findMany: vi.fn<() => Promise<ManagedCorporationFixture[]>>().mockResolvedValue([
			{
				corporationId: 'corp-1',
				name: 'Test Corp',
				includeInStructureAssetSync: true,
			},
		]),
		findFirst: vi.fn<() => Promise<ManagedCorporationFixture | null>>().mockResolvedValue({
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
	const corporationStructureInventorySnapshots = {
		findFirst: vi.fn().mockResolvedValue({ id: 'snapshot-1' }),
	}
	const structureSovereigntyHubs = {
		findMany: vi.fn<() => Promise<SovereigntyHubFixture[]>>().mockResolvedValue([
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
		findFirst: vi.fn<() => Promise<SovereigntyHubFixture | null>>().mockResolvedValue({
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
		}),
	}
	const structureSovereigntySystems = {
		findMany: vi.fn<() => Promise<SovereigntySystemFixture[]>>().mockResolvedValue([
			{
				systemId: '30000142',
				systemName: 'Jita',
				corporationId: 'corp-1',
				regionId: '10000002',
				regionName: 'The Forge',
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
		findFirst: vi.fn<() => Promise<SovereigntySystemFixture | null>>().mockResolvedValue({
			systemId: '30000142',
			systemName: 'Jita',
			corporationId: 'corp-1',
			regionId: '10000002',
			regionName: 'The Forge',
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

	const buildSovereigntyRows = async () => {
		const [hubs, systems, corporations] = await Promise.all([
			structureSovereigntyHubs.findMany(),
			structureSovereigntySystems.findMany(),
			managedCorporations.findMany(),
		])

		return systems.map((system) => {
			const hub = hubs.find(
				(candidate) =>
					candidate.structureId === system.sovereigntyHubStructureId ||
					candidate.systemId === system.systemId
			)
			const corporation = corporations.find(
				(candidate) => candidate.corporationId === system.corporationId
			)

			return {
				structureId: hub?.structureId ?? system.sovereigntyHubStructureId ?? system.systemId,
				corporationId: system.corporationId,
				corporationName: corporation?.name ?? null,
				includeInStructureAssetSync: corporation?.includeInStructureAssetSync ?? false,
				typeId: hub?.typeId ?? '32458',
				typeName: 'Sovereignty Hub',
				systemId: system.systemId,
				systemName: system.systemName,
				regionId: system.regionId ?? null,
				regionName: system.regionName ?? null,
				claimType: system.claimType,
				allianceId: system.allianceId,
				allianceName: system.allianceName,
				corporationClaimantId: system.corporationClaimantId,
				factionId: system.factionId,
				claimedSince: system.claimedSince,
				sovereigntyHubStructureId: system.sovereigntyHubStructureId,
				isCapitalSystem: system.isCapitalSystem,
				vulnerabilityWindowStart: system.vulnerabilityWindowStart,
				vulnerabilityWindowEnd: system.vulnerabilityWindowEnd,
				activityDefenseMultiplier: system.activityDefenseMultiplier,
				militaryLevel: system.militaryLevel,
				industrialLevel: system.industrialLevel,
				strategicLevel: system.strategicLevel,
				controllerAllianceId: hub?.controllerAllianceId ?? null,
				controllerAllianceName: hub?.controllerAllianceName ?? null,
				reagentBayLastUpdated: hub?.reagentBayLastUpdated ?? null,
				reagentBay: hub?.reagentBay ?? null,
				resources: hub?.resources ?? null,
				upgrades: hub?.upgrades ?? null,
				workforceTransport: hub?.workforceTransport ?? null,
				syncStatus: hub?.syncStatus ?? 'warning',
				syncFailureReason: hub?.syncFailureReason ?? null,
				lastAttemptedSyncAt: hub?.lastAttemptedSyncAt ?? null,
				sourceSyncAt: hub?.sourceSyncAt ?? system.sourceSyncAt ?? null,
				lastSyncedAt: hub?.lastSyncedAt ?? system.lastSyncedAt ?? null,
				updatedAt: system.updatedAt ?? hub?.updatedAt ?? new Date(),
			}
		})
	}

	const sortRows = (rows: Awaited<ReturnType<typeof buildSovereigntyRows>>) => {
		if (rows.length < 2) {
			return rows
		}

		const activityValues = rows.map((row) => Number(row.activityDefenseMultiplier))
		if (
			activityValues.some((value) => Number.isFinite(value)) &&
			new Set(activityValues).size > 1
		) {
			return [...rows].sort(
				(a, b) =>
					Number(a.activityDefenseMultiplier ?? Number.POSITIVE_INFINITY) -
					Number(b.activityDefenseMultiplier ?? Number.POSITIVE_INFINITY)
			)
		}

		return [...rows].sort((a, b) => {
			const getDepletionAt = (row: (typeof rows)[number]) => {
				const reagent = row.reagentBay?.reagents?.find((entry) => entry.typeId === '81143')
				if (!reagent || reagent.amount <= 0 || reagent.burningPerHour <= 0) {
					return Number.POSITIVE_INFINITY
				}
				return Date.now() + (reagent.amount / reagent.burningPerHour) * 60 * 60 * 1000
			}
			return getDepletionAt(a) - getDepletionAt(b)
		})
	}

	let summaryCountCall = 0
	const buildQuery = (selection: Record<string, unknown>, distinct = false) => {
		const query = {} as Record<string, any>
		query.from = () => query
		query.leftJoin = () => query
		query.where = () => query
		query.orderBy = () => query
		query.limit = () => query
		query.offset = () => query
		query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
			Promise.resolve()
				.then(async () => {
					const rows = sortRows(await buildSovereigntyRows())
					const keys = Object.keys(selection)

					if (distinct) {
						if (keys.includes('corporationId')) {
							return rows.map(({ corporationId, corporationName }) => ({
								corporationId,
								corporationName,
							}))
						}
						if (keys.includes('regionId')) {
							return rows.map(({ regionId, regionName }) => ({ regionId, regionName }))
						}
						if (keys.includes('systemId')) {
							return rows.map(({ systemId, systemName }) => ({ systemId, systemName }))
						}
						return rows.map(({ controllerAllianceId }) => ({ controllerAllianceId }))
					}

					if (keys.includes('total')) {
						return [{ total: rows.length }]
					}
					if (keys.includes('count')) {
						const countCall = summaryCountCall++
						if (countCall === 0) {
							return [
								{
									count: rows.filter((row) =>
										row.reagentBay?.reagents?.some((entry) => entry.amount > 0)
									).length,
								},
							]
						}
						if (countCall === 1 || countCall === 2) {
							const count = rows.filter((row) => {
								const start = row.vulnerabilityWindowStart?.getTime?.()
								const end = row.vulnerabilityWindowEnd?.getTime?.()
								if (start === undefined || end === undefined) return false
								return countCall === 1
									? Date.now() >= start && Date.now() <= end
									: Date.now() < start || Date.now() > end
							})
							return [{ count: count.length }]
						}
						return [{ count: rows.length }]
					}
					if (keys.includes('magmaticGasBurningPerHour')) {
						const reagents = rows.flatMap((row) => row.reagentBay?.reagents ?? [])
						const active = reagents.filter(
							(reagent) =>
								reagent.typeId === '81143' && reagent.amount > 0 && reagent.burningPerHour > 0
						)
						const activeIce = reagents.filter(
							(reagent) =>
								reagent.typeId === '81144' && reagent.amount > 0 && reagent.burningPerHour > 0
						)
						return [
							{
								magmaticGasBurningPerHour: active.length
									? active.reduce((sum, reagent) => sum + reagent.burningPerHour, 0).toFixed(4)
									: null,
								magmaticGasBurningSampleCount: active.length,
								superionicIceBurningPerHour: activeIce.length
									? activeIce.reduce((sum, reagent) => sum + reagent.burningPerHour, 0).toFixed(4)
									: null,
								superionicIceBurningSampleCount: activeIce.length,
							},
						]
					}
					return rows
				})
				.then(resolve, reject)

		return query
	}

	const cteFields = Object.fromEntries(
		[
			' structureId',
			'corporationId',
			'corporationName',
			'includeInStructureAssetSync',
			'typeId',
			'typeName',
			'systemId',
			'systemName',
			'regionId',
			'regionName',
			'claimType',
			'allianceId',
			'allianceName',
			'corporationClaimantId',
			'factionId',
			'claimedSince',
			'sovereigntyHubStructureId',
			'isCapitalSystem',
			'vulnerabilityWindowStart',
			'vulnerabilityWindowEnd',
			'activityDefenseMultiplier',
			'militaryLevel',
			'industrialLevel',
			'strategicLevel',
			'controllerAllianceId',
			'controllerAllianceName',
			'reagentBayLastUpdated',
			'reagentBay',
			'resources',
			'upgrades',
			'workforceTransport',
			'syncStatus',
			'syncFailureReason',
			'lastAttemptedSyncAt',
			'sourceSyncAt',
			'lastSyncedAt',
			'updatedAt',
		].map((name) => [name.trim(), name.trim()])
	)

	return {
		universeStub,
		query: {
			corporationStructures,
			structureModuleConfig,
			structureConfigs,
			managedCorporations,
			corporationStructureInventorySnapshots,
			corporationStructureInventory,
			structureSovereigntyHubs,
			structureSovereigntySystems,
		},
		$with: vi.fn(() => ({ as: vi.fn(() => cteFields) })),
		select: vi.fn((selection: Record<string, unknown>) => buildQuery(selection)),
		with: vi.fn(() => ({
			select: (selection: Record<string, unknown>) => buildQuery(selection),
			selectDistinct: (selection: Record<string, unknown>) => buildQuery(selection, true),
		})),
	}
}

describe('sovereignty hub model', () => {
	it('projects reagent amounts from the ESI baseline at query time', () => {
		const referenceTimeMs = Date.parse('2026-09-02T12:00:00.000Z')
		const reagent = {
			typeId: '81143',
			amount: 100,
			burningPerHour: 10,
			lastCycle: '2026-09-02T08:00:00.000Z',
		}
		const lastUpdated = '2026-09-02T06:00:00.000Z'

		expect(estimateSovereigntyReagentAmount(reagent, lastUpdated, referenceTimeMs)).toBe(40)
		expect(getEstimatedSovereigntyReagent(reagent, lastUpdated, referenceTimeMs)).toMatchObject({
			estimatedAmount: 40,
			estimatedDepletionAt: '2026-09-02T16:00:00.000Z',
		})

		const summary = getSovereigntyReagentBaySummary(
			{
				lastUpdated,
				summary: {
					reagentCount: 1,
					magmaticGasQuantity: 100,
					magmaticGasBurningPerHour: 10,
					magmaticGasEstimatedDepletionAt: '2026-09-02T22:00:00.000Z',
					superionicIceQuantity: 0,
					superionicIceBurningPerHour: 0,
					superionicIceEstimatedDepletionAt: null,
				},
				reagents: [reagent],
			},
			referenceTimeMs
		)
		expect(summary?.magmaticGasQuantity).toBe(40)
		expect(summary?.magmaticGasEstimatedDepletionAt).toBe('2026-09-02T16:00:00.000Z')

		expect(
			estimateSovereigntyReagentAmount(reagent, '2026-09-02T13:00:00.000Z', referenceTimeMs)
		).toBe(100)
		expect(
			estimateSovereigntyReagentAmount(
				{ ...reagent, amount: 100.5 },
				'2026-09-02T06:00:00.000Z',
				referenceTimeMs
			)
		).toBe(40)
		expect(
			estimateSovereigntyReagentAmount(
				{ ...reagent, amount: 100.5, burningPerHour: 0 },
				lastUpdated,
				referenceTimeMs
			)
		).toBe(100)
	})

	it('scopes sovereignty queries to the corporations allowed for the sovereignty tab', () => {
		const access = computeStructureAccess(['urn:structures:corp-1:sensitive'], false)
		const condition = buildSovereigntyWhere(access, {}) as { queryChunks?: unknown[] }
		const chunks = condition.queryChunks ?? []

		expect(
			chunks.some((chunk) => String((chunk as { value?: unknown }).value ?? '') === ' in ')
		).toBe(true)
	})

	it('lists sovereignty hubs without requiring corporation structures rows', async () => {
		const db = makeDb()
		mocks.getStubMock.mockReturnValue(db.universeStub)
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-12T00:00:00Z').getTime())

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
			expect(result.summary).toMatchObject({
				lowFuel: 1,
				magmaticGasBurningPerHour: '4.0000',
				superionicIceBurningPerHour: '6.0000',
				magmaticGasBurningSampleCount: 1,
				superionicIceBurningSampleCount: 1,
			})
		} finally {
			nowSpy.mockRestore()
		}
	})

	it('ignores zero-quantity sovereignty reagents when determining low fuel and burn totals', async () => {
		const db = makeDb()
		mocks.getStubMock.mockReturnValue(db.universeStub)
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-12T00:00:00Z').getTime())

		db.query.structureSovereigntyHubs.findMany.mockResolvedValue([
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
							amount: 0,
							burningPerHour: 4,
							lastCycle: '2026-07-12T18:30:00Z',
						},
						{
							typeId: '81144',
							amount: 0,
							burningPerHour: 6,
							lastCycle: '2026-07-12T19:00:00Z',
						},
					],
				},
				resources: {
					power: { allocated: 100, available: 200 },
					workforce: { allocated: 300, available: 400 },
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
				sovereigntyHubStructureId: 'hub-1',
				isCapitalSystem: false,
				vulnerabilityWindowStart: null,
				vulnerabilityWindowEnd: null,
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
				}
			)

			expect(result.summary).toMatchObject({
				lowFuel: 0,
				magmaticGasBurningPerHour: null,
				superionicIceBurningPerHour: null,
				magmaticGasBurningSampleCount: 0,
				superionicIceBurningSampleCount: 0,
			})
		} finally {
			nowSpy.mockRestore()
		}
	})

	it('marks sovereignty hub snapshots as warning after 12 hours and error after 24 hours', async () => {
		const db = makeDb()
		mocks.getStubMock.mockReturnValue(db.universeStub)
		const now = new Date('2026-07-21T12:00:00Z').getTime()
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)

		const makeRows = (lastSyncedAt: Date) => [
			{
				structureId: 'hub-1',
				corporationId: 'corp-1',
				systemId: '30000142',
				systemName: 'Jita',
				name: 'Jita Hub',
				typeId: '32458',
				fuelAccessListId: null,
				controllerAllianceId: 'alliance-1',
				reagentBayLastUpdated: lastSyncedAt,
				reagentBay: {
					lastUpdated: lastSyncedAt.toISOString(),
					reagents: [],
				},
				resources: {
					power: { allocated: 100, available: 200 },
					workforce: { allocated: 300, available: 400 },
				},
				upgrades: [],
				vulnerabilityWindowStart: null,
				vulnerabilityWindowEnd: null,
				workforceTransport: {
					configuration: { mode: 'unknown', systems: [] },
					state: { mode: 'unknown', systems: [] },
				},
				sourceSyncAt: lastSyncedAt,
				lastSyncedAt,
				updatedAt: lastSyncedAt,
			},
		]

		const makeSystems = (lastSyncedAt: Date) => [
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
				vulnerabilityWindowStart: null,
				vulnerabilityWindowEnd: null,
				activityDefenseMultiplier: '1.2',
				militaryLevel: 2,
				industrialLevel: 3,
				strategicLevel: 4,
				sourceSyncAt: lastSyncedAt,
				lastSyncedAt,
				updatedAt: lastSyncedAt,
			},
		]

		try {
			db.query.structureSovereigntyHubs.findMany.mockResolvedValue(
				makeRows(new Date(now - 13 * 60 * 60 * 1000))
			)
			db.query.structureSovereigntySystems.findMany.mockResolvedValue(
				makeSystems(new Date(now - 13 * 60 * 60 * 1000))
			)

			const warningResult = await listSovereigntyStructures(
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

			expect(warningResult.items[0]?.syncStatus).toBe('warning')

			db.query.structureSovereigntyHubs.findMany.mockResolvedValue(
				makeRows(new Date(now - 25 * 60 * 60 * 1000))
			)
			db.query.structureSovereigntySystems.findMany.mockResolvedValue(
				makeSystems(new Date(now - 25 * 60 * 60 * 1000))
			)

			const errorResult = await listSovereigntyStructures(
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

			expect(errorResult.items[0]?.syncStatus).toBe('error')
		} finally {
			nowSpy.mockRestore()
		}
	})

	it('prefers an explicit sync error over freshness when the hub snapshot records a failure', async () => {
		const db = makeDb()
		mocks.getStubMock.mockReturnValue(db.universeStub)

		db.query.structureSovereigntyHubs.findMany.mockResolvedValue([
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
					reagents: [],
				},
				resources: {
					power: { allocated: 100, available: 200 },
					workforce: { allocated: 300, available: 400 },
				},
				upgrades: [],
				vulnerabilityWindowStart: null,
				vulnerabilityWindowEnd: null,
				workforceTransport: {
					configuration: { mode: 'unknown', systems: [] },
					state: { mode: 'unknown', systems: [] },
				},
				syncStatus: 'error',
				syncFailureReason: 'Sovereignty hub enrichment requires updated director scopes.',
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
				sovereigntyHubStructureId: 'hub-1',
				isCapitalSystem: false,
				vulnerabilityWindowStart: null,
				vulnerabilityWindowEnd: null,
				activityDefenseMultiplier: '1.2',
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
			}
		)

		expect(result.items[0]?.syncStatus).toBe('error')
		expect(result.items[0]?.syncFailureReason).toBe(
			'Sovereignty hub enrichment requires updated director scopes.'
		)
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
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-12T00:00:00Z').getTime())
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

		const result = await getStructureDetail(
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
			name: 'Jita',
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
		})
		expect(result?.sovereignty?.hub).toMatchObject({
			reagentCount: 2,
			resourcePowerAllocated: 100,
			resourceWorkforceAllocated: 300,
			upgradeCount: 1,
		})
	})
})
