// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TimerboardDetail } from '@/features/timerboard/components/timerboard-detail'

import type { TimerboardActivity, TimerboardEntry } from '@/features/timerboard/types'

const mutationMocks = vi.hoisted(() => ({ assign: vi.fn() }))

const entry: TimerboardEntry = {
	id: '22222222-2222-4222-8222-222222222222',
	kind: 'fleet',
	title: 'Updated timer',
	priority: 'high',
	side: 'friendly',
	startsAt: '2026-09-01T20:00:00.000Z',
	endsAt: null,
	state: 'covered',
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
	version: 2,
	createdAt: '2026-08-30T19:00:00.000Z',
	updatedAt: '2026-08-30T19:05:00.000Z',
	isOverdue: false,
	actions: {
		canEdit: false,
		canAssign: true,
		canSetCovered: false,
		canComplete: true,
		canCancel: true,
	},
}

const activity: TimerboardActivity[] = [
	{
		id: '33333333-3333-4333-8333-333333333333',
		entryId: entry.id,
		actorUserId: entry.updatedByUserId,
		actorCharacterName: 'Director Example',
		action: 'updated',
		payload: {
			changes: {
				title: { previous: 'Original timer', next: 'Updated timer' },
			},
		},
		createdAt: '2026-08-30T19:05:00.000Z',
	},
]

vi.mock('@/features/timerboard/hooks', () => ({
	useTimerboardEntry: () => ({ data: entry, isLoading: false, error: null }),
	useTimerboardActivity: () => ({ data: activity, isLoading: false, error: null }),
	useSetTimerboardState: () => ({ mutate: vi.fn(), error: null }),
	useAssignTimerboardEntry: () => ({ mutate: mutationMocks.assign, error: null, isPending: false }),
}))

vi.mock('@/features/timerboard/components/timerboard-assignment-select', () => ({
	TimerboardAssignmentSelect: ({
		onChange,
	}: {
		onChange: (candidate: {
			userId: string
			characterId: string
			characterName: string
			isPrimary: boolean
		}) => void
	}) => (
		<button
			type="button"
			onClick={() =>
				onChange({
					userId: '44444444-4444-4444-8444-444444444444',
					characterId: '2112625428',
					characterName: 'FC Example',
					isPrimary: true,
				})
			}
		>
			Select FC Example
		</button>
	),
}))

describe('TimerboardDetail', () => {
	it('assigns a searched character and renders actor names instead of UUIDs', () => {
		render(<TimerboardDetail entryId={entry.id} onEdit={vi.fn()} />)

		expect(screen.getByText('Title: Original timer → Updated timer')).toBeTruthy()
		expect(screen.getByText(/By Director Example/)).toBeTruthy()
		expect(screen.queryByRole('textbox', { name: 'User UUID' })).toBeNull()

		fireEvent.click(screen.getByRole('button', { name: 'Select FC Example' }))
		fireEvent.click(screen.getByRole('button', { name: 'Assign' }))

		expect(mutationMocks.assign).toHaveBeenCalledWith({
			entryId: entry.id,
			input: {
				userId: '44444444-4444-4444-8444-444444444444',
				characterId: '2112625428',
				characterName: 'FC Example',
				expectedVersion: 2,
			},
		})
	})
})
