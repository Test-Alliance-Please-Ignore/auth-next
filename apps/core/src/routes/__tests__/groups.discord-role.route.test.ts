import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import groupsRoutes from '../groups'

import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../middleware/session', () => ({
	requireAuth:
		() =>
			async (_c: unknown, next: () => Promise<void>): Promise<void> => {
				await next()
			},
	requireAdmin:
		() =>
			async (c: any, next: () => Promise<void>): Promise<Response | void> => {
				const user = c.get('user')
				if (!user?.is_admin) {
					return c.json({ error: 'Forbidden' }, 403)
				}
				await next()
			},
}))

const getStubMock = vi.mocked(getStub)

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'admin-user',
		mainCharacterId: 'main-1',
		sessionId: 'session-1',
		characters: [],
		is_admin: true,
		roles: [],
		discordUserId: null,
		...overrides,
	}
}

function createApp(user: SessionUser) {
	const app = new Hono<{
		Bindings: any
		Variables: {
			user?: SessionUser
		}
	}>()

	app.use('*', async (c, next) => {
		c.set('user', user)
		await next()
	})

	app.route('/api/groups', groupsRoutes)
	return app
}

describe('groups discord role assignment routes', () => {
	const env = {
		GROUPS: { name: 'GROUPS' },
	} as any

	let groupsStub: {
		assignRoleToDiscordServer: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.clearAllMocks()
		groupsStub = {
			assignRoleToDiscordServer: vi.fn(),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.GROUPS) return groupsStub as any
			throw new Error('Unexpected binding')
		})
	})

	it('rejects invalid membership types instead of coercing them to member', async () => {
		const app = createApp(makeUser())

		const res = await app.request(
			'/api/groups/group-1/discord-servers/attachment-1/roles',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					discordRoleId: 'role-db-1',
					membershipType: 'not-a-real-type',
				}),
			},
			env
		)

		expect(res.status).toBe(400)
		await expect(res.json()).resolves.toEqual({
			error: "membershipType must be 'member' or 'owner_admin'",
		})
		expect(groupsStub.assignRoleToDiscordServer).not.toHaveBeenCalled()
	})
})
