import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import timerboardRoutes from '../timerboard'

import type { SessionUser } from '../../context'

const { getPermissionsMock } = vi.hoisted(() => ({ getPermissionsMock: vi.fn() }))

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: getPermissionsMock,
}))

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: '11111111-1111-4111-8111-111111111111',
		mainCharacterId: '2112625428',
		sessionId: 'session-1',
		characters: [],
		is_admin: false,
		roles: [],
		discordUserId: null,
		...overrides,
	}
}

function createApp(user?: SessionUser, db: unknown = {}) {
	const app = new Hono<{
		Bindings: Record<string, unknown>
		Variables: { user?: SessionUser; db?: unknown }
	}>()
	if (user) {
		app.use('*', async (c, next) => {
			c.set('user', user)
			c.set('db', db)
			await next()
		})
	}
	app.route('/api/timerboard', timerboardRoutes)
	return app
}

describe('timerboard routes', () => {
	it('returns 401 when the board is requested without a session', async () => {
		const response = await createApp().request('/api/timerboard')

		expect(response.status).toBe(401)
		expect(await response.json()).toEqual({ error: 'Unauthorized' })
	})

	it('returns 403 when an authenticated user has no timerboard permission', async () => {
		getPermissionsMock.mockResolvedValue([])

		const response = await createApp(makeUser()).request('/api/timerboard', {}, { GROUPS: {} })

		expect(response.status).toBe(403)
		expect(await response.json()).toEqual({ error: 'Forbidden' })
	})

	it('returns typed validation details for an invalid create window', async () => {
		getPermissionsMock.mockResolvedValue([{ urn: 'urn:timerboard:edit' }])

		const response = await createApp(makeUser()).request(
			'/api/timerboard',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					kind: 'fleet',
					title: 'Armor formup',
					priority: 'high',
					side: 'friendly',
					startsAt: '2026-09-01T20:00:00.000Z',
					endsAt: '2026-09-01T20:00:00.000Z',
					systemId: null,
					systemName: '1DQ1-A',
					entityId: null,
					entityType: null,
					entityName: null,
					notes: null,
				}),
			},
			{ GROUPS: {} }
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({
			error: 'Invalid timerboard entry',
			fields: { endsAt: 'End time must be later than start time' },
		})
	})

	it('returns linked character assignment candidates to managers', async () => {
		getPermissionsMock.mockResolvedValue([{ urn: 'urn:timerboard:manage' }])
		const findMany = vi.fn(async () => [
			{
				userId: '44444444-4444-4444-8444-444444444444',
				characterId: '2112625428',
				characterName: 'FC Example',
				is_primary: true,
			},
		])
		const db = { query: { userCharacters: { findMany } } }

		const response = await createApp(makeUser(), db).request(
			'/api/timerboard/assignment-candidates?search=FC%20Example',
			{},
			{ GROUPS: {} }
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([
			{
				userId: '44444444-4444-4444-8444-444444444444',
				characterId: '2112625428',
				characterName: 'FC Example',
				isPrimary: true,
			},
		])
		expect(findMany).toHaveBeenCalledTimes(1)
	})

	it('returns 404 when activity is requested for a timer that does not exist', async () => {
		getPermissionsMock.mockResolvedValue([{ urn: 'urn:timerboard:view' }])
		const db = {
			query: {
				timerboardEntries: { findFirst: async () => undefined },
				timerboardActivity: { findMany: async () => [] },
			},
		}

		const response = await createApp(makeUser(), db).request(
			'/api/timerboard/22222222-2222-4222-8222-222222222222/activity',
			{},
			{ GROUPS: {} }
		)

		expect(response.status).toBe(404)
		expect(await response.json()).toEqual({ error: 'Timerboard entry not found' })
	})

	it('returns 409 with the current serialised entry for a stale update', async () => {
		const user = makeUser()
		getPermissionsMock.mockResolvedValue([{ urn: 'urn:timerboard:edit' }])
		const current = {
			id: '22222222-2222-4222-8222-222222222222',
			kind: 'fleet',
			title: 'Current timer',
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
			createdByUserId: user.id,
			updatedByUserId: user.id,
			version: 2,
			createdAt: new Date('2026-08-30T19:00:00.000Z'),
			updatedAt: new Date('2026-08-30T19:05:00.000Z'),
		}
		const transaction = {
			query: { timerboardEntries: { findFirst: async () => current } },
		}
		const db = {
			transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
				callback(transaction),
		}

		const response = await createApp(user, db).request(
			'/api/timerboard/22222222-2222-4222-8222-222222222222',
			{
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title: 'Stale timer', expectedVersion: 1 }),
			},
			{ GROUPS: {} }
		)

		expect(response.status).toBe(409)
		expect(await response.json()).toMatchObject({
			error: 'Timerboard entry was modified by another user',
			current: {
				title: 'Current timer',
				version: 2,
				startsAt: '2026-09-01T20:00:00.000Z',
				updatedAt: '2026-08-30T19:05:00.000Z',
			},
		})
	})
})
