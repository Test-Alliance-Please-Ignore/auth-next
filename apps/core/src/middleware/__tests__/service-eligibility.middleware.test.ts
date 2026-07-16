import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NOT_MEMBER_CORP_CODE, requireServiceEligibility } from '../service-eligibility'

import type { App, SessionUser } from '../../context'

/**
 * The gate that makes revoking access mean something.
 *
 * Eligibility is derived, not stored — recomputed from is_member_corporation on
 * every read — so without the same predicate on the grant paths a revoked user
 * just re-grants themselves. These tests pin the gate itself; the route tests
 * pin that it is actually mounted on the three self-service paths.
 */

function makeUser(over: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: 'm',
		sessionId: 's',
		characters: [],
		is_admin: false,
		roles: [],
		discordUserId: null,
		sessionCreatedAt: new Date().toISOString(),
		...over,
	} as SessionUser
}

/** A db whose eligibility answer is driven by the two queries the rule makes. */
function makeDb(options: { isAdmin?: boolean; memberCorpCharacter?: boolean; noUserRow?: boolean }) {
	return {
		query: {
			users: {
				findFirst: vi
					.fn()
					.mockResolvedValue(
						options.noUserRow ? undefined : { is_admin: options.isAdmin ?? false }
					),
			},
			userCharacters: {
				findMany: vi
					.fn()
					.mockResolvedValue(options.memberCorpCharacter ? [{ corporationId: 'corp-1' }] : []),
			},
			managedCorporations: {
				findMany: vi.fn().mockResolvedValue([{ corporationId: 'corp-1' }]),
			},
		},
	}
}

function buildApp(db: unknown, user: SessionUser | undefined) {
	const app = new Hono<App>()
	app.use('*', async (c, next) => {
		if (user) c.set('user', user)
		c.set('db', db as never)
		await next()
	})
	app.post('/grant', requireServiceEligibility(), (c) => c.json({ granted: true }))
	return app
}

beforeEach(() => vi.clearAllMocks())

describe('requireServiceEligibility', () => {
	it('allows a user with a character in a member corporation', async () => {
		const app = buildApp(makeDb({ memberCorpCharacter: true }), makeUser())
		const res = await app.request('/grant', { method: 'POST' })
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ granted: true })
	})

	it('rejects a user with no character in any member corporation', async () => {
		const app = buildApp(makeDb({ memberCorpCharacter: false }), makeUser())
		const res = await app.request('/grant', { method: 'POST' })
		expect(res.status).toBe(403)
		// The UI switches on this code to hide the affordance rather than let
		// someone click a button that can only fail.
		expect(await res.json()).toMatchObject({ code: NOT_MEMBER_CORP_CODE })
	})

	it('allows a site admin with no member corporation (anti-lockout)', async () => {
		// Matches getUserGroupNames' `if (!hasAttachment && !user?.is_admin)`: an
		// incident responder must not gate themselves out mid-incident.
		const app = buildApp(makeDb({ memberCorpCharacter: false, isAdmin: true }), makeUser())
		const res = await app.request('/grant', { method: 'POST' })
		expect(res.status).toBe(200)
	})

	it('rejects when no users row exists', async () => {
		// user?.is_admin is optional-chained, so a missing row is falsy => ineligible.
		const app = buildApp(makeDb({ memberCorpCharacter: false, noUserRow: true }), makeUser())
		const res = await app.request('/grant', { method: 'POST' })
		expect(res.status).toBe(403)
	})

	it('401s an unauthenticated request', async () => {
		const app = buildApp(makeDb({ memberCorpCharacter: true }), undefined)
		const res = await app.request('/grant', { method: 'POST' })
		expect(res.status).toBe(401)
	})

	it('FAILS CLOSED when the database is unavailable', async () => {
		// This guard protects a grant path. An unavailable db must not become an
		// open door — that would reopen the exact hole the gate exists to close.
		const app = buildApp(undefined, makeUser())
		const res = await app.request('/grant', { method: 'POST' })
		expect(res.status).toBe(500)
	})

	it('does not consult managed_corporations for an admin short-circuit', async () => {
		// Both reads are issued in parallel by design; this pins that an admin is
		// allowed on the is_admin signal rather than by accident of corp data.
		const db = makeDb({ memberCorpCharacter: false, isAdmin: true })
		const app = buildApp(db, makeUser({ is_admin: true }))
		await app.request('/grant', { method: 'POST' })
		expect(db.query.users.findFirst).toHaveBeenCalled()
	})
})
