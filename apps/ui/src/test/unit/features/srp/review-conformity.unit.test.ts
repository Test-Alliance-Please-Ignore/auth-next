import { describe, expect, it } from 'vitest'

import {
	addEmptySlotDeviationHighlights,
	computeDoctrineConformityFindings,
} from '@/features/srp/components/ReviewRequestForm'

import type { SRPFittingItem } from '@/features/srp/utils/fitting'

describe('computeDoctrineConformityFindings', () => {
	it('coalesces duplicate module deviation counts in an order-agnostic diff', () => {
		const fitting = {
			fittingItems: [
				{
					flagId: '19',
					typeId: '3001',
					typeName: 'Multispectrum Shield Hardener II',
					quantity: '1',
				},
				{
					flagId: '20',
					typeId: '3001',
					typeName: 'Multispectrum Shield Hardener II',
					quantity: '1',
				},
			],
		} as any

		const killmailItems = [
			{ item_type_id: 4001, flag: 26, quantity_destroyed: 1 },
			{ item_type_id: 4001, flag: 19, quantity_destroyed: 1 },
		] as any

		const findings = computeDoctrineConformityFindings(
			fitting,
			killmailItems,
			killmailItems,
			new Set<string>(),
			new Set<string>(),
			{
				'3001': 'Multispectrum Shield Hardener II',
				'4001': 'Multispectrum Shield Hardener I',
			}
		)

		const mismatch = findings.find(
			(f) =>
				f.severity === 'warning' &&
				f.expectedModule === 'Multispectrum Shield Hardener II' &&
				f.lossModule === 'Multispectrum Shield Hardener I'
		)

		expect(mismatch).toBeDefined()
		expect(mismatch?.quantity).toBe(2)
		expect(mismatch?.message).toContain('×2')
		expect(findings.some((f) => f.severity === 'destructive' && f.expectedModule)).toBe(false)
	})

	it('does not flag split weapons when ammo types align to distinct weapon systems', () => {
		const fitting = {
			fittingItems: [
				{ flagId: '27', typeId: '7001', typeName: '280mm Howitzer Artillery II', quantity: '5' },
				{ flagId: '32', typeId: '7100', typeName: 'Defender Missile Launcher I', quantity: '1' },
			],
		} as any

		const ammoTypeIds = new Set(['8001', '9001'])
		const killmailItems = [
			{
				item_type_id: 7001,
				flag: 27,
				quantity_destroyed: 1,
				items: [{ item_type_id: 8001, quantity_destroyed: 5 }],
			},
			{
				item_type_id: 7100,
				flag: 28,
				quantity_destroyed: 1,
				items: [{ item_type_id: 9001, quantity_destroyed: 1 }],
			},
		] as any

		const findings = computeDoctrineConformityFindings(
			fitting,
			killmailItems,
			killmailItems,
			new Set<string>(),
			ammoTypeIds,
			{
				'8001': 'Tremor S',
				'9001': 'Defender Missile',
			}
		)

		expect(findings.some((f) => f.message.includes('Split weapons variant detected'))).toBe(false)
	})

	it('flags split weapons when the same weapon system has multiple ammo types', () => {
		const fitting = {
			fittingItems: [
				{ flagId: '27', typeId: '7001', typeName: 'Heavy Missile Launcher II', quantity: '2' },
			],
		} as any

		const ammoTypeIds = new Set(['8001', '8002'])
		const killmailItems = [
			{
				item_type_id: 7001,
				flag: 27,
				quantity_destroyed: 1,
				items: [{ item_type_id: 8001, quantity_destroyed: 1 }],
			},
			{
				item_type_id: 7001,
				flag: 28,
				quantity_destroyed: 1,
				items: [{ item_type_id: 8002, quantity_destroyed: 1 }],
			},
		] as any

		const findings = computeDoctrineConformityFindings(
			fitting,
			killmailItems,
			killmailItems,
			new Set<string>(),
			ammoTypeIds,
			{
				'7001': 'Heavy Missile Launcher II',
				'8001': 'Mjolnir Rage Heavy Missile',
				'8002': 'Scourge Rage Heavy Missile',
			}
		)

		expect(
			findings.some(
				(f) =>
					f.severity === 'warning' &&
					f.slot === 'high' &&
					f.message.includes('Split weapons variant detected')
			)
		).toBe(true)
	})
})

describe('addEmptySlotDeviationHighlights', () => {
	it('marks all empty slots as destructive when no doctrine fit is selected', () => {
		const fittingItems: SRPFittingItem[] = [
			{
				typeId: '7001',
				typeName: '200mm AutoCannon II',
				quantity: 1,
				flag: 27,
				slotType: 'high',
				slotIndex: 0,
				unitPrice: '1',
				lineTotal: '1',
			},
		]

		const highlights = addEmptySlotDeviationHighlights(
			{},
			fittingItems,
			{ high: 4, mid: 2, low: 0, rig: 0, sub: 0 },
			null
		)

		expect(highlights['high:1']).toBe('destructive')
		expect(highlights['high:2']).toBe('destructive')
		expect(highlights['high:3']).toBe('destructive')
		expect(highlights['mid:0']).toBe('destructive')
		expect(highlights['mid:1']).toBe('destructive')
	})

	it('marks doctrine-intended empty slots as secondary and others as destructive', () => {
		const fittingItems: SRPFittingItem[] = [
			{
				typeId: '7001',
				typeName: '200mm AutoCannon II',
				quantity: 1,
				flag: 27,
				slotType: 'high',
				slotIndex: 0,
				unitPrice: '1',
				lineTotal: '1',
			},
			{
				typeId: '7002',
				typeName: '200mm AutoCannon II',
				quantity: 1,
				flag: 28,
				slotType: 'high',
				slotIndex: 1,
				unitPrice: '1',
				lineTotal: '1',
			},
		]

		const highlights = addEmptySlotDeviationHighlights(
			{},
			fittingItems,
			{ high: 4, mid: 0, low: 0, rig: 0, sub: 0 },
			{ high: 3 }
		)

		expect(highlights['high:2']).toBe('destructive')
		expect(highlights['high:3']).toBe('secondary')
	})
})
