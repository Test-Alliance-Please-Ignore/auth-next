import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { TimerboardList } from '@/features/timerboard/components/timerboard-list'

describe('TimerboardList', () => {
	it('renders an accessible loading state', () => {
		const html = renderToStaticMarkup(
			<TimerboardList entries={[]} nowMs={Date.parse('2026-09-01T19:30:00.000Z')} isLoading />
		)

		expect(html).toContain('role="status"')
		expect(html).toContain('Loading timers')
	})

	it('renders a useful empty board state', () => {
		const html = renderToStaticMarkup(
			<TimerboardList entries={[]} nowMs={Date.parse('2026-09-01T19:30:00.000Z')} />
		)

		expect(html).toContain('No timers match these filters')
		expect(html).toContain('Try a wider time range')
	})

	it('renders a safe error state', () => {
		const html = renderToStaticMarkup(
			<TimerboardList
				entries={[]}
				nowMs={Date.parse('2026-09-01T19:30:00.000Z')}
				error="Timerboard could not be loaded"
			/>
		)

		expect(html).toContain('Timerboard could not be loaded')
	})
})
