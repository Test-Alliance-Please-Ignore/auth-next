import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { schema } from '../../db/schema'
import { TimerboardForbiddenError, TimerboardService } from '../../services/timerboard.service'

import type { CreateTimerboardEntryInput, TimerboardActor } from '../../services/timerboard.service'

const hasDatabase = Boolean(process.env.TEST_DATABASE_URL)
const suite = hasDatabase ? describe : describe.skip

const editor: TimerboardActor = {
	userId: '11111111-1111-4111-8111-111111111111',
	isAdmin: false,
	permissionUrns: ['urn:timerboard:edit'],
}
const otherEditor: TimerboardActor = {
	userId: '22222222-2222-4222-8222-222222222222',
	isAdmin: false,
	permissionUrns: ['urn:timerboard:edit'],
}
const manager: TimerboardActor = {
	userId: '33333333-3333-4333-8333-333333333333',
	isAdmin: false,
	permissionUrns: ['urn:timerboard:manage'],
}
const viewer: TimerboardActor = {
	userId: '44444444-4444-4444-8444-444444444444',
	isAdmin: false,
	permissionUrns: ['urn:timerboard:view'],
}

function timerInput(
	overrides: Partial<CreateTimerboardEntryInput> = {}
): CreateTimerboardEntryInput {
	return {
		kind: 'fleet',
		title: 'Armor formup',
		priority: 'normal',
		side: 'friendly',
		startsAt: '2026-09-01T20:00:00.000Z',
		endsAt: null,
		systemId: '30004759',
		systemName: '1DQ1-A',
		entityId: null,
		entityType: null,
		entityName: null,
		notes: null,
		...overrides,
	}
}

let pool: Pool
let service: TimerboardService

beforeAll(() => {
	if (!hasDatabase) return
	pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
	const db = drizzle(pool, { schema: schema as never })
	service = new TimerboardService(db as never)
})

afterAll(async () => {
	await pool?.end()
})

beforeEach(async () => {
	if (!hasDatabase) return
	await pool.query('truncate timerboard_activity, timerboard_entries, users cascade')
	await pool.query(
		`insert into users (id, main_character_id) values
			($1, $2), ($3, $4), ($5, $6), ($7, $8)`,
		[
			editor.userId,
			'1001',
			otherEditor.userId,
			'1002',
			manager.userId,
			'1003',
			viewer.userId,
			'1004',
		]
	)
})

suite('TimerboardService with PostgreSQL', () => {
	it('commits a timer and exactly one serialised creation activity', async () => {
		const created = await service.create(editor, timerInput())
		const fetched = await service.get(viewer, created.id)
		const activity = await service.listActivity(viewer, created.id)

		expect(fetched).toMatchObject({
			title: 'Armor formup',
			startsAt: '2026-09-01T20:00:00.000Z',
			endsAt: null,
			version: 1,
		})
		expect(fetched.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
		expect(activity).toEqual([
			expect.objectContaining({
				action: 'created',
				actorUserId: editor.userId,
				payload: { created: true },
			}),
		])
		expect(activity[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
	})

	it('enforces editor ownership while allowing a manager update with one audit record', async () => {
		const created = await service.create(otherEditor, timerInput())

		await expect(
			service.update(editor, created.id, { title: 'Unauthorized edit' }, 1)
		).rejects.toBeInstanceOf(TimerboardForbiddenError)

		const updated = await service.update(manager, created.id, { title: 'Manager edit' }, 1)
		const activity = await service.listActivity(viewer, created.id)

		expect(updated).toMatchObject({ title: 'Manager edit', version: 2 })
		expect(activity.map((item) => item.action)).toEqual(['created', 'updated'])
		expect(activity[1]?.payload).toEqual({
			changes: { title: { previous: 'Armor formup', next: 'Manager edit' } },
		})
	})

	it('applies inclusive time boundaries, filters, priority ordering, and pagination', async () => {
		await service.create(
			editor,
			timerInput({ title: 'Low boundary', priority: 'low', startsAt: '2026-09-01T20:00:00.000Z' })
		)
		await service.create(
			editor,
			timerInput({
				title: 'Critical boundary',
				priority: 'critical',
				startsAt: '2026-09-01T23:00:00.000Z',
			})
		)
		await service.create(
			editor,
			timerInput({
				title: 'Different system',
				priority: 'high',
				systemName: 'Jita',
				startsAt: '2026-09-01T21:00:00.000Z',
			})
		)

		const firstPage = await service.list(viewer, {
			states: ['planned'],
			kind: 'fleet',
			system: '1dq',
			from: '2026-09-01T20:00:00.000Z',
			to: '2026-09-01T23:00:00.000Z',
			page: 1,
			pageSize: 1,
		})
		const secondPage = await service.list(viewer, {
			states: ['planned'],
			kind: 'fleet',
			system: '1dq',
			from: '2026-09-01T20:00:00.000Z',
			to: '2026-09-01T23:00:00.000Z',
			page: 2,
			pageSize: 1,
		})

		expect(firstPage).toMatchObject({ total: 2, page: 1, pageSize: 1 })
		expect(firstPage.items.map((item) => item.title)).toEqual(['Critical boundary'])
		expect(secondPage.items.map((item) => item.title)).toEqual(['Low boundary'])
	})

	it('allows an owner to cover and complete a timer without reopening its terminal state', async () => {
		const created = await service.create(editor, timerInput())
		const covered = await service.setState(editor, created.id, 'covered', 1)
		const completed = await service.setState(editor, created.id, 'completed', 2)

		expect(covered).toMatchObject({ state: 'covered', version: 2 })
		expect(completed).toMatchObject({ state: 'completed', version: 3 })
		await expect(service.setState(manager, created.id, 'planned', 3)).rejects.toMatchObject({
			fields: { state: 'Cannot transition a completed timer to planned' },
		})
		expect((await service.listActivity(viewer, created.id)).map((item) => item.action)).toEqual([
			'created',
			'state_changed',
			'state_changed',
		])
	})
})
