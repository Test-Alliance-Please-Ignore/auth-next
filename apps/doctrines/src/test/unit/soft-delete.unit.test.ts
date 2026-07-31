import { describe, expect, it, vi } from 'vitest'

import { DoctrinesDO } from '../../durable-object'

vi.mock('cloudflare:workers', () => ({
	DurableObject: class {},
}))

function createSubjectWithDb(db: unknown) {
	const subject = Object.create(DoctrinesDO.prototype) as InstanceType<typeof DoctrinesDO>
	;(subject as unknown as { db: unknown }).db = db
	return subject
}

describe('DoctrinesDO soft-delete behavior', () => {
	it('deleteDoctrine writes snapshot and marks doctrine deleted', async () => {
		const doctrineRow = {
			id: 'doc-1',
			name: 'Test Doctrine',
			description: null,
			shipTypeId: null,
			categoryId: null,
			sortOrder: 0,
			updatedBy: 'tester',
			createdAt: new Date(),
			updatedAt: new Date(),
			deletedAt: null,
			deletedBy: null,
			category: null,
			doctrineFittings: [],
			doctrineStagingSystems: [],
		}

		const insertValues = vi.fn()
		const updateSet = vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined),
		})

		const db = {
			query: {
				doctrinesDoctrines: {
					findFirst: vi.fn().mockResolvedValue(doctrineRow),
				},
			},
			insert: vi.fn().mockReturnValue({
				values: insertValues,
			}),
			update: vi.fn().mockReturnValue({
				set: updateSet,
			}),
		}

		const subject = createSubjectWithDb(db)
		await subject.deleteDoctrine('doc-1', 'Alice FC')

		expect(db.query.doctrinesDoctrines.findFirst).toHaveBeenCalledOnce()
		expect(db.insert).toHaveBeenCalledOnce()
		expect(insertValues).toHaveBeenCalledOnce()
		expect(updateSet).toHaveBeenCalledOnce()
	})

	it('deleteFitting writes snapshot and marks fitting deleted', async () => {
		const fittingRow = {
			id: 'fit-1',
			name: 'Muninn',
			description: null,
			shipTypeId: '12015',
			shipName: 'Muninn',
			fitting: '[Muninn, test]',
			category: 'HAC',
			srpEligible: true,
			srpValue: '100000000',
			createdAt: new Date(),
			updatedAt: new Date(),
			deletedAt: null,
			deletedBy: null,
			fittingItems: [],
			doctrineFittings: [],
		}

		const insertValues = vi.fn()
		const updateSet = vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined),
		})

		const db = {
			query: {
				doctrinesFittings: {
					findFirst: vi.fn().mockResolvedValue(fittingRow),
				},
			},
			insert: vi.fn().mockReturnValue({
				values: insertValues,
			}),
			update: vi.fn().mockReturnValue({
				set: updateSet,
			}),
		}

		const subject = createSubjectWithDb(db)
		await subject.deleteFitting('fit-1', 'Alice FC')

		expect(db.query.doctrinesFittings.findFirst).toHaveBeenCalledOnce()
		expect(db.insert).toHaveBeenCalledOnce()
		expect(insertValues).toHaveBeenCalledOnce()
		expect(updateSet).toHaveBeenCalledOnce()
	})

	it('addFittingToDoctrine rejects deleted doctrine', async () => {
		const db = {
			query: {
				doctrinesDoctrines: {
					findFirst: vi.fn().mockResolvedValue(null),
				},
				doctrinesFittings: {
					findFirst: vi.fn(),
				},
				doctrinesDoctrineFittings: {
					findFirst: vi.fn(),
				},
			},
			insert: vi.fn(),
		}

		const subject = createSubjectWithDb(db)
		await expect(
			subject.addFittingToDoctrine('doc-1', {
				fittingId: 'fit-1',
				fittingCategory: 'DPS',
				sortOrder: 0,
			})
		).rejects.toThrow('Doctrine not found')
	})

	it('addFittingToDoctrine rejects deleted fitting', async () => {
		const db = {
			query: {
				doctrinesDoctrines: {
					findFirst: vi.fn().mockResolvedValue({ id: 'doc-1' }),
				},
				doctrinesFittings: {
					findFirst: vi.fn().mockResolvedValue(null),
				},
				doctrinesDoctrineFittings: {
					findFirst: vi.fn(),
				},
			},
			insert: vi.fn(),
		}

		const subject = createSubjectWithDb(db)
		await expect(
			subject.addFittingToDoctrine('doc-1', {
				fittingId: 'fit-1',
				fittingCategory: 'DPS',
				sortOrder: 0,
			})
		).rejects.toThrow('Fitting not found')
	})
})
