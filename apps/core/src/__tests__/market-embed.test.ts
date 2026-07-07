import { describe, expect, it } from 'vitest'

import { buildMarketEmbed, formatMarketPoints, truncateForEmbed } from '../lib/market-embed'

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

describe('truncateForEmbed', () => {
	it('truncates only when over the limit', () => {
		expect(truncateForEmbed('short', 10)).toBe('short')
		expect(truncateForEmbed('abcdefghij', 5)).toBe('abcd…')
	})
})
