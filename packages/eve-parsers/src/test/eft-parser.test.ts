import { describe, expect, it, vi } from 'vitest'

import { EftParser } from '../eft-parser'

import type { InvGroup, InvType } from '@repo/universe'

const validFitting = `[Svipul, Cena Svipul]

Counterbalanced Compact Gyrostabilizer
Counterbalanced Compact Gyrostabilizer
Micro Auxiliary Power Core II
IFFA Compact Damage Control

5MN Quad LiF Restrained Microwarpdrive
Medium F-S9 Regolith Compact Shield Extender
Compact Multispectrum Shield Hardener
Initiated Compact Warp Scrambler

280mm Howitzer Artillery II
280mm Howitzer Artillery II
280mm Howitzer Artillery II
280mm Howitzer Artillery II
Defender Launcher I
[Empty High slot]

Small Core Defense Field Extender II
Small Core Defense Field Extender II
Small Core Defense Field Extender II


Tremor S x1000
Defender Missile I x20
Nanite Repair Paste x50
Republic Fleet Depleted Uranium S x1000
Republic Fleet EMP S x1000
Republic Fleet Fusion S x1000
Republic Fleet Phased Plasma S x1000
Republic Fleet Titanium Sabot S x1000`

// Mock Universe stub with the methods EftParser calls
const mockUniverseStub = {
	resolveTypeIdsByNames: vi.fn((typeNames: string[]) => {
		const mockTypes: Record<string, InvType> = {}
		for (const name of typeNames) {
			mockTypes[name] = {
				typeId: `${name}-id`,
				groupId: `${name}-group-id`,
				typeName: name,
				description: `Mock description for ${name}`,
				mass: '1000',
				volume: '100',
				capacity: '0',
				portionSize: 1,
				raceId: null,
				basePrice: '10000',
				published: true,
				marketGroupId: null,
				iconId: null,
				soundId: null,
				graphicId: '1',
			}
		}
		return Promise.resolve(mockTypes)
	}),
	resolveInvGroups: vi.fn((groupIds: string[]) => {
		const mockGroups: Record<string, InvGroup> = {}
		for (const groupId of groupIds) {
			mockGroups[groupId] = {
				groupId: groupId,
				categoryId: `${groupId}-category-id`,
				groupName: `${groupId}-name`,
				iconId: null,
				useBasePrice: false,
				anchored: false,
				anchorable: false,
				fittableNonSingleton: false,
				published: true,
			}
		}
		return Promise.resolve(mockGroups)
	}),
}

/**
 * Fake DurableObjectNamespace that satisfies getStub() in the Workers test pool.
 * getStub calls namespace.idFromName(id) then namespace.get(durableObjectId),
 * so we provide both methods and return our mock stub from get().
 */
const fakeUniverseNs = {
	idFromName: () => ({}),
	get: () => mockUniverseStub,
} as unknown as DurableObjectNamespace

describe('EftParser', () => {
	it('should parse a valid EFT fitting', async () => {
		const parser = new EftParser(fakeUniverseNs)

		const result = await parser.parse(validFitting)

		// Verify header information
		expect(result.shipName).toBe('Svipul')
		expect(result.fittingName).toBe('Cena Svipul')
		expect(result.shipTypeId).toBe('Svipul-id')

		// Verify items were parsed
		expect(result.items).toBeInstanceOf(Array)
		expect(result.items.length).toBeGreaterThan(0)

		// Verify specific items exist with correct quantities
		const tremor = result.items.find((item) => item.typeName === 'Tremor S')
		expect(tremor).toBeDefined()
		expect(tremor?.quantity).toBe('1000')

		const defenderMissile = result.items.find((item) => item.typeName === 'Defender Missile I')
		expect(defenderMissile).toBeDefined()
		expect(defenderMissile?.quantity).toBe('20')

		const gyrostabilizer = result.items.find(
			(item) => item.typeName === 'Counterbalanced Compact Gyrostabilizer'
		)
		expect(gyrostabilizer).toBeDefined()
		expect(gyrostabilizer?.quantity).toBe('1')

		// Verify that type IDs, group IDs, and category IDs were resolved
		for (const item of result.items) {
			expect(item.typeId).toMatch(/-id$/)
			expect(item.typeName).toBeDefined()
			expect(item.groupId).toMatch(/-group-id$/)
			expect(item.groupName).toMatch(/-name$/)
			expect(item.categoryId).toMatch(/-category-id$/)
		}
	})

	it('should throw error for invalid EFT format', async () => {
		const parser = new EftParser(fakeUniverseNs)

		const invalidFitting = 'This is not a valid EFT format'

		await expect(parser.parse(invalidFitting)).rejects.toThrow('Invalid EFT string format')
	})

	it('should handle items without quantity', async () => {
		const parser = new EftParser(fakeUniverseNs)

		const singleItemFitting = `[Svipul, Single Item Test]

Counterbalanced Compact Gyrostabilizer`

		const result = await parser.parse(singleItemFitting)

		expect(result.items).toHaveLength(1)
		expect(result.items[0].typeName).toBe('Counterbalanced Compact Gyrostabilizer')
		expect(result.items[0].quantity).toBe('1')
	})

	it('should skip empty slots', async () => {
		const parser = new EftParser(fakeUniverseNs)

		const emptySlotFitting = `[Svipul, Empty Slot Test]

Counterbalanced Compact Gyrostabilizer
[Empty Low slot]
[Empty Low slot]`

		const result = await parser.parse(emptySlotFitting)

		// Should only have 1 item (the gyrostabilizer), empty slots should be skipped
		expect(result.items).toHaveLength(1)
		expect(result.items[0].typeName).toBe('Counterbalanced Compact Gyrostabilizer')
	})
})
