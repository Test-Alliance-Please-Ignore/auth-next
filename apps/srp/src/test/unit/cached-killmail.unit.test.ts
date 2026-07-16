import { describe, expect, it } from 'vitest'

import { buildKillmailDetailFromCachedLoss } from '../../lib/cached-killmail'

import type { CharacterLossData } from '@repo/eve-character-data'

function buildLoss(overrides: Partial<CharacterLossData> = {}): CharacterLossData {
	return {
		killmailId: '100001',
		killmailHash: 'hash-123',
		killmailTime: new Date('2026-07-14T04:30:00.000Z'),
		shipTypeId: '587',
		totalValue: '1000000',
		solarSystemId: '30000142',
		victimCharacterId: '7001',
		victimItems: [{ flag: 87, item_type_id: '12345', quantity_destroyed: 1 }],
		...overrides,
	}
}

describe('buildKillmailDetailFromCachedLoss', () => {
	it('converts a cached recent-loss entry into a killmail detail payload', () => {
		const result = buildKillmailDetailFromCachedLoss(
			'7001',
			'100001',
			'hash-123',
			buildLoss()
		)

		expect(result).toEqual({
			attackers: [],
			killmail_id: '100001',
			killmail_hash: 'hash-123',
			killmail_time: '2026-07-14T04:30:00.000Z',
			solar_system_id: 30000142,
			victim: {
				character_id: 7001,
				ship_type_id: 587,
				items: [{ flag: 87, item_type_id: '12345', quantity_destroyed: 1 }],
				damage_taken: 0,
			},
		})
	})
})
