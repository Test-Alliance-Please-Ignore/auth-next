import { describe, expect, it, vi } from 'vitest'

import type { CharacterLossData } from '@repo/eve-character-data'

vi.mock('cloudflare:workers', () => ({
	DurableObject: class {},
}))

import { SrpDO } from '../../durable-object'

function buildLoss(
	killmailId: string,
	killmailTime: string,
	overrides: Partial<CharacterLossData> = {}
): CharacterLossData {
	return {
		killmailId,
		killmailHash: `hash-${killmailId}`,
		killmailTime: new Date(killmailTime),
		shipTypeId: '123',
		totalValue: '1000000',
		solarSystemId: '30000142',
		victimCharacterId: '90000001',
		...overrides,
	}
}

describe('refreshRecentLossesForCharacter', () => {
	it('seeds pagination from the most recently stored loss and persists refreshed losses to character data', async () => {
		const srp = Object.create(SrpDO.prototype) as Record<string, any>
		const storedLoss = {
			killmailId: '200',
			killmailHash: 'stored-hash',
			killmailTime: new Date('2026-07-10T00:00:00.000Z'),
		}
		const cachedLoss = buildLoss('199', '2026-07-09T00:00:00.000Z')
		const refreshedLoss = buildLoss('198', '2026-07-08T00:00:00.000Z')
		const knownKillmailIds = new Set<string>()

		srp.readRecentLossCache = vi.fn().mockResolvedValue({
			losses: [cachedLoss],
			refreshedAtMs: Date.now(),
			complete: true,
			maxLossAgeDays: 30,
		})
		srp.readMostRecentLoss = vi.fn().mockResolvedValue(storedLoss)
		srp.fetchRecentLossesFromEsi = vi.fn().mockImplementation(async (_characterId: string, ids: Set<string>) => {
			for (const id of ids) {
				knownKillmailIds.add(id)
			}
			return [{ loss: refreshedLoss, killmailData: { killmail_id: refreshedLoss.killmailId } }]
		})
		srp.persistRecentLossesToCharacterData = vi.fn().mockResolvedValue(undefined)
		srp.writeRecentLossCache = vi.fn().mockResolvedValue(undefined)
		srp.getConfig = vi.fn().mockResolvedValue({ maxLossAgeDays: 30 })

		const result = await srp.refreshRecentLossesForCharacter(
			'user-1',
			'character-1',
			'Character One',
			30
		)

		expect(result).toEqual({
			characterId: 'character-1',
			characterName: 'Character One',
			success: true,
		})
		expect(srp.readMostRecentLoss).toHaveBeenCalledWith('character-1')
		expect(srp.fetchRecentLossesFromEsi).toHaveBeenCalledTimes(1)
		expect(knownKillmailIds).toEqual(new Set(['200']))
		expect(srp.persistRecentLossesToCharacterData).toHaveBeenCalledWith(
			'character-1',
			[{ loss: refreshedLoss, killmailData: { killmail_id: refreshedLoss.killmailId } }],
			expect.any(Number)
		)
		expect(srp.writeRecentLossCache).toHaveBeenCalledWith('character-1', [refreshedLoss], 30)
	})

	it('filters rookie ships out before persisting refreshed losses', async () => {
		const srp = Object.create(SrpDO.prototype) as Record<string, any>
		const rookieLoss = buildLoss('301', '2026-07-07T00:00:00.000Z', {
			shipTypeId: '588',
		})
		const eligibleLoss = buildLoss('302', '2026-07-06T00:00:00.000Z')

		srp.readRecentLossCache = vi.fn().mockResolvedValue({
			losses: [],
			refreshedAtMs: Date.now(),
			complete: false,
			maxLossAgeDays: 30,
		})
		srp.readMostRecentLoss = vi.fn().mockResolvedValue(null)
		srp.fetchRecentLossesFromEsi = vi.fn().mockResolvedValue([
			{ loss: rookieLoss, killmailData: { killmail_id: rookieLoss.killmailId } },
			{ loss: eligibleLoss, killmailData: { killmail_id: eligibleLoss.killmailId } },
		])
		srp.persistRecentLossesToCharacterData = vi.fn().mockResolvedValue(undefined)
		srp.writeRecentLossCache = vi.fn().mockResolvedValue(undefined)
		srp.getConfig = vi.fn().mockResolvedValue({ maxLossAgeDays: 30 })

		const result = await srp.refreshRecentLossesForCharacter(
			'user-1',
			'character-1',
			'Character One',
			30
		)

		expect(result.success).toBe(true)
		expect(srp.persistRecentLossesToCharacterData).toHaveBeenCalledWith(
			'character-1',
			[{ loss: eligibleLoss, killmailData: { killmail_id: eligibleLoss.killmailId } }],
			expect.any(Number)
		)
		expect(srp.writeRecentLossCache).toHaveBeenCalledWith('character-1', [eligibleLoss], 30)
	})

	it('treats an empty refresh as a successful complete cache write', async () => {
		const srp = Object.create(SrpDO.prototype) as Record<string, any>

		srp.readRecentLossCache = vi.fn().mockResolvedValue(null)
		srp.readMostRecentLoss = vi.fn().mockResolvedValue(null)
		srp.fetchRecentLossesFromEsi = vi.fn().mockResolvedValue([])
		srp.persistRecentLossesToCharacterData = vi.fn().mockResolvedValue(undefined)
		srp.writeRecentLossCache = vi.fn().mockResolvedValue(undefined)
		srp.getConfig = vi.fn().mockResolvedValue({ maxLossAgeDays: 30 })

		const result = await srp.refreshRecentLossesForCharacter(
			'user-1',
			'character-1',
			'Character One',
			30
		)

		expect(result).toEqual({
			characterId: 'character-1',
			characterName: 'Character One',
			success: true,
		})
		expect(srp.persistRecentLossesToCharacterData).toHaveBeenCalledWith('character-1', [], expect.any(Number))
		expect(srp.writeRecentLossCache).toHaveBeenCalledWith('character-1', [], 30)
	})
})
