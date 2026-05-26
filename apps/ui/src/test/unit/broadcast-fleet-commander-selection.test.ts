import { describe, expect, it } from 'vitest'

import { FLEET_COMMANDER_CUSTOM_VALUE } from '@/features/broadcasts/components/system-fleet-commander-field'
import { resolveFleetCommanderSelectionFromFields } from '@/features/broadcasts/utils'

describe('resolveFleetCommanderSelectionFromFields', () => {
	const characters = [
		{ characterId: '100', characterName: 'Main Char', hasValidToken: true },
		{ characterId: '200', characterName: 'Alt Char', hasValidToken: true },
		{ characterId: '300', characterName: 'Invalid Token Char', hasValidToken: false },
	]

	it('defaults to main character when no explicit value is set', () => {
		const result = resolveFleetCommanderSelectionFromFields({
			characters,
			mainCharacterId: '100',
			value: '',
			characterId: '',
		})

		expect(result).toEqual({
			selection: '100',
			value: 'Main Char',
			trackingCharacterId: '100',
			trackingCharacterName: 'Main Char',
		})
	})

	it('uses selected valid character id when provided', () => {
		const result = resolveFleetCommanderSelectionFromFields({
			characters,
			mainCharacterId: '100',
			value: '',
			characterId: '200',
		})

		expect(result).toEqual({
			selection: '200',
			value: 'Alt Char',
			trackingCharacterId: '200',
			trackingCharacterName: 'Alt Char',
		})
	})

	it('maps custom text to custom selection and clears tracking character', () => {
		const result = resolveFleetCommanderSelectionFromFields({
			characters,
			mainCharacterId: '100',
			value: 'Custom FC Name',
			characterId: '',
		})

		expect(result).toEqual({
			selection: FLEET_COMMANDER_CUSTOM_VALUE,
			value: 'Custom FC Name',
			trackingCharacterId: '',
			trackingCharacterName: '',
		})
	})

	it('falls back to custom selection when no valid tokened characters exist', () => {
		const result = resolveFleetCommanderSelectionFromFields({
			characters: [{ characterId: '300', characterName: 'No Token', hasValidToken: false }],
			mainCharacterId: '300',
			value: '',
			characterId: '',
		})

		expect(result).toEqual({
			selection: FLEET_COMMANDER_CUSTOM_VALUE,
			value: '',
			trackingCharacterId: '',
			trackingCharacterName: '',
		})
	})
})
