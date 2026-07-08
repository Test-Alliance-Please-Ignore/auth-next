import { describe, expect, it } from 'vitest'

import { bucketThresholdImpact, thresholdEqual } from '../threshold-impact'

import type { ThresholdMarketRow } from '../threshold-impact'

const R1 = '11111111-1111-1111-1111-111111111111'
const R2 = '22222222-2222-2222-2222-222222222222'

function mkt(over: Partial<ThresholdMarketRow> & { id: string }): ThresholdMarketRow {
	return {
		question: 'Q',
		status: 'open',
		totalPool: '0',
		twoOfN: false,
		designatedResolvers: null,
		...over,
	}
}

describe('thresholdEqual', () => {
	it('treats both-null as equal, null vs value as unequal', () => {
		expect(thresholdEqual(null, null)).toBe(true)
		expect(thresholdEqual(null, '5')).toBe(false)
		expect(thresholdEqual('5', null)).toBe(false)
	})
	it('compares numerically, not by raw string (leading zeros equal)', () => {
		expect(thresholdEqual('100', '0100')).toBe(true)
		expect(thresholdEqual('100', '200')).toBe(false)
	})
})

describe('bucketThresholdImpact — flip counts', () => {
	it('counts a closed market crossing the raised candidate as newly-requiring', () => {
		const r = bucketThresholdImpact(
			[mkt({ id: 'a', status: 'closed', totalPool: '500' })],
			null,
			'400'
		)
		expect(r.newlyRequiringCount).toBe(1)
		expect(r.noLongerRequiringCount).toBe(0)
	})
	it('counts a market that no longer crosses when the threshold is raised', () => {
		const r = bucketThresholdImpact(
			[mkt({ id: 'a', status: 'closed', totalPool: '500' })],
			'400',
			'600'
		)
		expect(r.newlyRequiringCount).toBe(0)
		expect(r.noLongerRequiringCount).toBe(1)
	})
	it('nulling the threshold moves everything to no-longer-requiring', () => {
		const r = bucketThresholdImpact(
			[mkt({ id: 'a', status: 'closed', totalPool: '500' })],
			'400',
			null
		)
		expect(r.noLongerRequiringCount).toBe(1)
	})
	it('excludes markets already flagged twoOfN=true from flip counts', () => {
		const r = bucketThresholdImpact(
			[mkt({ id: 'a', status: 'closed', totalPool: '500', twoOfN: true })],
			null,
			'400'
		)
		expect(r.newlyRequiringCount).toBe(0)
	})
})

describe('bucketThresholdImpact — stranding (size-1 designated)', () => {
	it('strands an OPEN size-1 market under ANY positive candidate (pool can grow)', () => {
		const r = bucketThresholdImpact(
			[mkt({ id: 'a', status: 'open', totalPool: '10', designatedResolvers: [R1] })],
			null,
			'1000000'
		)
		expect(r.strandedCandidates.map((s) => s.marketId)).toEqual(['a'])
	})
	it('does NOT strand a CLOSED size-1 market whose frozen pool is below the candidate', () => {
		const r = bucketThresholdImpact(
			[mkt({ id: 'a', status: 'closed', totalPool: '10', designatedResolvers: [R1] })],
			null,
			'1000000'
		)
		expect(r.strandedCandidates).toEqual([])
	})
	it('strands a CLOSED size-1 market whose frozen pool crosses the candidate', () => {
		const r = bucketThresholdImpact(
			[mkt({ id: 'a', status: 'closed', totalPool: '5000', designatedResolvers: [R1] })],
			null,
			'400'
		)
		expect(r.strandedCandidates.map((s) => s.marketId)).toEqual(['a'])
	})
	it('does NOT re-strand a market already at-risk under the current threshold', () => {
		// open size-1, current threshold already set → already at-risk → change is not NEWLY stranding
		const r = bucketThresholdImpact(
			[mkt({ id: 'a', status: 'open', totalPool: '10', designatedResolvers: [R1] })],
			'500',
			'400'
		)
		expect(r.strandedCandidates).toEqual([])
	})
	it('does not strand size-0 or size-2+ designated sets', () => {
		const r = bucketThresholdImpact(
			[
				mkt({ id: 'a', status: 'open', totalPool: '10', designatedResolvers: null }),
				mkt({ id: 'b', status: 'open', totalPool: '10', designatedResolvers: [R1, R2] }),
			],
			null,
			'1000'
		)
		expect(r.strandedCandidates).toEqual([])
	})
	it('never strands when the candidate is null (disable)', () => {
		const r = bucketThresholdImpact(
			[mkt({ id: 'a', status: 'open', totalPool: '10', designatedResolvers: [R1] })],
			'500',
			null
		)
		expect(r.strandedCandidates).toEqual([])
	})
})
