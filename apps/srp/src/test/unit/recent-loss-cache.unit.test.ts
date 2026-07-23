import { describe, expect, it } from 'vitest'

import type { CharacterLossData } from '@repo/eve-character-data'

import {
	doesRecentLossCacheCoverCutoff,
	mergeRecentLosses,
	isRecentLossRequestable,
	shouldInvalidateRecentLossCache,
	selectRecentKillmailsUntilKnown,
} from '../../lib/recent-loss-cache'

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
		totalValue: '0',
		solarSystemId: '30000142',
		victimCharacterId: '90000001',
		...overrides,
	}
}

describe('recent-loss cache helpers', () => {
	it('selects only new killmails until the first known id on a page', () => {
		const page = [
			{ killmail_id: '9', killmail_hash: 'h9' },
			{ killmail_id: '8', killmail_hash: 'h8' },
			{ killmail_id: '7', killmail_hash: 'h7' },
			{ killmail_id: '6', killmail_hash: 'h6' },
		]

		const result = selectRecentKillmailsUntilKnown(page, new Set(['7']))

		expect(result).toEqual({
			killmails: [
				{ killmail_id: '9', killmail_hash: 'h9' },
				{ killmail_id: '8', killmail_hash: 'h8' },
			],
			reachedKnownKillmail: true,
		})
	})

	it('keeps newest losses, dedupes by id, and trims losses older than the cutoff', () => {
		const merged = mergeRecentLosses(
			[
				buildLoss('10', '2026-06-02T03:00:00.000Z'),
				buildLoss('9', '2026-06-01T03:00:00.000Z'),
			],
			[
				buildLoss('9', '2026-06-01T04:00:00.000Z', { totalValue: '1' }),
				buildLoss('8', '2026-05-31T03:00:00.000Z'),
			],
			Date.parse('2026-05-31T12:00:00.000Z')
		)

		expect(merged).toEqual([
			buildLoss('10', '2026-06-02T03:00:00.000Z'),
			buildLoss('9', '2026-06-01T04:00:00.000Z', { totalValue: '1' }),
		])
	})

	it('only reports cache coverage when the stored losses reach the requested cutoff', () => {
		const cached = {
			losses: [
				buildLoss('10', '2026-06-02T03:00:00.000Z'),
				buildLoss('9', '2026-06-01T03:00:00.000Z'),
			],
			refreshedAtMs: Date.parse('2026-06-02T04:00:00.000Z'),
			complete: true,
			maxLossAgeDays: 30,
		}

		expect(
			doesRecentLossCacheCoverCutoff(cached, Date.parse('2026-06-01T04:00:00.000Z'), 30)
		).toBe(true)
		expect(
			doesRecentLossCacheCoverCutoff(cached, Date.parse('2026-05-01T00:00:00.000Z'), 30)
		).toBe(false)
		expect(
			doesRecentLossCacheCoverCutoff({ ...cached, complete: false }, Date.now(), 30)
		).toBe(false)
		expect(doesRecentLossCacheCoverCutoff(null, Date.now(), 30)).toBe(false)
		expect(
			doesRecentLossCacheCoverCutoff(
				{ ...cached, maxLossAgeDays: 14 },
				Date.parse('2026-06-01T00:00:00.000Z'),
				30
			)
		).toBe(false)
		expect(
			doesRecentLossCacheCoverCutoff(
				{
					losses: [],
					refreshedAtMs: Date.parse('2026-06-02T04:00:00.000Z'),
					complete: true,
					maxLossAgeDays: 30,
				},
				Date.parse('2026-05-01T00:00:00.000Z'),
				30
			)
		).toBe(true)
	})

	it('invalidates cached recent losses when the configured max age increases', () => {
		const cached = {
			losses: [buildLoss('10', '2026-06-02T03:00:00.000Z')],
			refreshedAtMs: Date.parse('2026-06-02T04:00:00.000Z'),
			complete: true,
			maxLossAgeDays: 30,
		}

		expect(shouldInvalidateRecentLossCache(cached, 365)).toBe(true)
		expect(shouldInvalidateRecentLossCache(cached, 30)).toBe(false)
		expect(shouldInvalidateRecentLossCache({ ...cached, maxLossAgeDays: 365 }, 365)).toBe(false)
		expect(shouldInvalidateRecentLossCache(null, 365)).toBe(false)
	})

	it('excludes rookie ships and empty capsules but keeps fitted pods requestable', () => {
		expect(isRecentLossRequestable(buildLoss('10', '2026-06-02T03:00:00.000Z'))).toBe(true)
		expect(
			isRecentLossRequestable({
				...buildLoss('11', '2026-06-02T03:00:00.000Z', {
					shipTypeId: '588',
				}),
			})
		).toBe(false)
		expect(
			isRecentLossRequestable({
				...buildLoss('12', '2026-06-02T03:00:00.000Z', {
					shipTypeId: '670',
					victimItems: [],
				}),
			})
		).toBe(false)
		expect(
			isRecentLossRequestable({
				...buildLoss('13', '2026-06-02T03:00:00.000Z', {
					shipTypeId: '33328',
					victimItems: [{ flag: 89, item_type_id: '1956' }],
				}),
			})
		).toBe(true)
	})
})
