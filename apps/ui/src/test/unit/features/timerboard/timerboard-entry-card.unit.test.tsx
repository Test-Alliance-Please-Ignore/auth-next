import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { TimerboardEntryCard } from '@/features/timerboard/components/timerboard-entry-card'

import type { TimerboardEntry } from '@/features/timerboard/types'

const entry: TimerboardEntry = {
	id: '22222222-2222-4222-8222-222222222222',
	kind: 'fleet',
	title: 'Armor formup',
	priority: 'high',
	side: 'friendly',
	startsAt: '2026-09-01T20:00:00.000Z',
	endsAt: '2026-09-01T21:00:00.000Z',
	state: 'planned',
	systemId: null,
	systemName: '1DQ1-A',
	entityId: null,
	entityType: null,
	entityName: null,
	assignedUserId: null,
	assignedCharacterId: null,
	assignedCharacterName: null,
	notes: null,
	sourceKind: 'manual',
	sourceReference: null,
	createdByUserId: '11111111-1111-4111-8111-111111111111',
	updatedByUserId: '11111111-1111-4111-8111-111111111111',
	version: 1,
	createdAt: '2026-08-30T19:00:00.000Z',
	updatedAt: '2026-08-30T19:00:00.000Z',
	isOverdue: false,
	actions: {
		canEdit: true,
		canAssign: false,
		canSetCovered: true,
		canComplete: true,
		canCancel: false,
	},
}

describe('TimerboardEntryCard', () => {
	it('renders a timer window, EVE label, and countdown accessibly', () => {
		const html = renderToStaticMarkup(
			<TimerboardEntryCard entry={entry} nowMs={Date.parse('2026-09-01T19:30:00.000Z')} />
		)

		expect(html).toContain('Armor formup')
		expect(html).toContain('1DQ1-A')
		expect(html).toContain('Starts')
		expect(html).toContain('01 Sept 2026')
		expect(html).toContain('20:00–21:00 EVE')
		expect(html).toMatch(/In\s*<span[^>]*>30 minutes<\/span>/)
		expect(html).toMatch(/>High priority<\/span>/)
	})

	it('derives overdue copy from the live client clock', () => {
		const html = renderToStaticMarkup(
			<TimerboardEntryCard
				entry={{ ...entry, endsAt: null, isOverdue: false }}
				nowMs={Date.parse('2026-09-01T20:30:00.000Z')}
			/>
		)

		expect(html).toContain('Overdue · 30 minutes')
		expect(html).not.toContain('In <')
	})
})
