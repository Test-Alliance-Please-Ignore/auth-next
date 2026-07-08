import { describe, expect, it } from 'vitest'

import { buildMarketComponents } from '../lib/market-components'

import type { MarketDetail, MarketStatus } from '@repo/prediction-markets'

function market(status: MarketStatus, outcomes = 2): MarketDetail {
	return {
		id: 'm1',
		question: 'Q?',
		status,
		closesAt: '2030-01-01T00:00:00.000Z',
		totalPool: '0',
		outcomeCount: outcomes,
		createdAt: '2026-01-01T00:00:00.000Z',
		discordThreadId: 't1',
		discordMessageId: 't1',
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
		designatedResolverIds: null,
		outcomes: Array.from({ length: outcomes }, (_, i) => ({
			id: `o${i + 1}`,
			label: `Outcome ${i + 1}`,
			poolAmount: '0',
			sortOrder: i,
			impliedOddsBps: null,
		})),
	}
}

const ids = (rows: ReturnType<typeof buildMarketComponents>): string[] =>
	rows.flatMap((r) => r.components.map((c) => c.custom_id ?? ''))

describe('buildMarketComponents', () => {
	it('open: bet buttons per outcome + Close + Void', () => {
		const all = ids(buildMarketComponents(market('open', 3)))
		expect(all.filter((id) => id.startsWith('bet:'))).toHaveLength(3)
		expect(all).toContain('mkt:close:m1')
		expect(all).toContain('mkt:void:m1')
		expect(all).not.toContain('mkt:resolve:m1')
		expect(all).not.toContain('mkt:approve:m1')
	})

	it('closed: Resolve + Void, no bet buttons', () => {
		const all = ids(buildMarketComponents(market('closed')))
		expect(all).toEqual(['mkt:resolve:m1', 'mkt:void:m1'])
	})

	it('resolving: Approve + Void', () => {
		const all = ids(buildMarketComponents(market('resolving')))
		expect(all).toEqual(['mkt:approve:m1', 'mkt:void:m1'])
	})

	it('terminal (resolved/voided/draft): no controls', () => {
		expect(buildMarketComponents(market('resolved'))).toEqual([])
		expect(buildMarketComponents(market('voided'))).toEqual([])
		expect(buildMarketComponents(market('draft'))).toEqual([])
	})

	it('stays within Discord’s 5-row limit at the 20-outcome max', () => {
		const rows = buildMarketComponents(market('open', 20))
		expect(rows.length).toBeLessThanOrEqual(5)
		expect(ids(rows).filter((id) => id.startsWith('bet:'))).toHaveLength(20)
	})
})
