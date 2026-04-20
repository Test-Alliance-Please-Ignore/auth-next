import { describe, expect, it } from 'vitest'

import { computeDoctrineConformityFindings } from '@/features/srp/components/ReviewRequestForm'

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

	it('flags split weapons when multiple ammo types are loaded in high slots', () => {
		const fitting = {
			fittingItems: [
				{ flagId: '27', typeId: '7001', typeName: 'Weapon A', quantity: '1' },
				{ flagId: '28', typeId: '7002', typeName: 'Weapon B', quantity: '1' },
			],
		} as any

		const ammoTypeIds = new Set(['8001', '8002'])
		const killmailItems = [
			{
				item_type_id: 7001,
				flag: 27,
				items: [{ item_type_id: 8001, quantity_destroyed: 1 }],
			},
			{
				item_type_id: 7002,
				flag: 28,
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
