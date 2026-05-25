import { describe, expect, it } from 'vitest'

import {
	dateInputToIsoEndExclusive,
	dateInputToIsoStart,
} from '@/features/fleet-tracking/routes/tracking-sessions-list'
import { formatDurationBetween, formatEndReason } from '@/features/fleet-tracking/utils/format'

describe('fleet tracking date filter conversion', () => {
	it('converts start date to UTC midnight iso', () => {
		expect(dateInputToIsoStart('2026-05-25')).toBe('2026-05-25T00:00:00.000Z')
	})

	it('converts end date to exclusive next-day UTC midnight iso', () => {
		expect(dateInputToIsoEndExclusive('2026-05-25')).toBe('2026-05-26T00:00:00.000Z')
	})

	it('returns undefined for invalid/empty date input', () => {
		expect(dateInputToIsoStart('')).toBeUndefined()
		expect(dateInputToIsoEndExclusive('not-a-date')).toBeUndefined()
	})
})

describe('fleet tracking formatting helpers', () => {
	it('formats known end reasons with friendly labels', () => {
		expect(formatEndReason('fleet_disbanded')).toBe('Fleet disbanded')
		expect(formatEndReason('user_stopped')).toBe('Stopped by user')
	})

	it('formats session duration between timestamps', () => {
		const start = '2026-05-25T00:00:00.000Z'
		const end = '2026-05-25T01:30:00.000Z'
		expect(formatDurationBetween(start, end)).toContain('1h')
	})
})
