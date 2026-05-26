import { FLEET_COMMANDER_CUSTOM_VALUE } from '@/features/broadcasts/components/system-fleet-commander-field'

export function parseBooleanField(value: string | undefined, defaultValue: boolean): boolean {
	if (typeof value !== 'string') return defaultValue
	const normalized = value.trim().toLowerCase()
	if (!normalized) return defaultValue
	if (['true', '1', 'yes', 'enabled', 'on'].includes(normalized)) return true
	if (['false', '0', 'no', 'disabled', 'off'].includes(normalized)) return false
	return defaultValue
}

export function resolveFleetCommanderSelectionFromFields(args: {
	characters: Array<{ characterId: string; characterName: string; hasValidToken: boolean }>
	mainCharacterId?: string | null
	value: string
	characterId: string
}): { selection: string; value: string; trackingCharacterId: string; trackingCharacterName: string } {
	const validCharacters = args.characters.filter((character) => character.hasValidToken)
	const selectedById = validCharacters.find((character) => character.characterId === args.characterId)
	if (selectedById) {
		return {
			selection: selectedById.characterId,
			value: selectedById.characterName,
			trackingCharacterId: selectedById.characterId,
			trackingCharacterName: selectedById.characterName,
		}
	}

	const selectedByName = validCharacters.find((character) => character.characterName === args.value)
	if (selectedByName) {
		return {
			selection: selectedByName.characterId,
			value: selectedByName.characterName,
			trackingCharacterId: selectedByName.characterId,
			trackingCharacterName: selectedByName.characterName,
		}
	}
	if ((args.value ?? '').trim().length > 0) {
		return {
			selection: FLEET_COMMANDER_CUSTOM_VALUE,
			value: args.value,
			trackingCharacterId: '',
			trackingCharacterName: '',
		}
	}

	const mainCharacter = validCharacters.find(
		(character) => character.characterId === (args.mainCharacterId ?? '')
	)
	if (mainCharacter) {
		return {
			selection: mainCharacter.characterId,
			value: mainCharacter.characterName,
			trackingCharacterId: mainCharacter.characterId,
			trackingCharacterName: mainCharacter.characterName,
		}
	}

	const firstCharacter = validCharacters[0]
	if (firstCharacter) {
		return {
			selection: firstCharacter.characterId,
			value: firstCharacter.characterName,
			trackingCharacterId: firstCharacter.characterId,
			trackingCharacterName: firstCharacter.characterName,
		}
	}

	return {
		selection: FLEET_COMMANDER_CUSTOM_VALUE,
		value: args.value,
		trackingCharacterId: '',
		trackingCharacterName: '',
	}
}

export function autoResizeTextarea(element: HTMLTextAreaElement): void {
	element.style.height = '0px'
	element.style.height = `${element.scrollHeight}px`
}
