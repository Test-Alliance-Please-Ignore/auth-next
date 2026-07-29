import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'

import adminRoutes from '../admin'

import type { SessionUser } from '../../context'

const {
	getMumbleAccountMock,
	deleteMumbleAccountsMock,
	syncUsersMumbleGroupsMock,
	getMumbleConnectionInfoMock,
	syncUsersMumbleProfilesMock,
	enforceBlacklistedMumbleAccessMock,
} = vi.hoisted(() => ({
	getMumbleAccountMock: vi.fn(),
	deleteMumbleAccountsMock: vi.fn(),
	syncUsersMumbleGroupsMock: vi.fn(),
	getMumbleConnectionInfoMock: vi.fn(() => ({ host: 'voice.test', port: 64738 })),
	syncUsersMumbleProfilesMock: vi.fn(),
	enforceBlacklistedMumbleAccessMock: vi.fn(),
}))

vi.mock('../../services/mumble.service', () => ({
	getMumbleAccount: getMumbleAccountMock,
	deleteMumbleAccounts: deleteMumbleAccountsMock,
	syncUsersMumbleGroups: syncUsersMumbleGroupsMock,
	getMumbleConnectionInfo: getMumbleConnectionInfoMock,
	syncUsersMumbleProfiles: syncUsersMumbleProfilesMock,
	enforceBlacklistedMumbleAccess: enforceBlacklistedMumbleAccessMock,
}))

vi.mock('../../db', () => ({
	createDb: vi.fn(),
}))

const env = {
	MUMBLE_HOST: 'voice.test',
	MUMBLE_PORT: '64738',
} as any

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: '00000000-0000-0000-0000-000000000001',
		mainCharacterId: '7001',
		sessionId: 'session-1',
		characters: [],
		is_admin: true,
		roles: [ROLE_CORE_ALLIANCE_MEMBER],
		discordUserId: null,
		...overrides,
	}
}

function createApp(user?: SessionUser) {
	const app = new Hono<{
		Bindings: any
		Variables: { user?: SessionUser }
	}>()

	if (user) {
		app.use('*', async (c, next) => {
			c.set('user', user)
			await next()
		})
	}

	app.route('/api/admin', adminRoutes)
	return app
}

beforeEach(() => {
	vi.clearAllMocks()
	getMumbleConnectionInfoMock.mockReturnValue({ host: 'voice.test', port: 64738 })
	getMumbleAccountMock.mockResolvedValue(null)
	deleteMumbleAccountsMock.mockResolvedValue({ deleted: [], notFound: [], queued: [] })
	syncUsersMumbleGroupsMock.mockResolvedValue({ synced: [], skipped: [] })
})

describe('admin mumble routes', () => {
	it('returns mumble account status and connection info', async () => {
		getMumbleAccountMock.mockResolvedValue({
			subjectId: 'user-1',
			loginName: 'pilot',
			displayName: 'Pilot [TST]',
			enabled: true,
			groups: ['Fleet', 'Ops'],
			hasPassword: true,
			lastAuthenticatedAt: '2025-06-01T12:00:00.000Z',
		})

		const res = await createApp(makeUser()).request(
			'/api/admin/users/user-1/mumble',
			{},
			env
		)

		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.account.loginName).toBe('pilot')
		expect(body.connection).toEqual({ host: 'voice.test', port: 64738 })
	})

	it('falls back to an empty status when the mumble worker transport is unavailable', async () => {
		getMumbleAccountMock.mockRejectedValue(new Error('Network connection lost.'))

		const res = await createApp(makeUser()).request(
			'/api/admin/users/user-1/mumble',
			{},
			env
		)

		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.account).toBeNull()
		expect(body.connection).toEqual({ host: 'voice.test', port: 64738 })
	})

	it('syncs a user mumble groups on demand', async () => {
		syncUsersMumbleGroupsMock.mockResolvedValue({ synced: ['user-1'], skipped: [] })

		const res = await createApp(makeUser()).request(
			'/api/admin/users/user-1/mumble/sync-groups',
			{ method: 'POST' },
			env
		)

		expect(res.status).toBe(200)
		expect(syncUsersMumbleGroupsMock).toHaveBeenCalledWith(
			expect.any(Object),
			['user-1'],
			'admin-manual-mumble-sync'
		)
		const body = (await res.json()) as any
		expect(body.synced).toEqual(['user-1'])
	})

	it('deletes a user mumble account', async () => {
		deleteMumbleAccountsMock.mockResolvedValue({
			deleted: ['user-1'],
			notFound: [],
			queued: [],
		})

		const res = await createApp(makeUser()).request(
			'/api/admin/users/user-1/mumble',
			{ method: 'DELETE' },
			env
		)

		expect(res.status).toBe(200)
		expect(deleteMumbleAccountsMock).toHaveBeenCalledWith(expect.any(Object), ['user-1'])
		const body = (await res.json()) as any
		expect(body.deleted).toEqual(['user-1'])
	})
})
