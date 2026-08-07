import { describe, expect, it, vi } from 'vitest'

import { ApplicationService } from '../../services/application.service'

import type { ServiceContext } from '../../services/context'

// ============================================================================
// Helpers
// ============================================================================

function makeApp(overrides: Record<string, unknown> = {}) {
	return {
		id: 'app-1',
		userId: 'user-1',
		characterId: 'char-1001',
		characterName: 'Main Pilot',
		corporationId: 'corp-1',
		applicationText: 'hello',
		status: 'pending',
		reviewedBy: null,
		reviewedAt: null,
		reviewNotes: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	}
}

function makeContext() {
	const deleteWhere = vi.fn().mockResolvedValue(undefined)

	const db = {
		query: {
			applications: {
				findFirst: vi.fn(),
			},
			applicationAlts: {
				findMany: vi.fn().mockResolvedValue([]),
			},
		},
		insert: vi.fn().mockImplementation(() => {
			// Return different mocks depending on table reference identity
			// In practice we'll configure per-test via mockReturnValueOnce
			return { values: vi.fn().mockResolvedValue([]) }
		}),
		delete: vi.fn().mockReturnValue({ where: deleteWhere }),
	}

	return { db, deleteWhere }
}

function makeService(db: ReturnType<typeof makeContext>['db']) {
	const ctx = { db, env: {} } as unknown as ServiceContext
	return new ApplicationService(ctx)
}

// ============================================================================
// addApplicationAlts
// ============================================================================

describe('ApplicationService.addApplicationAlts', () => {
	it('inserts new alts and logs one activity per alt', async () => {
		const db = makeContext().db
		db.query.applications.findFirst.mockResolvedValue(makeApp())
		db.query.applicationAlts.findMany.mockResolvedValue([])

		const insertValues = vi.fn().mockResolvedValue([])
		db.insert.mockReturnValue({ values: insertValues })

		const service = makeService(db)
		await service.addApplicationAlts('app-1', 'user-1', 'char-1001', 'Main Pilot', [
			{ characterId: 'alt-2001', characterName: 'Alt One' },
			{ characterId: 'alt-2002', characterName: 'Alt Two' },
		])

		// insert called twice: once for alts table, once per activity log entry (×2)
		expect(db.insert).toHaveBeenCalledTimes(3)
		expect(insertValues).toHaveBeenCalledTimes(3)

		// Second and third calls are activity logs
		const secondCall = insertValues.mock.calls[1][0]
		const thirdCall = insertValues.mock.calls[2][0]
		expect(secondCall).toMatchObject({
			action: 'alt_added',
			newValue: 'alt-2001',
			metadata: { altCharacterName: 'Alt One' },
		})
		expect(thirdCall).toMatchObject({
			action: 'alt_added',
			newValue: 'alt-2002',
			metadata: { altCharacterName: 'Alt Two' },
		})
	})

	it('skips alts that already exist on the application', async () => {
		const db = makeContext().db
		db.query.applications.findFirst.mockResolvedValue(makeApp())
		db.query.applicationAlts.findMany.mockResolvedValue([{ characterId: 'alt-2001' }])

		const insertValues = vi.fn().mockResolvedValue([])
		db.insert.mockReturnValue({ values: insertValues })

		const service = makeService(db)
		await service.addApplicationAlts('app-1', 'user-1', 'char-1001', 'Main Pilot', [
			{ characterId: 'alt-2001', characterName: 'Already Here' },
			{ characterId: 'alt-2002', characterName: 'New Alt' },
		])

		// Only alt-2002 is new: 1 alts insert + 1 activity log
		expect(db.insert).toHaveBeenCalledTimes(2)
		const altsInsertCall = insertValues.mock.calls[0][0]
		expect(Array.isArray(altsInsertCall)).toBe(true)
		expect(altsInsertCall).toHaveLength(1)
		expect(altsInsertCall[0]).toMatchObject({ characterId: 'alt-2002' })
	})

	it('returns early without touching DB when all alts already exist', async () => {
		const db = makeContext().db
		db.query.applications.findFirst.mockResolvedValue(makeApp())
		db.query.applicationAlts.findMany.mockResolvedValue([{ characterId: 'alt-2001' }])

		const service = makeService(db)
		await service.addApplicationAlts('app-1', 'user-1', 'char-1001', 'Main Pilot', [
			{ characterId: 'alt-2001' },
		])

		expect(db.insert).not.toHaveBeenCalled()
	})

	it('returns early without touching DB when alts array is empty', async () => {
		const db = makeContext().db
		db.query.applications.findFirst.mockResolvedValue(makeApp())

		const service = makeService(db)
		await service.addApplicationAlts('app-1', 'user-1', 'char-1001', 'Main Pilot', [])

		expect(db.query.applications.findFirst).not.toHaveBeenCalled()
		expect(db.insert).not.toHaveBeenCalled()
	})

	it('throws when application does not exist', async () => {
		const db = makeContext().db
		db.query.applications.findFirst.mockResolvedValue(null)

		const service = makeService(db)
		await expect(
			service.addApplicationAlts('app-1', 'user-1', 'char-1001', 'Main Pilot', [
				{ characterId: 'alt-2001' },
			])
		).rejects.toThrow('Application not found')
	})

	it('throws when user does not own the application', async () => {
		const db = makeContext().db
		db.query.applications.findFirst.mockResolvedValue(makeApp({ userId: 'other-user' }))

		const service = makeService(db)
		await expect(
			service.addApplicationAlts('app-1', 'user-1', 'char-1001', 'Main Pilot', [
				{ characterId: 'alt-2001' },
			])
		).rejects.toThrow('You can only modify your own applications')
	})

	it.each(['accepted', 'completed', 'rejected', 'withdrawn'] as const)(
		'throws when application is in terminal state: %s',
		async (status) => {
			const db = makeContext().db
			db.query.applications.findFirst.mockResolvedValue(makeApp({ status }))

			const service = makeService(db)
			await expect(
				service.addApplicationAlts('app-1', 'user-1', 'char-1001', 'Main Pilot', [
					{ characterId: 'alt-2001' },
				])
			).rejects.toThrow('You can only modify alts on active applications')
		}
	)

	it.each(['pending', 'under_review'] as const)(
		'allows adding alts when application status is: %s',
		async (status) => {
			const db = makeContext().db
			db.query.applications.findFirst.mockResolvedValue(makeApp({ status }))
			db.query.applicationAlts.findMany.mockResolvedValue([])
			db.insert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) })

			const service = makeService(db)
			await expect(
				service.addApplicationAlts('app-1', 'user-1', 'char-1001', 'Main Pilot', [
					{ characterId: 'alt-2001', characterName: 'Alt One' },
				])
			).resolves.toBeUndefined()
		}
	)
})

// ============================================================================
// removeApplicationAlt
// ============================================================================

describe('ApplicationService.removeApplicationAlt', () => {
	it('deletes the alt and logs an activity entry with altCharacterName', async () => {
		const { db, deleteWhere } = makeContext()
		db.query.applications.findFirst.mockResolvedValue(makeApp())

		const insertValues = vi.fn().mockResolvedValue([])
		db.insert.mockReturnValue({ values: insertValues })

		const service = makeService(db)
		await service.removeApplicationAlt(
			'app-1',
			'user-1',
			'char-1001',
			'Main Pilot',
			'alt-2001',
			'Alt One'
		)

		expect(deleteWhere).toHaveBeenCalledTimes(1)
		expect(db.insert).toHaveBeenCalledTimes(1)
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'alt_removed',
				previousValue: 'alt-2001',
				newValue: null,
				characterId: 'char-1001',
				characterName: 'Main Pilot',
				metadata: { altCharacterName: 'Alt One' },
			})
		)
	})

	it('logs activity with undefined altCharacterName when not provided', async () => {
		const { db } = makeContext()
		db.query.applications.findFirst.mockResolvedValue(makeApp())

		const insertValues = vi.fn().mockResolvedValue([])
		db.insert.mockReturnValue({ values: insertValues })

		const service = makeService(db)
		await service.removeApplicationAlt('app-1', 'user-1', 'char-1001', 'Main Pilot', 'alt-2001')

		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'alt_removed',
				metadata: { altCharacterName: undefined },
			})
		)
	})

	it('throws when application does not exist', async () => {
		const db = makeContext().db
		db.query.applications.findFirst.mockResolvedValue(null)

		const service = makeService(db)
		await expect(
			service.removeApplicationAlt('app-1', 'user-1', 'char-1001', 'Main Pilot', 'alt-2001')
		).rejects.toThrow('Application not found')
	})

	it('throws when user does not own the application', async () => {
		const db = makeContext().db
		db.query.applications.findFirst.mockResolvedValue(makeApp({ userId: 'other-user' }))

		const service = makeService(db)
		await expect(
			service.removeApplicationAlt('app-1', 'user-1', 'char-1001', 'Main Pilot', 'alt-2001')
		).rejects.toThrow('You can only modify your own applications')
	})

	it.each(['accepted', 'completed', 'rejected', 'withdrawn'] as const)(
		'throws when application is in terminal state: %s',
		async (status) => {
			const db = makeContext().db
			db.query.applications.findFirst.mockResolvedValue(makeApp({ status }))

			const service = makeService(db)
			await expect(
				service.removeApplicationAlt('app-1', 'user-1', 'char-1001', 'Main Pilot', 'alt-2001')
			).rejects.toThrow('You can only modify alts on active applications')
		}
	)

	it.each(['pending', 'under_review'] as const)(
		'allows removing alts when application status is: %s',
		async (status) => {
			const db = makeContext().db
			db.query.applications.findFirst.mockResolvedValue(makeApp({ status }))
			db.insert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) })

			const service = makeService(db)
			await expect(
				service.removeApplicationAlt(
					'app-1',
					'user-1',
					'char-1001',
					'Main Pilot',
					'alt-2001',
					'Alt One'
				)
			).resolves.toBeUndefined()
		}
	)
})
