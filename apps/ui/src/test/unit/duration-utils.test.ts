import { describe, expect, it } from 'vitest'

import { formatDurationBetween, formatDurationMs, formatDurationUntil } from '@/lib/duration-utils'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS
const MONTH_MS = 30 * DAY_MS
const YEAR_MS = 365 * DAY_MS

describe('duration utils', () => {
	it('truncates long durations to the top three non-zero units', () => {
		const durationMs =
			3 * YEAR_MS +
			1 * MONTH_MS +
			1 * WEEK_MS +
			1 * DAY_MS

		expect(formatDurationMs(durationMs)).toBe('3 years 1 month 1 week')
	})

	it('truncates month-range durations to the top three non-zero units', () => {
		const durationMs =
			3 * MONTH_MS +
			2 * WEEK_MS +
			4 * DAY_MS +
			5 * HOUR_MS

		expect(formatDurationMs(durationMs)).toBe('3 months 2 weeks 4 days')
	})

	it('truncates week-range durations to the top three non-zero units', () => {
		const durationMs =
			3 * WEEK_MS +
			6 * DAY_MS +
			14 * HOUR_MS +
			45 * MINUTE_MS

		expect(formatDurationMs(durationMs)).toBe('3 weeks 6 days 14 hours')
	})

	it('keeps minute and second precision for short durations', () => {
		const start = '2026-01-01T00:00:00.000Z'
		const end = '2026-01-01T00:01:22.000Z'
		expect(formatDurationBetween(start, end)).toBe('1 minute 22 seconds')
	})

	it('supports compact unit abbreviations', () => {
		const durationMs =
			3 * MONTH_MS +
			2 * WEEK_MS +
			4 * DAY_MS

		expect(formatDurationMs(durationMs, { style: 'compact' })).toBe('3mo 2w 4d')
	})

	it('respects the expired label for past end dates', () => {
		expect(formatDurationUntil('2026-01-01T00:00:00.000Z', {
			referenceTimeMs: Date.parse('2026-01-01T00:00:01.000Z'),
		})).toBe('Expired')
	})
})
