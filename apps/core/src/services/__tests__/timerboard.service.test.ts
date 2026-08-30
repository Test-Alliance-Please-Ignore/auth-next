import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	TimerboardConflictError,
	TimerboardForbiddenError,
	TimerboardService,
	TimerboardValidationError,
} from '../timerboard.service'

import type { TimerboardState } from '../timerboard.service'

const editor = {
	userId: '11111111-1111-4111-8111-111111111111',
	isAdmin: false,
	permissionUrns: ['urn:timerboard:edit'],
} as const

const manager = {
	...editor,
	permissionUrns: ['urn:timerboard:manage'],
} as const

const viewer = {
	...editor,
	permissionUrns: ['urn:timerboard:view'],
} as const

afterEach(() => {
	vi.useRealTimers()
})

const validInput = {
	kind: 'fleet',
	title: 'Form for armor timer',
	priority: 'high',
	side: 'friendly',
	startsAt: '2026-09-01T20:00:00.000Z',
	endsAt: null,
	systemId: null,
	systemName: '1DQ1-A',
	entityId: null,
	entityType: null,
	entityName: null,
	notes: null,
} as const

function makeCreateDb() {
	const activities: Array<Record<string, unknown>> = []
	const tx = {
		insert: () => ({
			values: (values: Record<string, unknown>) => ({
				returning: async () => {
					if ('entryId' in values) {
						const activity = {
							id: '33333333-3333-4333-8333-333333333333',
							...values,
							createdAt: new Date('2026-08-30T19:00:00.000Z'),
						}
						activities.push(activity)
						return [activity]
					}

					return [
						{
							id: '22222222-2222-4222-8222-222222222222',
							...values,
							version: 1,
							createdAt: new Date('2026-08-30T19:00:00.000Z'),
							updatedAt: new Date('2026-08-30T19:00:00.000Z'),
						},
					]
				},
			}),
		}),
	}

	return {
		transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
		query: {
			timerboardEntries: {
				findFirst: async () => ({
					id: '22222222-2222-4222-8222-222222222222',
					activity: activities,
				}),
			},
			timerboardActivity: {
				findMany: async () => activities,
			},
		},
	}
}

function makeEntryRow(overrides: Record<string, unknown> = {}) {
	return {
		id: '22222222-2222-4222-8222-222222222222',
		kind: 'fleet',
		title: 'Form for armor timer',
		priority: 'high',
		side: 'friendly',
		startsAt: new Date('2026-09-01T20:00:00.000Z'),
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
		createdByUserId: editor.userId,
		updatedByUserId: editor.userId,
		version: 1,
		createdAt: new Date('2026-08-30T19:00:00.000Z'),
		updatedAt: new Date('2026-08-30T19:00:00.000Z'),
		...overrides,
	}
}

describe('TimerboardService', () => {
	it('enforces the view, edit, and manage permission boundary', async () => {
		const service = new TimerboardService({} as never)

		await expect(service.create(viewer, validInput)).rejects.toBeInstanceOf(
			TimerboardForbiddenError
		)
		await expect(
			service.assign(
				editor,
				'22222222-2222-4222-8222-222222222222',
				{ userId: null, characterId: null, characterName: null },
				1
			)
		).rejects.toBeInstanceOf(TimerboardForbiddenError)
	})

	it('derives the complete action matrix from role and ownership', async () => {
		const row = makeEntryRow()
		const db = {
			query: {
				timerboardEntries: {
					findFirst: async () => ({ ...row, activity: [] }),
				},
			},
		}
		const service = new TimerboardService(db as never)
		const otherEditor = { ...editor, userId: '88888888-8888-4888-8888-888888888888' }
		const admin = { ...viewer, userId: '99999999-9999-4999-8999-999999999999', isAdmin: true }

		const [viewActions, ownerActions, otherActions, managerActions, adminActions] =
			await Promise.all([
				service.get(viewer, row.id),
				service.get(editor, row.id),
				service.get(otherEditor, row.id),
				service.get(manager, row.id),
				service.get(admin, row.id),
			])

		expect(viewActions.actions).toEqual({
			canEdit: false,
			canAssign: false,
			canSetCovered: false,
			canComplete: false,
			canCancel: false,
		})
		expect(ownerActions.actions).toEqual({
			canEdit: true,
			canAssign: false,
			canSetCovered: true,
			canComplete: true,
			canCancel: false,
		})
		expect(otherActions.actions).toEqual(viewActions.actions)
		expect(managerActions.actions).toEqual({
			canEdit: true,
			canAssign: true,
			canSetCovered: true,
			canComplete: true,
			canCancel: true,
		})
		expect(adminActions.actions).toEqual(managerActions.actions)
	})

	it('rejects invalid text before opening a transaction', async () => {
		const service = new TimerboardService({} as never)

		await expect(service.create(editor, { ...validInput, title: '   ' })).rejects.toEqual(
			new TimerboardValidationError({ title: 'Title is required' })
		)
	})

	it('rejects invalid pagination before querying the database', async () => {
		const service = new TimerboardService({} as never)

		await expect(service.list(viewer, { page: 0, pageSize: 101 })).rejects.toEqual(
			new TimerboardValidationError({
				page: 'Page must be at least 1',
				pageSize: 'Page size must be between 1 and 100',
			})
		)
	})

	it('rejects a timer window that does not end after it starts', async () => {
		const service = new TimerboardService({} as never)

		await expect(
			service.create(editor, {
				...validInput,
				endsAt: '2026-09-01T20:00:00.000Z',
			})
		).rejects.toEqual(
			new TimerboardValidationError({
				endsAt: 'End time must be later than start time',
			})
		)
	})

	it('creates a manual timer and exposes one creation activity', async () => {
		const service = new TimerboardService(makeCreateDb() as never)

		const created = await service.create(editor, validInput)
		const activity = await service.listActivity(editor, created.id)

		expect(created).toMatchObject({
			id: '22222222-2222-4222-8222-222222222222',
			title: 'Form for armor timer',
			state: 'planned',
			sourceKind: 'manual',
			version: 1,
			startsAt: '2026-09-01T20:00:00.000Z',
			createdAt: '2026-08-30T19:00:00.000Z',
		})
		expect(activity).toEqual([
			expect.objectContaining({
				action: 'created',
				actorUserId: editor.userId,
				payload: { created: true },
				createdAt: '2026-08-30T19:00:00.000Z',
			}),
		])
	})

	it('returns the latest entry when an update uses a stale version', async () => {
		const current = makeEntryRow({ version: 3, title: 'Current title' })
		const tx = {
			query: {
				timerboardEntries: { findFirst: async () => current },
			},
		}
		const db = {
			transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
		}
		const service = new TimerboardService(db as never)

		await expect(
			service.update(editor, '22222222-2222-4222-8222-222222222222', { title: 'Stale edit' }, 2)
		).rejects.toEqual(
			new TimerboardConflictError(
				expect.objectContaining({
					version: 3,
					title: 'Current title',
					updatedAt: '2026-08-30T19:00:00.000Z',
				})
			)
		)
	})

	it('updates an owned timer and records previous values in its activity', async () => {
		let current = makeEntryRow()
		const activities: Array<Record<string, unknown>> = []
		const tx = {
			query: {
				timerboardEntries: { findFirst: async () => current },
			},
			update: () => ({
				set: (values: Record<string, unknown>) => ({
					where: () => ({
						returning: async () => {
							current = { ...current, ...values }
							return [current]
						},
					}),
				}),
			}),
			insert: () => ({
				values: (values: Record<string, unknown>) => ({
					returning: async () => {
						activities.push({
							id: '33333333-3333-4333-8333-333333333333',
							...values,
							createdAt: new Date('2026-08-30T19:05:00.000Z'),
						})
						return activities.slice(-1)
					},
				}),
			}),
		}
		const db = {
			transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
			query: {
				timerboardEntries: { findFirst: async () => ({ ...current, activity: activities }) },
				timerboardActivity: { findMany: async () => activities },
			},
		}
		const service = new TimerboardService(db as never)

		const updated = await service.update(
			editor,
			'22222222-2222-4222-8222-222222222222',
			{ title: 'Updated formup', endsAt: '2026-09-01T21:00:00.000Z' },
			1
		)
		const activity = await service.listActivity(editor, updated.id)

		expect(updated).toMatchObject({
			title: 'Updated formup',
			endsAt: '2026-09-01T21:00:00.000Z',
			version: 2,
		})
		expect(activity[0]).toMatchObject({
			action: 'updated',
			payload: {
				changes: {
					title: { previous: 'Form for armor timer', next: 'Updated formup' },
					endsAt: { previous: null, next: '2026-09-01T21:00:00.000Z' },
				},
			},
		})
	})

	it('rejects an update that does not change any fields', async () => {
		const current = makeEntryRow()
		const tx = {
			query: { timerboardEntries: { findFirst: async () => current } },
			update: vi.fn(),
			insert: vi.fn(),
		}
		const db = {
			transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
		}
		const service = new TimerboardService(db as never)

		await expect(
			service.update(
				editor,
				'22222222-2222-4222-8222-222222222222',
				{ title: 'Form for armor timer' },
				1
			)
		).rejects.toEqual(new TimerboardValidationError({ update: 'At least one field must change' }))
		expect(tx.update).not.toHaveBeenCalled()
		expect(tx.insert).not.toHaveBeenCalled()
	})

	it('does not reopen a completed timer', async () => {
		const completed = makeEntryRow({ state: 'completed' })
		const tx = {
			query: {
				timerboardEntries: { findFirst: async () => completed },
			},
		}
		const db = {
			transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
		}
		const service = new TimerboardService(db as never)

		await expect(
			service.setState(manager, '22222222-2222-4222-8222-222222222222', 'planned', 1)
		).rejects.toEqual(
			new TimerboardValidationError({
				state: 'Cannot transition a completed timer to planned',
			})
		)
	})

	it('does not move a covered timer back to planned', async () => {
		const covered = makeEntryRow({ state: 'covered' })
		const tx = {
			query: {
				timerboardEntries: { findFirst: async () => covered },
			},
		}
		const db = {
			transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
		}
		const service = new TimerboardService(db as never)

		await expect(
			service.setState(manager, '22222222-2222-4222-8222-222222222222', 'planned', 1)
		).rejects.toEqual(
			new TimerboardValidationError({
				state: 'Cannot transition a covered timer to planned',
			})
		)
	})

	it.each<[TimerboardState, TimerboardState]>([
		['planned', 'covered'],
		['planned', 'completed'],
		['planned', 'cancelled'],
		['covered', 'completed'],
		['covered', 'cancelled'],
	])('allows the %s to %s transition', async (from, to) => {
		let current = makeEntryRow({ state: from })
		const tx = {
			query: { timerboardEntries: { findFirst: async () => current } },
			update: () => ({
				set: (values: Record<string, unknown>) => ({
					where: () => ({
						returning: async () => {
							current = { ...current, ...values }
							return [current]
						},
					}),
				}),
			}),
			insert: () => ({
				values: () => ({ returning: async () => [] }),
			}),
		}
		const db = {
			transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
		}
		const service = new TimerboardService(db as never)

		await expect(service.setState(manager, current.id, to, 1)).resolves.toMatchObject({
			state: to,
			version: 2,
		})
	})

	it('lets a manager cancel a timer and preserves the cancellation in activity', async () => {
		let current = makeEntryRow()
		const activities: Array<Record<string, unknown>> = []
		const tx = {
			query: { timerboardEntries: { findFirst: async () => current } },
			update: () => ({
				set: (values: Record<string, unknown>) => ({
					where: () => ({
						returning: async () => {
							current = { ...current, ...values }
							return [current]
						},
					}),
				}),
			}),
			insert: () => ({
				values: (values: Record<string, unknown>) => ({
					returning: async () => {
						activities.push({
							id: '33333333-3333-4333-8333-333333333333',
							...values,
							createdAt: new Date('2026-08-30T19:10:00.000Z'),
						})
						return activities.slice(-1)
					},
				}),
			}),
		}
		const db = {
			transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
			query: {
				timerboardEntries: { findFirst: async () => ({ ...current, activity: activities }) },
				timerboardActivity: { findMany: async () => activities },
			},
		}
		const service = new TimerboardService(db as never)

		const cancelled = await service.setState(
			manager,
			'22222222-2222-4222-8222-222222222222',
			'cancelled',
			1
		)
		const activity = await service.listActivity(manager, cancelled.id)

		expect(cancelled).toMatchObject({ state: 'cancelled', version: 2 })
		expect(activity[0]).toMatchObject({
			action: 'cancelled',
			payload: { previous: 'planned', next: 'cancelled' },
		})
	})

	it('assigns response ownership as an audited manager command', async () => {
		let current = makeEntryRow()
		const activities: Array<Record<string, unknown>> = []
		const tx = {
			query: { timerboardEntries: { findFirst: async () => current } },
			update: () => ({
				set: (values: Record<string, unknown>) => ({
					where: () => ({
						returning: async () => {
							current = { ...current, ...values }
							return [current]
						},
					}),
				}),
			}),
			insert: () => ({
				values: (values: Record<string, unknown>) => ({
					returning: async () => {
						activities.push({
							id: '33333333-3333-4333-8333-333333333333',
							...values,
							createdAt: new Date('2026-08-30T19:15:00.000Z'),
						})
						return activities.slice(-1)
					},
				}),
			}),
		}
		const db = {
			transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
			query: {
				timerboardEntries: { findFirst: async () => ({ ...current, activity: activities }) },
				timerboardActivity: { findMany: async () => activities },
			},
		}
		const service = new TimerboardService(db as never)

		const assigned = await service.assign(
			manager,
			'22222222-2222-4222-8222-222222222222',
			{
				userId: '44444444-4444-4444-8444-444444444444',
				characterId: '2112625428',
				characterName: 'FC Example',
			},
			1
		)
		const activity = await service.listActivity(manager, assigned.id)

		expect(assigned).toMatchObject({
			assignedUserId: '44444444-4444-4444-8444-444444444444',
			assignedCharacterName: 'FC Example',
			version: 2,
		})
		expect(activity[0]).toMatchObject({
			action: 'assigned',
			payload: {
				previous: { userId: null, characterId: null, characterName: null },
				next: {
					userId: '44444444-4444-4444-8444-444444444444',
					characterId: '2112625428',
					characterName: 'FC Example',
				},
			},
		})
	})

	it('does not write an unchanged assignment', async () => {
		const current = makeEntryRow({
			assignedUserId: '44444444-4444-4444-8444-444444444444',
			assignedCharacterId: '2112625428',
			assignedCharacterName: 'FC Example',
		})
		const tx = {
			query: { timerboardEntries: { findFirst: async () => current } },
			update: vi.fn(),
			insert: vi.fn(),
		}
		const db = {
			transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
		}
		const service = new TimerboardService(db as never)

		await expect(
			service.assign(
				manager,
				current.id,
				{
					userId: current.assignedUserId,
					characterId: current.assignedCharacterId,
					characterName: current.assignedCharacterName,
				},
				1
			)
		).rejects.toEqual(new TimerboardValidationError({ assignment: 'Assignment must change' }))
		expect(tx.update).not.toHaveBeenCalled()
		expect(tx.insert).not.toHaveBeenCalled()
	})

	it('validates assignment identifiers before opening a transaction', async () => {
		const service = new TimerboardService({} as never)

		await expect(
			service.assign(
				manager,
				'22222222-2222-4222-8222-222222222222',
				{ userId: 'not-a-uuid', characterId: 'invalid', characterName: '   ' },
				1
			)
		).rejects.toEqual(
			new TimerboardValidationError({
				userId: 'Assigned user must be a valid UUID',
				characterId: 'Character ID must be a numeric EVE ID',
				characterName: 'Character name must not be blank',
			})
		)
	})

	it('lists active timers with overdue status and permission-derived actions', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-09-01T20:30:00.000Z'))
		const row = makeEntryRow()
		const db = {
			select: () => ({
				from: () => ({
					where: () => ({
						orderBy: () => ({
							limit: () => ({
								offset: async () => [{ ...row, timerboardTotal: 1 }],
							}),
						}),
					}),
				}),
			}),
		}
		const service = new TimerboardService(db as never)

		const result = await service.list(viewer, { page: 1, pageSize: 25 })

		expect(result).toMatchObject({ page: 1, pageSize: 25, total: 1 })
		expect(result.items[0]).toMatchObject({
			id: '22222222-2222-4222-8222-222222222222',
			isOverdue: true,
			actions: {
				canEdit: false,
				canAssign: false,
				canSetCovered: false,
				canComplete: false,
				canCancel: false,
			},
		})
	})

	it('searches active assignment characters once per cached query and requires manage access', async () => {
		const findMany = vi.fn(async () => [
			{
				userId: '44444444-4444-4444-8444-444444444444',
				characterId: '2112625428',
				characterName: 'FC Example',
				is_primary: true,
			},
		])
		const db = { query: { userCharacters: { findMany } } }
		const service = new TimerboardService(db as never)

		await expect(service.searchAssignmentCandidates(viewer, 'FC Example')).rejects.toBeInstanceOf(
			TimerboardForbiddenError
		)
		const first = await service.searchAssignmentCandidates(manager, 'FC Example')
		const second = await service.searchAssignmentCandidates(manager, 'FC Example')

		expect(first).toEqual([
			{
				userId: '44444444-4444-4444-8444-444444444444',
				characterId: '2112625428',
				characterName: 'FC Example',
				isPrimary: true,
			},
		])
		expect(second).toEqual(first)
		expect(findMany).toHaveBeenCalledTimes(1)
	})

	it('serves identical list reads from one SQL query', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-08-30T20:00:00.000Z'))
		let sqlQueries = 0
		const row = makeEntryRow({ id: '55555555-5555-4555-8555-555555555555' })
		const db = {
			query: {
				timerboardEntries: {
					findMany: async () => {
						sqlQueries += 1
						return [row]
					},
				},
			},
			select: () => {
				sqlQueries += 1
				return {
					from: () => ({
						where: () => {
							const currentCountQuery = Promise.resolve([{ count: 1 }])
							return Object.assign(currentCountQuery, {
								orderBy: () => ({
									limit: () => ({
										offset: async () => [{ ...row, timerboardTotal: 1 }],
									}),
								}),
							})
						},
					}),
				}
			},
		}
		const service = new TimerboardService(db as never)

		const first = await service.list(viewer, { page: 1, pageSize: 25 })
		const second = await service.list(viewer, { page: 1, pageSize: 25 })

		expect(first.total).toBe(1)
		expect(second.items[0]?.id).toBe(row.id)
		expect(sqlQueries).toBe(1)

		vi.advanceTimersByTime(30_001)
		await service.list(viewer, { page: 1, pageSize: 25 })
		expect(sqlQueries).toBe(2)
	})

	it('deduplicates concurrent detail and activity reads into one SQL query', async () => {
		let sqlQueries = 0
		const row = makeEntryRow({ id: '66666666-6666-4666-8666-666666666666' })
		const activity = {
			id: '77777777-7777-4777-8777-777777777777',
			entryId: row.id,
			actorUserId: editor.userId,
			action: 'created',
			payload: { created: true },
			createdAt: new Date('2026-08-30T19:00:00.000Z'),
			actor: { characters: [{ characterName: 'FC Example' }] },
		}
		const db = {
			query: {
				timerboardEntries: {
					findFirst: async () => {
						sqlQueries += 1
						await Promise.resolve()
						return { ...row, activity: [activity] }
					},
				},
				timerboardActivity: {
					findMany: async () => {
						sqlQueries += 1
						return [activity]
					},
				},
			},
		}
		const service = new TimerboardService(db as never)

		const [entry, activities] = await Promise.all([
			service.get(viewer, row.id),
			service.listActivity(viewer, row.id),
		])

		expect(entry.id).toBe(row.id)
		expect(activities).toEqual([expect.objectContaining({ actorCharacterName: 'FC Example' })])
		expect(sqlQueries).toBe(1)
	})
})
