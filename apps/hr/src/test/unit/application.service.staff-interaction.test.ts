import { describe, expect, it, vi } from 'vitest'

import { ApplicationService } from '../../services/application.service'

import type { ServiceContext } from '../../services/context'

function makeApp(overrides: Record<string, unknown> = {}) {
	return {
		id: 'app-1',
		userId: 'user-1',
		characterId: 'char-1',
		characterName: 'Pilot One',
		corporationId: 'corp-1',
		applicationText: 'hello',
		status: 'pending',
		reviewedBy: null,
		reviewedAt: null,
		reviewNotes: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		lastStaffInteractionAt: null,
		...overrides,
	}
}

function makeService(db: any) {
	const ctx = { db, env: {} } as unknown as ServiceContext
	return new ApplicationService(ctx)
}

describe('ApplicationService.updateApplicationStatus', () => {
	it('sets lastStaffInteractionAt when updating status', async () => {
		const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
		const insertValues = vi.fn().mockResolvedValue(undefined)

		const db = {
			query: {
				applications: {
					findFirst: vi.fn().mockResolvedValue(makeApp({ status: 'pending' })),
				},
			},
			update: vi.fn().mockReturnValue({ set: updateSet }),
			insert: vi.fn().mockReturnValue({ values: insertValues }),
		}

		const service = makeService(db)
		await service.updateApplicationStatus(
			'app-1',
			'under_review',
			'reviewer-1',
			'char-2',
			'Reviewer One',
			'notes'
		)

		expect(updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'under_review',
				lastStaffInteractionAt: expect.any(Date),
				updatedAt: expect.any(Date),
				reviewedBy: 'reviewer-1',
				reviewedAt: expect.any(Date),
				reviewNotes: 'notes',
			})
		)
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'status_changed',
				previousValue: 'pending',
				newValue: 'under_review',
			})
		)
	})
})
