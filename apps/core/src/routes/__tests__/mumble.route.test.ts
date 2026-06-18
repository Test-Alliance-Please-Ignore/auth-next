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
} = vi.hoisted(() => ({
	getMumbleAccountMock: vi.fn(),
	provisionMumbleAccountMock: vi.fn(),
	resetMumblePasswordMock: vi.fn(),
	getMumbleConnectionInfoMock: vi.fn(() => ({ host: 'voice.test', port: 64738 })),
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

// @neondatabase/api-client (pulled in via @repo/db-utils test helpers) breaks
// the workers-pool CJS shim; it is irrelevant to these tests.
vi.mock('@neondatabase/api-client', () => ({
	createApiClient: vi.fn(),
	EndpointType: {},
}))

const env = {} as any

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

function makeApp(user?: SessionUser) {
	const app = new Hono<App>()
	if (user) {
		app.use('*', async (c, next) => {
			c.set('user', user)
			await next()
		})
	}
	return app.route('/api/mumble', mumbleRoutes)
}

beforeEach(() => {
	vi.clearAllMocks()
	getMumbleConnectionInfoMock.mockReturnValue({ host: 'voice.test', port: 64738 })
})

describe('GET /api/mumble/account', () => {
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
