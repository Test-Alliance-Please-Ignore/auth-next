import { describe, expect, it } from 'vitest'

import { compareNumericIds, isCheckpointCurrent } from '../wallet-watermark'

describe('wallet watermark checkpoint gating', () => {
	it('treats empty upstream fetch as current regardless of checkpoint', () => {
		const current = isCheckpointCurrent(undefined, {
			maxId: null,
			maxDate: null,
			fetchedCount: 0,
		})
		expect(current).toBe(true)
	})

	it('requires checkpoint when upstream has fetched data', () => {
		const current = isCheckpointCurrent(undefined, {
			maxId: '100',
			maxDate: new Date('2026-03-20T00:00:00.000Z'),
			fetchedCount: 5,
		})
		expect(current).toBe(false)
	})

	it('is current when checkpoint cursor and lastSeenAt are >= upstream watermark', () => {
		const current = isCheckpointCurrent(
			{
				cursor: '200',
				lastSeenAt: new Date('2026-03-20T01:00:00.000Z'),
			},
			{
				maxId: '150',
				maxDate: new Date('2026-03-20T00:30:00.000Z'),
				fetchedCount: 10,
			}
		)
		expect(current).toBe(true)
	})

	it('is not current when checkpoint cursor lags behind upstream maxId', () => {
		const current = isCheckpointCurrent(
			{
				cursor: '149',
				lastSeenAt: new Date('2026-03-20T01:00:00.000Z'),
			},
			{
				maxId: '150',
				maxDate: new Date('2026-03-20T00:30:00.000Z'),
				fetchedCount: 10,
			}
		)
		expect(current).toBe(false)
	})

	it('is not current when checkpoint lastSeenAt lags behind upstream maxDate', () => {
		const current = isCheckpointCurrent(
			{
				cursor: '999',
				lastSeenAt: new Date('2026-03-19T23:00:00.000Z'),
			},
			{
				maxId: '500',
				maxDate: new Date('2026-03-20T00:00:00.000Z'),
				fetchedCount: 2,
			}
		)
		expect(current).toBe(false)
	})
})

describe('compareNumericIds', () => {
	it('compares numeric strings by bigint value', () => {
		expect(compareNumericIds('100', '99')).toBe(1)
		expect(compareNumericIds('99', '100')).toBe(-1)
		expect(compareNumericIds('100', '100')).toBe(0)
	})

	it('falls back to lexical compare for non-numeric IDs', () => {
		expect(compareNumericIds('abc2', 'abc10')).toBeGreaterThan(0)
		expect(compareNumericIds('abc1', 'abc1')).toBe(0)
	})
})
