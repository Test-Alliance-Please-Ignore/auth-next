import type { EveAllianceId, EveCharacterId, EveCorporationId } from '@repo/eve-types'

export interface Director {
	characterId: EveCharacterId
	characterName: string
	corporationId: EveCorporationId
	corporationName: string
	allianceId: EveAllianceId
	allianceName: string
}
