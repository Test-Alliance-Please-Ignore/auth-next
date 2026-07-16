import type { CharacterLossData } from '@repo/eve-character-data'

export function buildKillmailDetailFromCachedLoss(
	characterId: string,
	killmailId: string,
	killmailHash: string,
	loss: CharacterLossData
): any {
	return {
		attackers: [],
		killmail_id: killmailId,
		killmail_hash: killmailHash,
		killmail_time: loss.killmailTime.toISOString(),
		solar_system_id: Number(loss.solarSystemId),
		victim: {
			character_id: Number(characterId),
			ship_type_id: Number(loss.shipTypeId),
			damage_taken: 0,
			items: loss.victimItems as any,
		},
	}
}
