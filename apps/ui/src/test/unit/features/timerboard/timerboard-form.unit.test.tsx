// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TimerboardForm } from '@/features/timerboard/components/timerboard-form'
import { ConflictError } from '@/lib/api'

import type { TimerboardEntry } from '@/features/timerboard/types'

const mutationMocks = vi.hoisted(() => ({
	create: vi.fn(),
	update: vi.fn(),
}))

vi.mock('@/features/timerboard/hooks', () => ({
	useCreateTimerboardEntry: () => ({
		mutateAsync: mutationMocks.create,
		isPending: false,
		error: null,
	}),
	useUpdateTimerboardEntry: () => ({
		mutateAsync: mutationMocks.update,
		isPending: false,
		error: null,
	}),
}))

const entry: TimerboardEntry = {
	id: '22222222-2222-4222-8222-222222222222',
	kind: 'fleet',
	title: 'Original timer',
	priority: 'high',
	side: 'friendly',
	startsAt: '2026-09-01T20:00:00.000Z',
	endsAt: null,
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

beforeEach(() => {
	cleanup()
	vi.clearAllMocks()
})

describe('TimerboardForm', () => {
	it('mirrors server-side EVE ID length constraints', () => {
		render(<TimerboardForm onSaved={vi.fn()} onCancel={vi.fn()} />)

		expect(screen.getByRole('textbox', { name: 'System ID' }).getAttribute('maxlength')).toBe('32')
		expect(screen.getByRole('textbox', { name: 'Entity ID' }).getAttribute('maxlength')).toBe('32')
	})

	it('loads the current entry after a conflict and retries with its version', async () => {
		const current = { ...entry, title: 'Server timer', version: 2 }
		mutationMocks.update
			.mockRejectedValueOnce(new ConflictError('Timer changed', current))
			.mockResolvedValueOnce({ ...current, title: 'Resolved timer', version: 3 })
		const onSaved = vi.fn()
		const user = userEvent.setup()
		render(<TimerboardForm entry={entry} onSaved={onSaved} onCancel={vi.fn()} />)

		await user.click(screen.getByRole('button', { name: 'Save changes' }))
		expect(await screen.findByText('This timer changed while you were editing.')).toBeTruthy()

		await user.click(screen.getByRole('button', { name: 'Load latest version' }))
		const title = screen.getByRole('textbox', { name: 'Title' })
		expect((title as HTMLInputElement).value).toBe('Server timer')
		await user.clear(title)
		await user.type(title, 'Resolved timer')
		await user.click(screen.getByRole('button', { name: 'Save changes' }))

		await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
		expect(mutationMocks.update).toHaveBeenLastCalledWith({
			entryId: entry.id,
			input: expect.objectContaining({ title: 'Resolved timer', expectedVersion: 2 }),
		})
	})
})
