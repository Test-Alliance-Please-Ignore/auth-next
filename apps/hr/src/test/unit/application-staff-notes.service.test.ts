import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applicationActivityLog, applications, applicationStaffNotes } from '../../db/schema'
import { ApplicationStaffNotesService } from '../../services/application-staff-notes.service'

import type { ServiceContext } from '../../services/context'

function makeService(db: any) {
	const ctx = { db, env: {} } as unknown as ServiceContext
	return new ApplicationStaffNotesService(ctx)
}

describe('ApplicationStaffNotesService', () => {
	beforeEach(() => {
		vi.useRealTimers()
	})

	it('creates a staff note, logs activity, and touches application interaction timestamp', async () => {
		const createdRow = {
			id: 'note-1',
			applicationId: 'app-1',
			authorId: 'user-1',
			authorCharacterId: 'char-1',
			authorCharacterName: 'Pilot One',
			noteText: 'check fit variance',
			createdAt: new Date(),
			updatedAt: new Date(),
		}

		const createdValues = vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([createdRow]),
		})
		const activityValues = vi.fn().mockResolvedValue(undefined)
		const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })

		const db = {
			query: {
				applicationStaffNotes: {
					findMany: vi.fn(),
					findFirst: vi.fn(),
				},
			},
			insert: vi.fn((table: unknown) => {
				if (table === applicationStaffNotes) {
					return { values: createdValues }
				}
				if (table === applicationActivityLog) {
					return { values: activityValues }
				}
				return { values: vi.fn().mockResolvedValue(undefined) }
			}),
			update: vi.fn().mockImplementation((table: unknown) => {
				if (table === applications) {
					return { set: updateSet }
				}
				return { set: vi.fn() }
			}),
		}

		const service = makeService(db)
		const result = await service.create(
			'app-1',
			'user-1',
			'char-1',
			'Pilot One',
			'check fit variance'
		)

		expect(result).toMatchObject({
			id: 'note-1',
			applicationId: 'app-1',
			authorId: 'user-1',
		})
		expect(createdValues).toHaveBeenCalledWith(
			expect.objectContaining({
				applicationId: 'app-1',
				noteText: 'check fit variance',
			})
		)
		expect(activityValues).toHaveBeenCalledWith(
			expect.objectContaining({
				applicationId: 'app-1',
				userId: 'user-1',
				action: 'staff_note_added',
			})
		)
		expect(updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				lastStaffInteractionAt: expect.any(Date),
				updatedAt: expect.any(Date),
			})
		)
	})

	it('updates a staff note and records actor in activity log', async () => {
		const existing = {
			id: 'note-1',
			applicationId: 'app-1',
			authorId: 'user-1',
			authorCharacterId: 'char-1',
			authorCharacterName: 'Pilot One',
			noteText: 'old note',
			createdAt: new Date(),
			updatedAt: new Date(),
		}
		const updated = { ...existing, noteText: 'new note', updatedAt: new Date() }

		const activityValues = vi.fn().mockResolvedValue(undefined)
		const updateStaffNotesSet = vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				returning: vi.fn().mockResolvedValue([updated]),
			}),
		})
		const updateApplicationSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })

		const db = {
			query: {
				applicationStaffNotes: {
					findMany: vi.fn(),
					findFirst: vi.fn().mockResolvedValue(existing),
				},
			},
			insert: vi.fn((table: unknown) => {
				if (table === applicationActivityLog) return { values: activityValues }
				return { values: vi.fn() }
			}),
			update: vi.fn((table: unknown) => {
				if (table === applicationStaffNotes) return { set: updateStaffNotesSet }
				if (table === applications) return { set: updateApplicationSet }
				return { set: vi.fn() }
			}),
			delete: vi.fn(),
		}

		const service = makeService(db)
		const result = await service.update(
			'note-1',
			'new note',
			'reviewer-2',
			'char-2',
			'Reviewer Two'
		)

		expect(result.noteText).toBe('new note')
		expect(activityValues).toHaveBeenCalledWith(
			expect.objectContaining({
				applicationId: 'app-1',
				userId: 'reviewer-2',
				characterId: 'char-2',
				characterName: 'Reviewer Two',
				action: 'staff_note_updated',
			})
		)
		expect(updateApplicationSet).toHaveBeenCalledWith(
			expect.objectContaining({
				lastStaffInteractionAt: expect.any(Date),
			})
		)
	})

	it('deletes a staff note and records actor in activity log', async () => {
		const existing = {
			id: 'note-1',
			applicationId: 'app-1',
			authorId: 'user-1',
			authorCharacterId: 'char-1',
			authorCharacterName: 'Pilot One',
			noteText: 'old note',
			createdAt: new Date(),
			updatedAt: new Date(),
		}

		const activityValues = vi.fn().mockResolvedValue(undefined)
		const deleteWhere = vi.fn().mockResolvedValue(undefined)
		const updateApplicationSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })

		const db = {
			query: {
				applicationStaffNotes: {
					findMany: vi.fn(),
					findFirst: vi.fn().mockResolvedValue(existing),
				},
			},
			insert: vi.fn((table: unknown) => {
				if (table === applicationActivityLog) return { values: activityValues }
				return { values: vi.fn() }
			}),
			delete: vi.fn().mockReturnValue({ where: deleteWhere }),
			update: vi.fn((table: unknown) => {
				if (table === applications) return { set: updateApplicationSet }
				return { set: vi.fn() }
			}),
		}

		const service = makeService(db)
		await service.delete('note-1', 'admin-1', 'char-99', 'Admin Pilot')

		expect(deleteWhere).toHaveBeenCalledTimes(1)
		expect(activityValues).toHaveBeenCalledWith(
			expect.objectContaining({
				applicationId: 'app-1',
				userId: 'admin-1',
				characterId: 'char-99',
				characterName: 'Admin Pilot',
				action: 'staff_note_deleted',
			})
		)
		expect(updateApplicationSet).toHaveBeenCalledWith(
			expect.objectContaining({
				lastStaffInteractionAt: expect.any(Date),
			})
		)
	})
})
