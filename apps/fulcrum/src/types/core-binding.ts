export interface CoreBinding {
	getCharacterOwnership(characterId: string): Promise<{ userId: string; isPrimary: boolean } | null>
	getUserDetails(userId: string): Promise<{ characters: Array<{ characterName: string }> } | null>
	getBlacklistedIpAssociationsForCharacter(characterId: string): Promise<{
		subjectUserId: string | null
		matches: Array<{
			userId: string
			mainCharacterId: string
			mainCharacterName: string | null
			matchingIpHashes: string[]
		}>
	}>
	getLegacyAssociationsForCharacter(characterId: string): Promise<{
		modernUserId: string | null
		items: Array<{
			id: string
			legacyAuthUserId: string
			status: string
			modernUserMainCharacterName: string | null
			conflicts: Record<string, unknown>
			candidates: {
				characters: Array<{
					characterId: string
					characterName: string
					source: 'legacy_primary' | 'esi_owner' | 'xml_account'
					corporationId: string | null
					corporationName: string | null
					allianceId: string | null
					allianceName: string | null
					isDeleted: boolean
					alreadyLinkedToModernUser: boolean
					linkedToOtherUserId: string | null
				}>
				notes: Array<{
					legacyNoteId: string
					note: string
					legacyCreatedByUserId: string | null
					legacyCreatedByCharacterName: string | null
					legacyDateCreated: Date | null
					alreadyImported: boolean
				}>
				ipAddressCount: number
			}
		}>
	}>
	getUserMainCharacterName(userId: string): Promise<string | null>
	getUserMainCharacter(userId: string): Promise<{ characterId: string; characterName: string } | null>
}
