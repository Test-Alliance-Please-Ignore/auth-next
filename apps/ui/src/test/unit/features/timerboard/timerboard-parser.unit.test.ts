import { describe, expect, it } from 'vitest'

import { parseTimerboardText } from '@/features/timerboard/timerboard-parser'

describe('parseTimerboardText', () => {
	it('parses structure reinforcement text from the in-game format', () => {
		expect(parseTimerboardText('Astrahus (1DQ1-A) Reinforced until 2026.09.12 20:30:00')).toEqual({
			title: 'Astrahus',
			systemName: '1DQ1-A',
			eventAt: '2026-09-12T20:30:00.000Z',
			event: 'reinforced',
		})
	})

	it('accepts dashed system text and anchoring dates', () => {
		expect(
			parseTimerboardText('1DQ1-A - Moon pull Anchoring until 2026-09-12 20:30')
		).toMatchObject({
			title: 'Moon pull',
			systemName: '1DQ1-A',
			eventAt: '2026-09-12T20:30:00.000Z',
			event: 'anchoring',
		})
	})

	it('rejects text without a valid date', () => {
		expect(parseTimerboardText('Astrahus (1DQ1-A)')).toBeNull()
	})
})
