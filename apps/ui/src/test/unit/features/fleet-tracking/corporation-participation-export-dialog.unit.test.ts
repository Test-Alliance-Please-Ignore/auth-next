import { describe, expect, it } from 'vitest'

import { buildParticipationPeriodOptions } from '@/features/fleet-tracking/components/corporation-participation-export-dialog'

describe('buildParticipationPeriodOptions', () => {
	it('keeps current and previous months represented by the preset options', () => {
		const options = buildParticipationPeriodOptions(
			[
				{ month: '2026-08', from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
				{ month: '2026-07', from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
				{ month: '2026-06', from: '2026-06-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' },
				{ month: '2026-05', from: '2026-05-01T00:00:00.000Z', to: '2026-06-01T00:00:00.000Z' },
			],
			new Date('2026-08-05T12:00:00.000Z')
		)

		expect(options.map((option) => option.value)).toEqual([
			'month-to-date',
			'last-month',
			'month:2026-06',
			'month:2026-05',
		])
		expect(options.slice(2).map((option) => option.label)).toEqual(['June 2026', 'May 2026'])
	})
})
