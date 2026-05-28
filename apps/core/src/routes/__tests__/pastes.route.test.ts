import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import pastesRoutes, { publicPasteRoutes } from '../pastes'

vi.mock('../../middleware/session', () => ({
	requireAdmin: () => async (_c: any, next: () => Promise<void>) => {
		await next()
	},
	requireAllianceMember: () => async (_c: any, next: () => Promise<void>) => {
		await next()
	},
}))

describe('pastes routes', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns generic 404 for public paste fetch when paste is missing or not visible', async () => {
		const app = new Hono<{ Bindings: any }>()
		app.route('/api/public/paste', publicPasteRoutes)

		const env = {
			PASTE: {
				getPasteForPublicViewer: vi.fn().mockResolvedValue(null),
			},
		}

		const res = await app.request('/api/public/paste/does-not-exist', { method: 'GET' }, env as any)
		expect(res.status).toBe(404)
		expect(await res.json()).toEqual({ error: 'Invalid password or unavailable paste' })
	})

	it('returns 400 for malformed decrypt JSON payload', async () => {
		const app = new Hono<{ Bindings: any }>()
		app.route('/api/public/paste', publicPasteRoutes)

		const env = {
			PASTE: {
				canAttemptPublicDecrypt: vi.fn().mockResolvedValue(true),
				decryptPaste: vi.fn(),
			},
		}

		const res = await app.request(
			'/api/public/paste/abc123/decrypt',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{not-json',
			},
			env as any
		)

		expect(res.status).toBe(400)
		expect(await res.json()).toEqual({ error: 'Invalid request body' })
	})

	it('passes explicit admin flag for admin delete route', async () => {
		const app = new Hono<{ Bindings: any; Variables: { user?: { id: string } } }>()
		app.use('*', async (c, next) => {
			c.set('user', { id: 'admin-user-1' })
			await next()
		})
		app.route('/api/pastes', pastesRoutes)

		const deletePaste = vi.fn().mockResolvedValue(true)
		const env = {
			PASTE: {
				deletePaste,
			},
		}

		const res = await app.request('/api/pastes/admin/paste-1', { method: 'DELETE' }, env as any)
		expect(res.status).toBe(200)
		expect(deletePaste).toHaveBeenCalledWith({
			pasteId: 'paste-1',
			actorUserId: 'admin-user-1',
			isAdmin: true,
		})
	})
})
