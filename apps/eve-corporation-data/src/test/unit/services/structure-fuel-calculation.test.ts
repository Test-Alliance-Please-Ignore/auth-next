import { describe, expect, it } from 'vitest'

import { resolveUniverseFuelModuleRule } from '@repo/universe'

import {
	calculateStructureFuelBurnRate,
	calculateStructureFuelBurnRateDetails,
} from '../../../services/structure-fuel-calculation'

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

const aliasedModules = new Map(
	[
		['standup biochemical reactor i', '45539'],
		['standup capital shipyard i', '35881'],
		['standup cloning center i', '35894'],
		['standup composite reactor i', '45537'],
		['standup conduit generator i', '35913'],
		['standup cynosural field generator i', '35912'],
		['standup cynosural system jammer i', '35914'],
		['standup hybrid reactor i', '45538'],
		['standup invention lab i', '35886'],
		['standup metenox moon drill', '82941'],
		['standup manufacturing plant i', '35878'],
		['standup moon drill i', '45009'],
		['standup reprocessing facility i', '35899'],
		['standup research lab i', '35891'],
	].map(([typeName, typeId]) => [
		typeName,
		{
			typeId,
			typeName,
			serviceGroupId: '1321',
			fuelUnitsPerHour: 10,
		},
	])
)

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

	it('counts one research module once when ESI reports multiple capabilities', () => {
		expect(
			calculateStructureFuelBurnRate(
				[
					{ name: 'Material Efficiency Research', state: 'online' },
					{ name: 'Blueprint Copying', state: 'online' },
					{ name: 'Time Efficiency Research', state: 'online' },
				],
				aliasedModules,
				[]
			)
		).toBe(10)
	})

	it('fails closed when an online service is unknown', () => {
		expect(
			calculateStructureFuelBurnRate([{ name: 'Unknown Service', state: 'online' }], modules, [])
		).toBeNull()
	})

	it('reports the identifiable rate while retaining unresolved online services', () => {
		expect(
			calculateStructureFuelBurnRateDetails(
				[
					{ name: 'Standup Market Hub I', state: 'online' },
					{ name: 'Unknown Service', state: 'online' },
				],
				modules,
				[]
			)
		).toEqual({
			fuelBurnRate: 40,
			unresolvedServiceNames: ['Unknown Service'],
			unresolvedModuleTypeIds: [],
		})
	})

	it('distinguishes an unknown service list from an empty online service list', () => {
		expect(calculateStructureFuelBurnRate(null, modules, [])).toBeNull()
		expect(calculateStructureFuelBurnRate([], modules, [])).toBe(0)
	})

	it('resolves ESI service labels to their SDE service modules', () => {
		const expected = [
			['Composite Reactions', '45537'],
			['Reprocessing', '35899'],
			['Material Efficiency Research', '35891'],
			['Blueprint Copying', '35891'],
			['Time Efficiency Research', '35891'],
			['Automatic Moon Drilling', '82941'],
			['Manufacturing (Standard)', '35878'],
			['Biochemical Reactions', '45539'],
			['Invention', '35886'],
			['Clone Bay', '35894'],
			['Manufacturing (Capitals)', '35881'],
			['Moon Drilling', '45009'],
			['Hybrid Reactions', '45538'],
			['Jump Access', '35913'],
			['Cynosural Field Generation', '35912'],
			['Cynosural System Jammer', '35914'],
		] as const

		for (const [serviceName, typeId] of expected) {
			expect(resolveUniverseFuelModuleRule(serviceName, aliasedModules)?.typeId).toBe(typeId)
		}
	})

	it('uses the SDE-resolved built-in module when ESI only provides a service label', () => {
		const builtInModule = {
			typeId: '35913',
			typeName: 'Standup Conduit Generator I',
			serviceGroupId: '1321',
			fuelUnitsPerHour: 30,
		}

		expect(
			calculateStructureFuelBurnRate(
				[{ name: 'Jump Access', state: 'online' }],
				new Map(),
				[],
				builtInModule
			)
		).toBe(30)
	})

	it('retains a built-in module when fitted asset rows contain other modules', () => {
		const builtInModule = {
			typeId: '35913',
			typeName: 'Standup Conduit Generator I',
			serviceGroupId: '1321',
			fuelUnitsPerHour: 30,
		}

		expect(
			calculateStructureFuelBurnRate(
				[{ name: 'Jump Access', state: 'online' }],
				new Map(),
				[],
				builtInModule,
				['35892'],
				new Map([
					[
						'35892',
						{
							typeId: '35892',
							typeName: 'Standup Market Hub I',
							serviceGroupId: '1321',
							fuelUnitsPerHour: 40,
						},
					],
				])
			)
		).toBe(70)
	})

	it('uses concrete installed asset modules even when an ESI label is not aliased', () => {
		const installedModule = {
			typeId: '35892',
			typeName: 'Standup Market Hub I',
			serviceGroupId: '1321',
			fuelUnitsPerHour: 55,
		}

		expect(
			calculateStructureFuelBurnRate(
				[{ name: 'Unmapped ESI Service', state: 'online' }],
				modules,
				[],
				null,
				[installedModule.typeId],
				new Map([[installedModule.typeId, installedModule]])
			)
		).toBe(55)
	})

	it('uses all resolved concrete asset modules without requiring an alias match', () => {
		expect(
			calculateStructureFuelBurnRate(
				[{ name: 'Market', state: 'online' }],
				modules,
				[],
				null,
				['45999'],
				new Map([
					[
						'45999',
						{
							typeId: '45999',
							typeName: 'Unrelated Service Module',
							serviceGroupId: '1321',
							fuelUnitsPerHour: 55,
						},
					],
				])
			)
		).toBe(55)
	})

	it('fails closed when an installed asset type is missing from the SDE cache', () => {
		expect(
			calculateStructureFuelBurnRate(
				[{ name: 'Market', state: 'online' }],
				modules,
				[],
				null,
				['unknown-service-module'],
				new Map()
			)
		).toBeNull()
	})
})
