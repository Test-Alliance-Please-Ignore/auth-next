import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { formatMumbleError } from '@repo/mumble'

import mumbleRoutes from '../mumble'

import type { App, SessionUser } from '../../context'

const {
	getMumbleAccountMock,
	provisionMumbleAccountMock,
	resetMumblePasswordMock,
	getMumbleConnectionInfoMock,
	getStubMock,
	featuresStub,
} = vi.hoisted(() => ({
	getMumbleAccountMock: vi.fn(),
	provisionMumbleAccountMock: vi.fn(),
	resetMumblePasswordMock: vi.fn(),
	getMumbleConnectionInfoMock: vi.fn(() => ({ host: 'voice.test', port: 64738 })),
	getStubMock: vi.fn(),
	featuresStub: {
		checkFlag: vi.fn(),
	},
}))

vi.mock('../../services/mumble.service', () => ({
	getMumbleAccount: getMumbleAccountMock,
	provisionMumbleAccount: provisionMumbleAccountMock,
	resetMumblePassword: resetMumblePasswordMock,
	getMumbleConnectionInfo: getMumbleConnectionInfoMock,
}))

vi.mock('../../db', () => ({
	createDb: vi.fn(),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: getStubMock,
}))

// @neondatabase/api-client (pulled in via @repo/db-utils test helpers) breaks
// the workers-pool CJS shim; it is irrelevant to these tests.
vi.mock('@neondatabase/api-client', () => ({
	createApiClient: vi.fn(),
	EndpointType: {},
}))

const env = {
	FEATURES: { name: 'FEATURES' },
} as any

function makeUser(): SessionUser {
	return {
		id: '00000000-0000-0000-0000-000000000001',
		mainCharacterId: '7001',
		sessionId: 'session-1',
		characters: [],
		is_admin: false,
		roles: [ROLE_CORE_ALLIANCE_MEMBER],
		discordUserId: null,
	}
}

/**
 * The provision/reset routes are gated on services eligibility, which reads the
 * db directly. Default the fixture to ELIGIBLE so the existing tests keep testing
 * what they were written to test (mumble error mapping), and let the gate's own
 * behaviour be pinned explicitly below.
 */
function makeDb(options: { eligible: boolean } = { eligible: true }) {
	return {
		query: {
			users: { findFirst: vi.fn().mockResolvedValue({ is_admin: false }) },
			userCharacters: {
				findMany: vi
					.fn()
					.mockResolvedValue(options.eligible ? [{ corporationId: 'corp-1' }] : []),
			},
			managedCorporations: { findMany: vi.fn().mockResolvedValue([{ corporationId: 'corp-1' }]) },
		},
	}
}

function makeApp(user?: SessionUser, db: unknown = makeDb()) {
	const app = new Hono<App>()
	app.use('*', async (c, next) => {
		if (user) c.set('user', user)
		c.set('db', db as never)
		await next()
	})
	return app.route('/api/mumble', mumbleRoutes)
}

beforeEach(() => {
	vi.clearAllMocks()
	getMumbleConnectionInfoMock.mockReturnValue({ host: 'voice.test', port: 64738 })
	getStubMock.mockImplementation((namespace: any) => {
		if (namespace === env.FEATURES) return featuresStub as any
		throw new Error('Unexpected namespace')
	})
	featuresStub.checkFlag.mockResolvedValue(true)
})

describe('GET /api/mumble/account', () => {
	it('returns 404 when the mumble feature flag is disabled', async () => {
		featuresStub.checkFlag.mockResolvedValue(false)

		const res = await makeApp(makeUser()).request('/api/mumble/account', {}, env)

		expect(res.status).toBe(404)
	})

	it('returns 401 when unauthenticated', async () => {
		const res = await makeApp().request('/api/mumble/account', {}, env)
		expect(res.status).toBe(401)
	})

	it('returns 403 when authenticated but not an alliance member', async () => {
		const res = await makeApp({ ...makeUser(), roles: [] }).request('/api/mumble/account', {}, env)
		expect(res.status).toBe(403)
	})

	it('returns account and connection info', async () => {
		getMumbleAccountMock.mockResolvedValue({ subjectId: 'u1', loginName: 'pilot' })

		const res = await makeApp(makeUser()).request('/api/mumble/account', {}, env)

		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.account.loginName).toBe('pilot')
		expect(body.connection).toEqual({ host: 'voice.test', port: 64738 })
	})

	it('falls back to an empty state when the Mumble RPC transport is unavailable', async () => {
		getMumbleAccountMock.mockRejectedValue(new Error('Network connection lost.'))

		const res = await makeApp(makeUser()).request('/api/mumble/account', {}, env)

		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.account).toBeNull()
		expect(body.connection).toEqual({ host: 'voice.test', port: 64738 })
	})
})

describe('POST /api/mumble/account', () => {
	it('returns 401 when unauthenticated', async () => {
		const res = await makeApp().request('/api/mumble/account', { method: 'POST' }, env)
		expect(res.status).toBe(401)
	})

	it('returns 403 when authenticated but not an alliance member', async () => {
		const res = await makeApp({ ...makeUser(), roles: [] }).request(
			'/api/mumble/account',
			{ method: 'POST' },
			env
		)
		expect(res.status).toBe(403)
	})

	it('returns the one-time password on provision', async () => {
		provisionMumbleAccountMock.mockResolvedValue({
			account: { subjectId: 'u1', loginName: 'pilot' },
			password: 'secret-password',
		})

		const res = await makeApp(makeUser()).request('/api/mumble/account', { method: 'POST' }, env)

		expect(res.status).toBe(201)
		const body = (await res.json()) as any
		expect(body.password).toBe('secret-password')
	})

	it('maps already_exists to 409', async () => {
		provisionMumbleAccountMock.mockRejectedValue(
			new Error(formatMumbleError('already_exists', 'exists'))
		)

		const res = await makeApp(makeUser()).request('/api/mumble/account', { method: 'POST' }, env)
		expect(res.status).toBe(409)
	})

	it('maps busy to 429 with Retry-After', async () => {
		provisionMumbleAccountMock.mockRejectedValue(new Error(formatMumbleError('busy', 'busy')))

		const res = await makeApp(makeUser()).request('/api/mumble/account', { method: 'POST' }, env)
		expect(res.status).toBe(429)
		expect(res.headers.get('Retry-After')).toBe('5')
	})

	it('maps unavailable to 502', async () => {
		provisionMumbleAccountMock.mockRejectedValue(
			new Error(formatMumbleError('unavailable', 'down'))
		)

		const res = await makeApp(makeUser()).request('/api/mumble/account', { method: 'POST' }, env)
		expect(res.status).toBe(502)
	})
})

describe('POST /api/mumble/account/reset-password', () => {
	it('returns 403 when authenticated but not an alliance member', async () => {
		const res = await makeApp({ ...makeUser(), roles: [] }).request(
			'/api/mumble/account/reset-password',
			{ method: 'POST' },
			env
		)
		expect(res.status).toBe(403)
	})

	it('maps not_found to 404', async () => {
		resetMumblePasswordMock.mockRejectedValue(
			new Error(formatMumbleError('not_found', 'no account'))
		)

		const res = await makeApp(makeUser()).request(
			'/api/mumble/account/reset-password',
			{ method: 'POST' },
			env
		)
		expect(res.status).toBe(404)
	})

	it('returns the new one-time password', async () => {
		resetMumblePasswordMock.mockResolvedValue({ password: 'new-password' })

		const res = await makeApp(makeUser()).request(
			'/api/mumble/account/reset-password',
			{ method: 'POST' },
			env
		)
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.password).toBe('new-password')
	})
})

/**
 * THE SELF-HEAL GATE.
 *
 * Deleting someone's Mumble account is pointless if they can re-create it in one
 * click, and provisioning had no eligibility check at all — the router's
 * requireAllianceMember() only checks ROLE_CORE_ALLIANCE_MEMBER, which is granted
 * for ANY character in ANY alliance and is not the member-corp rule.
 */
describe('services eligibility gate on the grant paths', () => {
	it('403s provisioning for a user with no character in a member corporation', async () => {
		const res = await makeApp(makeUser(), makeDb({ eligible: false })).request(
			'/api/mumble/account',
			{ method: 'POST' },
			env
		)

		expect(res.status).toBe(403)
		expect((await res.json()) as any).toMatchObject({ code: 'not_member_corp' })
		// The load-bearing part: the account must not be created anyway.
		expect(provisionMumbleAccountMock).not.toHaveBeenCalled()
	})

	it('403s password reset for an ineligible user, and issues no credentials', async () => {
		const res = await makeApp(makeUser(), makeDb({ eligible: false })).request(
			'/api/mumble/account/reset-password',
			{ method: 'POST' },
			env
		)

		expect(res.status).toBe(403)
		expect(resetMumblePasswordMock).not.toHaveBeenCalled()
	})

	it('still lets an ineligible user READ their own account', async () => {
		// Reads are deliberately not gated: someone must be able to see the state of
		// their own account, and the page needs `eligible` to decide what to offer.
		getMumbleAccountMock.mockResolvedValue({ loginName: 'Pilot', enabled: true, groups: [] })

		const res = await makeApp(makeUser(), makeDb({ eligible: false })).request(
			'/api/mumble/account',
			{},
			env
		)

		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.account).not.toBeNull()
		expect(body.eligible).toBe(false)
	})

	it('reports eligible: true for a user with a member-corp character', async () => {
		getMumbleAccountMock.mockResolvedValue(null)

		const res = await makeApp(makeUser(), makeDb({ eligible: true })).request(
			'/api/mumble/account',
			{},
			env
		)

		expect(((await res.json()) as any).eligible).toBe(true)
	})
})
