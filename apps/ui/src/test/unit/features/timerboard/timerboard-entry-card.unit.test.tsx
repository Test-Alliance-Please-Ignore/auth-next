import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { TimerboardEntryCard } from '@/features/timerboard/components/timerboard-entry-card'

import type { TimerboardEntry } from '@/features/timerboard/types'

const entry: TimerboardEntry = {
	id: '22222222-2222-4222-8222-222222222222',
	category: 'fleet',
	timerType: 'custom',
	title: 'Armor formup',
	priority: 'high',
	hostility: 'friendly',
	startsAt: '2026-09-01T20:00:00.000Z',
	state: 'planned',
	systemId: null,
	systemName: '1DQ1-A',
	regionId: null,
	regionName: null,
	corporationId: null,
	corporationName: null,
	allianceId: null,
	allianceName: null,
	subjectId: null,
	subjectType: null,
	subjectName: null,
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
	it('renders an event time, EVE label, and countdown accessibly', () => {
		const html = renderToStaticMarkup(
			<TimerboardEntryCard entry={entry} nowMs={Date.parse('2026-09-01T19:30:00.000Z')} />
		)

		expect(html).toContain('Armor formup')
		expect(html).toContain('1DQ1-A')
		expect(html).toContain('Event')
		expect(html).toContain('Sep 01, 26')
		expect(html).toContain('20:00 EVE')
		expect(html).toMatch(/In\s*<span[^>]*>30 minutes<\/span>/)
		expect(html).toMatch(/>High priority<\/span>/)
	})

	it('derives overdue copy from the live client clock', () => {
		const html = renderToStaticMarkup(
			<TimerboardEntryCard
				entry={{ ...entry, isOverdue: false }}
				nowMs={Date.parse('2026-09-01T20:30:00.000Z')}
			/>
		)

		expect(html).toContain('Overdue · 30 minutes')
		expect(html).not.toContain('In <')
	})
})
