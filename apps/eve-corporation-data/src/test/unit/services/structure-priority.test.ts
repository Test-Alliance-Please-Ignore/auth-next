import { describe, expect, it } from 'vitest'

import { buildPriorityQueuedEntries } from '../../../services/structure-priority'

describe('buildPriorityQueuedEntries', () => {
	it('keeps new entries first and accepts pruning from a separate inventory query', () => {
		const result = buildPriorityQueuedEntries(
			[{ id: 'existing-due' }, { id: 'existing-cooldown' }, { id: 'new-structure' }],
			['new-structure'],
			[
				{
					structureId: 'existing-due',
					lastAttemptedSyncAt: null,
					lastSyncedAt: new Date('2026-07-22T00:00:00.000Z'),
				},
				{
					structureId: 'departed-structure',
					lastAttemptedSyncAt: null,
					lastSyncedAt: new Date('2026-07-21T00:00:00.000Z'),
				},
			],
			{ pruneCandidateIds: ['departed-structure'] }
		)

		expect(result.entries.map(({ entry }) => entry.id)).toEqual(['new-structure', 'existing-due'])
		expect(result.pruneCandidateIds).toEqual(['departed-structure'])
	})

	it('does not queue persisted entries that are on cooldown', () => {
		const result = buildPriorityQueuedEntries(
			[{ id: 'live-due' }, { id: 'live-cooldown' }],
			[],
			[
				{
					structureId: 'live-due',
					lastAttemptedSyncAt: null,
					lastSyncedAt: new Date('2026-07-22T00:00:00.000Z'),
				},
			],
			{ pruneCandidateIds: [] }
		)

		expect(result.entries.map(({ entry }) => entry.id)).toEqual(['live-due'])
		expect(result.pruneCandidateIds).toEqual([])
	})

	it('bounds the queue without dropping prune candidates', () => {
		const result = buildPriorityQueuedEntries(
			[{ id: 'new-1' }, { id: 'new-2' }, { id: 'oldest' }],
			['new-1', 'new-2'],
			[
				{
					structureId: 'oldest',
					lastAttemptedSyncAt: null,
					lastSyncedAt: new Date('2026-07-22T00:00:00.000Z'),
				},
			],
			{ pruneCandidateIds: ['gone'], maxEntries: 2 }
		)

		expect(result.entries.map(({ entry }) => entry.id)).toEqual(['new-1', 'new-2'])
		expect(result.pruneCandidateIds).toEqual(['gone'])
	})
})
