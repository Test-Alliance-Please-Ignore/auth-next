import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { mergeUserPreferences } from '../../services/user.service'
import usersRoutes, { parseUserPreferencesUpdate } from '../users'

function createApp(db: unknown) {
	const app = new Hono<{
		Bindings: Record<string, unknown>
		Variables: Record<string, unknown>
	}>()

	app.use('*', async (c, next) => {
		c.set('user', {
			id: 'user-1',
			mainCharacterId: 'character-1',
			sessionId: 'session-1',
			characters: [],
			is_admin: false,
			roles: [],
			discordUserId: null,
		})
		c.set('db', db)
		await next()
	})

	app.route('/api/users', usersRoutes)
	return app
}

function jsonRequest(body: string): RequestInit {
	return {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body,
	}
}

describe('/users/me/preferences', () => {
	it('accepts supported locales in direct and compatible wrapped request shapes', () => {
		expect(parseUserPreferencesUpdate({ locale: 'de' })).toMatchObject({
			success: true,
			data: { locale: 'de' },
		})
		expect(
			parseUserPreferencesUpdate({ preferences: { locale: 'ko', future: 'kept' } })
		).toMatchObject({
			success: true,
			data: { locale: 'ko', future: 'kept' },
		})
	})

	it('rejects unsupported locales and merges partial locale updates without erasing fields', () => {
		expect(parseUserPreferencesUpdate({ locale: 'fr' })).toMatchObject({ success: false })
		expect(
			mergeUserPreferences(
				{ theme: 'dark', notifications: { email: true }, future: { enabled: true } },
				{ locale: 'de' }
			)
		).toEqual({
			theme: 'dark',
			notifications: { email: true },
			future: { enabled: true },
			locale: 'de',
		})
	})

	it.each([
		['malformed JSON', '{'],
		['an unsupported locale', JSON.stringify({ locale: 'fr' })],
		['a non-object preferences wrapper', JSON.stringify({ preferences: 'de' })],
	])('returns 400 for %s through the HTTP route', async (_description, body) => {
		const response = await createApp({}).request('/api/users/me/preferences', jsonRequest(body))

		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({ error: 'Invalid preferences' })
	})

	it('preserves stored and forward-compatible fields through the route and service', async () => {
		const updateWhere = vi.fn().mockResolvedValue(undefined)
		const updateSet = vi.fn(() => ({ where: updateWhere }))
		const activityValues = vi.fn().mockResolvedValue(undefined)
		const db = {
			query: {
				userPreferences: {
					findFirst: vi.fn().mockResolvedValue({
						preferences: {
							theme: 'dark',
							notifications: { email: true },
							serverFutureSetting: { enabled: true },
						},
					}),
				},
			},
			update: vi.fn(() => ({ set: updateSet })),
			insert: vi.fn(() => ({ values: activityValues })),
		}

		const response = await createApp(db).request(
			'/api/users/me/preferences',
			jsonRequest(
				JSON.stringify({
					preferences: { locale: 'ko', clientFutureSetting: 'kept' },
				})
			)
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			preferences: {
				theme: 'dark',
				notifications: { email: true },
				serverFutureSetting: { enabled: true },
				locale: 'ko',
				clientFutureSetting: 'kept',
			},
		})
		expect(updateSet).toHaveBeenCalledWith({
			preferences: {
				theme: 'dark',
				notifications: { email: true },
				serverFutureSetting: { enabled: true },
				locale: 'ko',
				clientFutureSetting: 'kept',
			},
			updatedAt: expect.any(Date),
		})
		expect(updateWhere).toHaveBeenCalledOnce()
		expect(activityValues).toHaveBeenCalledOnce()
	})
})
