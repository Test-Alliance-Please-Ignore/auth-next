import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { listVisibleStructures } from '../../../services/structures.service'

type FakeDb = Parameters<typeof listVisibleStructures>[0]

function makeDb(
	options: {
		hidden?: boolean
		structures?: Array<{
			structureId: string
			corporationId: string
			name: string
			typeId: string
			typeName: string
			systemId: string
			systemName: string
			regionId: string
			regionName: string
			profileId: string
			state: string
			nextReinforceApply: null
			stateTimerEnd: null
			unanchorsAt: null
			fuelExpires: null
			fuelAmount: number
			lowPower: boolean
			syncStatus: 'ok'
			syncFailureReason: null
			lastSyncedAt: Date
			updatedAt: Date
		}>
	} = {}
): FakeDb {
	const hidden = options.hidden ?? false
	const structures =
		options.structures ??
		[
			{
				structureId: 'structure-1',
				corporationId: 'corp-1',
				name: 'Structure One',
				typeId: '35832',
				typeName: 'Astrahus',
				systemId: '30000142',
				systemName: 'Jita',
				regionId: '10000002',
				regionName: 'The Forge',
				profileId: 'profile-1',
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
			},
		]

	const query = {
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
			findMany: vi.fn().mockResolvedValue(structures),
		},
		structureConfigs: {
			findMany: vi.fn().mockResolvedValue(
				structures.map((structure) => ({
					structureId: structure.structureId,
					hidden,
					lowPowerAllowed: true,
					assignedGroupId: null,
					createdAt: new Date('2026-01-01T00:00:00Z'),
					updatedAt: new Date('2026-01-01T00:00:00Z'),
				}))
			),
		},
		managedCorporations: {
			findMany: vi.fn().mockResolvedValue(
				[
					...new Set(structures.map((structure) => structure.corporationId)),
				].map((corporationId) => ({
					corporationId,
					name: corporationId === 'corp-1' ? 'Test Corp' : 'Second Corp',
				}))
			),
		},
		structureFuelLog: {
			findMany: vi.fn().mockResolvedValue([]),
		},
	}

	return { query } as unknown as FakeDb
}

describe('structure permission gating', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns visible structures for all-scope viewer permissions resolved from group membership', async () => {
		const db = makeDb()

		const result = await listVisibleStructures(db as never, {
			id: 'user-1',
			is_admin: false,
			roles: ['urn:structures:all:viewer'],
		})

		expect(db.query.corporationStructures.findMany).toHaveBeenCalledTimes(1)
		expect(result.items).toHaveLength(1)
		expect(result.items[0]?.structureId).toBe('structure-1')
		expect(result.summary.total).toBe(1)
	})

	it('returns corporation-scoped structures when the user only has a corp-scoped viewer permission', async () => {
		const db = makeDb()

		const result = await listVisibleStructures(db as never, {
			id: 'user-2',
			is_admin: false,
			roles: ['urn:structures:corp-1:viewer'],
		})

		expect(db.query.corporationStructures.findMany).toHaveBeenCalledTimes(1)
		expect(result.items).toHaveLength(1)
		expect(result.items[0]?.corporationId).toBe('corp-1')
	})

	it('unions multiple corp-scoped permissions across corporations', async () => {
		const db = makeDb({
			structures: [
				{
					structureId: 'structure-1',
					corporationId: 'corp-1',
					name: 'Structure One',
					typeId: '35832',
					typeName: 'Astrahus',
					systemId: '30000142',
					systemName: 'Jita',
					regionId: '10000002',
					regionName: 'The Forge',
					profileId: 'profile-1',
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
				},
				{
					structureId: 'structure-2',
					corporationId: 'corp-2',
					name: 'Structure Two',
					typeId: '35832',
					typeName: 'Astrahus',
					systemId: '30000143',
					systemName: 'Perimeter',
					regionId: '10000002',
					regionName: 'The Forge',
					profileId: 'profile-2',
					state: 'online',
					nextReinforceApply: null,
					stateTimerEnd: null,
					unanchorsAt: null,
					fuelExpires: null,
					fuelAmount: 3000,
					lowPower: false,
					syncStatus: 'ok',
					syncFailureReason: null,
					lastSyncedAt: new Date('2026-01-01T00:00:00Z'),
					updatedAt: new Date('2026-01-01T00:00:00Z'),
				},
			],
		})

		const result = await listVisibleStructures(db as never, {
			id: 'user-2a',
			is_admin: false,
			roles: ['urn:structures:corp-1:viewer', 'urn:structures:corp-2:sensitive'],
		})

		expect(db.query.corporationStructures.findMany).toHaveBeenCalledTimes(1)
		expect(result.items).toHaveLength(2)
		expect(result.items.map((item) => item.corporationId).sort()).toEqual(['corp-1', 'corp-2'])
	})

	it('lets all-scope access supersede corp-scoped permissions for visibility', async () => {
		const db = makeDb({
			structures: [
				{
					structureId: 'structure-1',
					corporationId: 'corp-1',
					name: 'Structure One',
					typeId: '35832',
					typeName: 'Astrahus',
					systemId: '30000142',
					systemName: 'Jita',
					regionId: '10000002',
					regionName: 'The Forge',
					profileId: 'profile-1',
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
				},
				{
					structureId: 'structure-2',
					corporationId: 'corp-2',
					name: 'Structure Two',
					typeId: '35832',
					typeName: 'Astrahus',
					systemId: '30000143',
					systemName: 'Perimeter',
					regionId: '10000002',
					regionName: 'The Forge',
					profileId: 'profile-2',
					state: 'online',
					nextReinforceApply: null,
					stateTimerEnd: null,
					unanchorsAt: null,
					fuelExpires: null,
					fuelAmount: 3000,
					lowPower: false,
					syncStatus: 'ok',
					syncFailureReason: null,
					lastSyncedAt: new Date('2026-01-01T00:00:00Z'),
					updatedAt: new Date('2026-01-01T00:00:00Z'),
				},
			],
		})

		const result = await listVisibleStructures(db as never, {
			id: 'user-2b',
			is_admin: false,
			roles: ['urn:structures:corp-1:viewer', 'urn:structures:all:viewer'],
		})

		expect(db.query.corporationStructures.findMany).toHaveBeenCalledTimes(1)
		expect(result.items).toHaveLength(2)
		expect(result.items.map((item) => item.corporationId).sort()).toEqual(['corp-1', 'corp-2'])
	})

	it('does not query structures when the user has no structure permissions', async () => {
		const db = makeDb()

		const result = await listVisibleStructures(db as never, {
			id: 'user-3',
			is_admin: false,
			roles: ['urn:srp:reviewer'],
		})

		expect(db.query.corporationStructures.findMany).not.toHaveBeenCalled()
		expect(result.items).toHaveLength(0)
		expect(result.summary.total).toBe(0)
	})

	it('filters hidden structures unless the user has manager-level access', async () => {
		const db = makeDb({ hidden: true })

		const viewerResult = await listVisibleStructures(db as never, {
			id: 'user-4',
			is_admin: false,
			roles: ['urn:structures:all:viewer'],
		})

		expect(viewerResult.items).toHaveLength(0)

		const sensitiveResult = await listVisibleStructures(db as never, {
			id: 'user-5',
			is_admin: false,
			roles: ['urn:structures:all:sensitive'],
		})

		expect(sensitiveResult.items).toHaveLength(1)
		expect(sensitiveResult.items[0]?.structureId).toBe('structure-1')
		expect(sensitiveResult.items[0]?.canEdit).toBe(false)

		const corpSensitiveResult = await listVisibleStructures(db as never, {
			id: 'user-5b',
			is_admin: false,
			roles: ['urn:structures:corp-1:sensitive'],
		})

		expect(corpSensitiveResult.items).toHaveLength(1)
		expect(corpSensitiveResult.items[0]?.structureId).toBe('structure-1')
		expect(corpSensitiveResult.items[0]?.canEdit).toBe(false)

		const corpManagerResult = await listVisibleStructures(db as never, {
			id: 'user-5c',
			is_admin: false,
			roles: ['urn:structures:corp-1:manager'],
		})

		expect(corpManagerResult.items).toHaveLength(1)
		expect(corpManagerResult.items[0]?.structureId).toBe('structure-1')
		expect(corpManagerResult.items[0]?.canEdit).toBe(true)

		const managerResult = await listVisibleStructures(db as never, {
			id: 'user-6',
			is_admin: false,
			roles: ['urn:structures:all:manager'],
		})

		expect(managerResult.items).toHaveLength(1)
		expect(managerResult.items[0]?.structureId).toBe('structure-1')
		expect(managerResult.items[0]?.canEdit).toBe(true)
	})
})
