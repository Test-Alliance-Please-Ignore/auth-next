import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import discordRoutes from '../discord'

import type { App, SessionUser } from '../../context'

/**
 * POST /api/discord/join-servers IS THE SELF-HEAL HOLE.
 *
 * It calls syncUserDiscordAccess, which invites the user to guilds and re-grants
 * roles — auto-apply roles are added with no eligibility check at all. Behind
 * nothing but requireAuth(), it let any revoked user grant their own access back
 * on demand, which made revoking it pointless.
 *
 * The middleware's own tests pin that the rule is right. THIS test pins that the
 * gate is actually MOUNTED here, and — the part that matters — that a rejected
 * request never reaches syncUserDiscordAccess at all.
 */

const { syncUserDiscordAccessMock } = vi.hoisted(() => ({
	syncUserDiscordAccessMock: vi.fn(),
}))

vi.mock('../../services/discord.service', () => ({
	syncUserDiscordAccess: syncUserDiscordAccessMock,
}))
vi.mock('../../lib/discord-helpers', () => ({ getDiscordStatus: vi.fn() }))
vi.mock('../../middleware/session', () => ({
	requireAuth: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))

function makeUser(over: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: 'm',
		sessionId: 's',
		characters: [],
		is_admin: false,
		roles: [],
		discordUserId: 'd1',
		sessionCreatedAt: new Date().toISOString(),
		...over,
	} as SessionUser
}

function makeDb(options: { memberCorpCharacter: boolean; isAdmin?: boolean }) {
	return {
		query: {
			users: { findFirst: vi.fn().mockResolvedValue({ is_admin: options.isAdmin ?? false }) },
			userCharacters: {
				findMany: vi
					.fn()
					.mockResolvedValue(options.memberCorpCharacter ? [{ corporationId: 'corp-1' }] : []),
			},
			managedCorporations: { findMany: vi.fn().mockResolvedValue([{ corporationId: 'corp-1' }]) },
		},
	}
}

function buildApp(db: unknown) {
	const app = new Hono<App>()
	app.use('*', async (c, next) => {
		c.set('user', makeUser())
		c.set('db', db as never)
		await next()
	})
	app.route('/', discordRoutes)
	return app
}

beforeEach(() => vi.clearAllMocks())

describe('POST /join-servers eligibility gate', () => {
	it('403s an ineligible user and NEVER reaches syncUserDiscordAccess', async () => {
		const app = buildApp(makeDb({ memberCorpCharacter: false }))
		const res = await app.request('/join-servers', { method: 'POST' })

		expect(res.status).toBe(403)
		expect(await res.json()).toMatchObject({ code: 'not_member_corp' })
		// The load-bearing assertion. If the gate ran but the handler still called
		// through, the user would be invited and re-granted anyway and the 403 would
		// be a lie.
		expect(syncUserDiscordAccessMock).not.toHaveBeenCalled()
	})

	it('lets an eligible user through to syncUserDiscordAccess', async () => {
		syncUserDiscordAccessMock.mockResolvedValue({ results: [] })
		const app = buildApp(makeDb({ memberCorpCharacter: true }))
		const res = await app.request('/join-servers', { method: 'POST' })

		expect(res.status).toBe(200)
		// Second arg is the user id; the first is c.env, which is undefined in this
		// harness and not what this test is about.
		expect(syncUserDiscordAccessMock).toHaveBeenCalledTimes(1)
		expect(syncUserDiscordAccessMock.mock.calls[0][1]).toBe('user-1')
	})

	it('lets a site admin through even with no member corporation', async () => {
		syncUserDiscordAccessMock.mockResolvedValue({ results: [] })
		const app = buildApp(makeDb({ memberCorpCharacter: false, isAdmin: true }))
		const res = await app.request('/join-servers', { method: 'POST' })

		expect(res.status).toBe(200)
		expect(syncUserDiscordAccessMock).toHaveBeenCalled()
	})
})
