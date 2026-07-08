import { describe, expect, it } from 'vitest'

import {
	buildBetAnnouncement,
	buildMarketCloseAnnouncement,
	buildMarketEmbed,
	buildMarketResolveAnnouncement,
	buildMarketUpdateAnnouncement,
	buildMarketVoidAnnouncement,
	buildWagerResultDm,
	formatMarketPoints,
	truncateForEmbed,
} from '../lib/market-embed'

import type { MarketDetail } from '@repo/prediction-markets'

function market(overrides: Partial<MarketDetail> = {}): MarketDetail {
	return {
		id: 'm1',
		question: 'Will it rain tomorrow?',
		status: 'open',
		closesAt: '2030-01-01T00:00:00.000Z',
		totalPool: '0',
		outcomeCount: 2,
		createdAt: '2026-01-01T00:00:00.000Z',
		discordThreadId: null,
		discordMessageId: null,
		description: null,
		createdBy: 'u1',
		rakeBps: 0,
		minStake: '1',
		maxStake: null,
		perUserCap: null,
		twoOfN: false,
		resolvedOutcomeId: null,
		resolvedBy: null,
		resolvedAt: null,
		voidReason: null,
		resolvesOn: null,
		designatedResolverIds: null,
		outcomes: [
			{ id: 'o1', label: 'Yes', poolAmount: '0', sortOrder: 0, impliedOddsBps: null },
			{ id: 'o2', label: 'No', poolAmount: '0', sortOrder: 1, impliedOddsBps: null },
		],
		...overrides,
	}
}

describe('buildMarketEmbed', () => {
	it('renders "no bets yet" for a fresh market, never 0%', () => {
		const embed = buildMarketEmbed(market())
		const yes = embed.fields?.find((f) => f.name.endsWith('Yes'))
		expect(yes?.value).toContain('no bets yet')
		expect(yes?.value).not.toContain('%')
	})

	it('renders implied odds as a percentage when bets exist', () => {
		const embed = buildMarketEmbed(
			market({
				totalPool: '150',
				outcomes: [
					{ id: 'o1', label: 'Yes', poolAmount: '100', sortOrder: 0, impliedOddsBps: 6667 },
					{ id: 'o2', label: 'No', poolAmount: '50', sortOrder: 1, impliedOddsBps: 3333 },
				],
			})
		)
		const yes = embed.fields?.find((f) => f.name.endsWith('Yes'))
		expect(yes?.value).toContain('66.7%')
		expect(yes?.value).toContain('100 points')
	})

	it('uses the question as title and includes total pool + a relative close timestamp', () => {
		const embed = buildMarketEmbed(market({ totalPool: '1234567' }))
		expect(embed.title).toBe('Will it rain tomorrow?')
		const pool = embed.fields?.find((f) => f.name === 'Total pool')
		expect(pool?.value).toBe('1,234,567 points')
		const closes = embed.fields?.find((f) => f.name === 'Closes')
		expect(closes?.value).toMatch(/^<t:\d+:R>$/)
		expect(embed.footer?.text).toBe('Status: open')
	})

	it('omits description when absent and includes it when present', () => {
		expect(buildMarketEmbed(market()).description).toBeUndefined()
		expect(buildMarketEmbed(market({ description: 'Resolves per NWS.' })).description).toBe(
			'Resolves per NWS.'
		)
	})
})

describe('formatMarketPoints', () => {
	it('groups thousands and strips leading zeros', () => {
		expect(formatMarketPoints('0')).toBe('0 points')
		expect(formatMarketPoints('1000')).toBe('1,000 points')
		expect(formatMarketPoints('000123')).toBe('123 points')
	})
})

describe('buildBetAnnouncement', () => {
	it('names the bettor with the amount and outcome', () => {
		const msg = buildBetAnnouncement('<@42>', '1000', 'Yes')
		expect(msg).toBe('🎲 <@42> bet **1,000 points** on **Yes**.')
	})

	it('groups the amount using formatMarketPoints', () => {
		expect(buildBetAnnouncement('<@1>', '1234567', 'No')).toContain('1,234,567 points')
	})

	it('truncates an over-long outcome label so the message stays within limits', () => {
		const long = 'x'.repeat(300)
		const msg = buildBetAnnouncement('<@1>', '5', long)
		expect(msg).toContain('…')
		expect(msg).not.toContain('x'.repeat(300))
	})
})

describe('close / resolve / void announcements', () => {
	it('resolve announcement carries the outcome and aggregate totals', () => {
		const msg = buildMarketResolveAnnouncement('Yes', '10000', '4000')
		expect(msg).toContain('Yes')
		expect(msg).toContain('10,000 points')
		expect(msg).toContain('4,000 points')
	})

	it('void announcement states the refunded total', () => {
		expect(buildMarketVoidAnnouncement('5000')).toContain('5,000 points')
	})

	it('update announcement renders a closesAt change as a Discord timestamp', () => {
		const msg = buildMarketUpdateAnnouncement({ closesAt: '2030-01-01T00:00:00.000Z' })
		expect(msg).toContain('Market updated')
		expect(msg).toMatch(/<t:\d+:F>/)
	})

	it('update announcement notes question / description changes', () => {
		const msg = buildMarketUpdateAnnouncement({ question: true, description: true })
		expect(msg).toContain('Question updated')
		expect(msg).toContain('Description updated')
	})

	it('update announcement is null when nothing changed', () => {
		expect(buildMarketUpdateAnnouncement({})).toBeNull()
		expect(buildMarketUpdateAnnouncement({ question: false })).toBeNull()
	})

	it('close announcement mentions closed', () => {
		expect(buildMarketCloseAnnouncement().toLowerCase()).toContain('closed')
	})
})

describe('buildWagerResultDm', () => {
	const base = { question: 'Will it rain?', voided: false, outcomeLabel: 'Yes' }

	it('frames a net win with a + sign', () => {
		const msg = buildWagerResultDm({ ...base, staked: '1000', returned: '1500', net: '500' })
		expect(msg).toContain('net **+500 points**')
		expect(msg).toContain('🎉')
	})

	it('frames a net loss with the signed (negative) amount', () => {
		const msg = buildWagerResultDm({ ...base, staked: '1000', returned: '0', net: '-1000' })
		expect(msg).toContain('net **-1,000 points**')
		expect(msg).toContain('😔')
	})

	it('frames break-even', () => {
		const msg = buildWagerResultDm({ ...base, staked: '1000', returned: '1000', net: '0' })
		expect(msg).toContain('🤝')
		expect(msg).toContain('net **0 points**')
	})

	it('reports a refund on a void', () => {
		const msg = buildWagerResultDm({
			...base,
			voided: true,
			outcomeLabel: null,
			staked: '750',
			returned: '750',
			net: '0',
		})
		expect(msg).toContain('voided')
		expect(msg).toContain('750 points')
	})
})

describe('truncateForEmbed', () => {
	it('truncates only when over the limit', () => {
		expect(truncateForEmbed('short', 10)).toBe('short')
		expect(truncateForEmbed('abcdefghij', 5)).toBe('abcd…')
	})
})
