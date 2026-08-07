import { describe, expect, it } from 'vitest'

import { calculateStructureFuelBurnRate } from '../../../services/structure-fuel-calculation'

const modules = new Map([
	[
		'standup market hub i',
		{
			typeId: '35892',
			typeName: 'Standup Market Hub I',
			serviceGroupId: '1321',
			fuelUnitsPerHour: 40,
		},
	],
	[
		'standup manufacturing plant i',
		{
			typeId: '35878',
			typeName: 'Standup Manufacturing Plant I',
			serviceGroupId: '1415',
			fuelUnitsPerHour: 12,
		},
	],
	[
		'standup cloning center i',
		{
			typeId: '35894',
			typeName: 'Standup Cloning Center I',
			serviceGroupId: '1321',
			fuelUnitsPerHour: 10,
		},
	],
])

const modulesWithEsiCasing = new Map([
	[
		'standup market hub i',
		{
			typeId: '35892',
			typeName: 'Standup Market Hub I',
			serviceGroupId: '1321',
			fuelUnitsPerHour: 40,
		},
	],
])

describe('calculateStructureFuelBurnRate', () => {
	it('applies the matching structure service-group discount', () => {
		expect(
			calculateStructureFuelBurnRate([{ name: 'Standup Market Hub I', state: 'online' }], modules, [
				{ serviceGroupId: '1321', modifierPercent: -25 },
			])
		).toBe(30)
	})

	it('matches ESI service casing against normalized SDE names', () => {
		expect(
			calculateStructureFuelBurnRate(
				[{ name: 'Standup Market Hub I', state: 'online' }],
				modulesWithEsiCasing,
				[]
			)
		).toBe(40)
	})

	it('applies a Marginis Fortizar citadel discount to market and clone services', () => {
		expect(
			calculateStructureFuelBurnRate(
				[
					{ name: 'Standup Market Hub I', state: 'online' },
					{ name: 'Standup Cloning Center I', state: 'online' },
				],
				modules,
				[{ serviceGroupId: '1321', modifierPercent: -50 }]
			)
		).toBe(25)
	})

	it('sums online services and ignores offline services', () => {
		expect(
			calculateStructureFuelBurnRate(
				[
					{ name: 'Standup Market Hub I', state: 'online' },
					{ name: 'Standup Manufacturing Plant I', state: 'online' },
					{ name: 'Standup Market Hub I', state: 'offline' },
				],
				modules,
				[]
			)
		).toBe(52)
	})

	it('fails closed when an online service is unknown', () => {
		expect(
			calculateStructureFuelBurnRate([{ name: 'Unknown Service', state: 'online' }], modules, [])
		).toBeNull()
	})

	it('distinguishes an unknown service list from an empty online service list', () => {
		expect(calculateStructureFuelBurnRate(null, modules, [])).toBeNull()
		expect(calculateStructureFuelBurnRate([], modules, [])).toBe(0)
	})
})
