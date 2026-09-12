import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import timerboardRoutes from '../timerboard'

import type { TimerboardWorker } from '@repo/core'
import type { SessionUser } from '../../context'

const permissions = vi.hoisted(() => vi.fn())
vi.mock('../../lib/groups-cache', () => ({ getCachedUserPermissions: permissions }))

const user: SessionUser = {
	id: '11111111-1111-4111-8111-111111111111',
	mainCharacterId: '2112625428',
	sessionId: 'session-1',
	characters: [],
	is_admin: false,
	roles: [],
	discordUserId: null,
}

function makeApp() {
	const app = new Hono<{
		Bindings: { TIMERBOARD: TimerboardWorker }
		Variables: { user?: SessionUser }
	}>()
	app.use('*', async (c, next) => {
		c.set('user', user)
		await next()
	})
	app.route('/api/timerboard', timerboardRoutes)
	return app
}

describe('timerboard core adapter', () => {
	it('requires the authenticated session', async () => {
		const app = new Hono()
		app.route('/api/timerboard', timerboardRoutes)
		expect((await app.request('/api/timerboard')).status).toBe(401)
	})

	it('passes the authenticated actor and query to the worker', async () => {
		permissions.mockResolvedValue([{ urn: 'urn:timerboard:view' }])
		const list = vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 25, total: 0 })
		const app = makeApp()
		const response = await app.request(
			'/api/timerboard?assignedToMe=true',
			{},
			{ TIMERBOARD: { list } as unknown as TimerboardWorker }
		)
		expect(response.status).toBe(200)
		expect(list).toHaveBeenCalledWith(
			expect.objectContaining({ userId: user.id }),
			expect.objectContaining({ assignedToMe: true })
		)
	})
})
