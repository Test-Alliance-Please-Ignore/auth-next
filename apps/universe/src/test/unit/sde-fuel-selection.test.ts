import { describe, expect, it } from 'vitest'

import {
	FUEL_DOGMA_ATTRIBUTE_IDS,
	isFuelDogmaAttribute,
	isFuelModifier,
	selectStructureDogmaTypeIds,
	STRUCTURE_CATEGORY_ID,
	STRUCTURE_DOGMA_ATTRIBUTE_IDS,
	STRUCTURE_MODULE_CATEGORY_ID,
	STRUCTURE_SERVICE_MODULE_ATTRIBUTE_ID,
	STRUCTURE_SLOT_DOGMA_ATTRIBUTE_IDS,
} from '../../scripts/sde-fuel-selection'

describe('SDE fuel selection', () => {
	it('includes every tracked Upwell structure family and fuel service module', () => {
		const groupCategories = new Map([
			['citadel', STRUCTURE_CATEGORY_ID],
			['engineering', STRUCTURE_CATEGORY_ID],
			['refinery', STRUCTURE_CATEGORY_ID],
			['moon-drill', STRUCTURE_CATEGORY_ID],
			['navigation', STRUCTURE_CATEGORY_ID],
			['service', STRUCTURE_MODULE_CATEGORY_ID],
			['sovereignty-hub', 40],
			['skyhook', 46],
		])
		const structures = [
			['35825', 'engineering'],
			['35826', 'engineering'],
			['35827', 'engineering'],
			['35832', 'citadel'],
			['35833', 'citadel'],
			['35834', 'citadel'],
			['35835', 'refinery'],
			['35836', 'refinery'],
			['35840', 'navigation'],
			['35841', 'navigation'],
			['37534', 'navigation'],
			['40340', 'citadel'],
			['47512', 'citadel'],
			['47513', 'citadel'],
			['47514', 'citadel'],
			['47515', 'citadel'],
			['47516', 'citadel'],
			['81826', 'moon-drill'],
		] as const
		const serviceModules = [
			['35878', 'service'],
			['35881', 'service'],
			['35886', 'service'],
			['35891', 'service'],
			['35892', 'service'],
			['35894', 'service'],
			['35899', 'service'],
			['35912', 'service'],
			['35913', 'service'],
			['35914', 'service'],
			['45009', 'service'],
			['45537', 'service'],
			['45538', 'service'],
			['45539', 'service'],
			['82941', 'service'],
		] as const
		const excludedStructures = [
			['32458', 'sovereignty-hub'],
			['81080', 'skyhook'],
		] as const

		const result = selectStructureDogmaTypeIds(
			groupCategories,
			[...structures, ...serviceModules, ...excludedStructures].map(([typeId, groupId]) => ({
				typeId,
				groupId,
			}))
		)

		expect(result.structureTypeIds).toEqual(new Set(structures.map(([typeId]) => typeId)))
		expect(result.dogmaTypeIds).toEqual(
			new Set([...structures, ...serviceModules].map(([typeId]) => typeId))
		)
	})

	it('retains structure fuel and fitting attributes in the default import mode', () => {
		expect(STRUCTURE_SERVICE_MODULE_ATTRIBUTE_ID).toBe('2792')
		expect(FUEL_DOGMA_ATTRIBUTE_IDS).toEqual(['2108', '2109', '2110', '2339', '2792'])
		for (const attributeId of FUEL_DOGMA_ATTRIBUTE_IDS) {
			expect(isFuelDogmaAttribute(attributeId, false)).toBe(true)
		}
		expect(STRUCTURE_SLOT_DOGMA_ATTRIBUTE_IDS).toEqual(['12', '13', '14', '1137'])
		expect(STRUCTURE_DOGMA_ATTRIBUTE_IDS).toEqual([
			...FUEL_DOGMA_ATTRIBUTE_IDS,
			...STRUCTURE_SLOT_DOGMA_ATTRIBUTE_IDS,
		])
		expect(isFuelDogmaAttribute('9999', false)).toBe(false)
		expect(isFuelDogmaAttribute('9999', true)).toBe(true)
	})

	it('recognizes only structure fuel modifier relationships', () => {
		const validModifier = {
			modifiedAttributeID: 2109,
			modifyingAttributeID: 2339,
			operation: 6,
			func: 'LocationGroupModifier',
			domain: 'structureID',
		}

		expect(isFuelModifier(validModifier)).toBe(true)
		expect(isFuelModifier({ ...validModifier, modifiedAttributeID: 2108 })).toBe(false)
		expect(isFuelModifier({ ...validModifier, domain: 'itemID' })).toBe(false)
	})
})
