import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import hrRoutes from '../hr'

import type { SessionUser } from '../../context'

const hoisted = vi.hoisted(() => ({
	hrMocks: {
		listApplications: vi.fn(),
		getApplication: vi.fn(),
	},
	resolverMocks: {
		resolveIds: vi.fn(),
	},
	accessMocks: {
		hasHrAuditorPermissionForUser: vi.fn().mockResolvedValue(false),
	},
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../lib/hr-access', () => ({
	hasHrAuditorPermission: hoisted.accessMocks.hasHrAuditorPermissionForUser,
	resolveHrAccessState: vi.fn(),
}))

const getStubMock = vi.mocked(getStub)

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: 'main-1',
		sessionId: 'session-1',
		characters: [],
		is_admin: true,
		roles: [],
		discordUserId: null,
		...overrides,
	}
}

function createDb() {
	return {
		query: {
			managedCorporations: {
				findMany: vi.fn().mockResolvedValue([{ corporationId: 'corp-1', name: 'Managed Corp' }]),
				findFirst: vi.fn(),
			},
			users: { findMany: vi.fn() },
			userCharacters: { findMany: vi.fn() },
		},
	}
}

function createApp(user?: SessionUser, db?: ReturnType<typeof createDb>) {
	const app = new Hono<{ Bindings: any; Variables: { user?: SessionUser; db?: any } }>()

	if (user || db) {
		app.use('*', async (c, next) => {
			if (user) {
				c.set('user', user)
			}
			if (db) {
				c.set('db', db)
			}
			await next()
		})
	}

	app.route('/api/hr', hrRoutes)
	return app
}

describe('HR application hydration', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		getStubMock.mockImplementation((binding: any) => {
			if (binding?.name === 'HR') {
				return {
					listApplications: hoisted.hrMocks.listApplications,
					getApplication: hoisted.hrMocks.getApplication,
				}
			}
			if (binding?.name === 'ESI_TYPE_RESOLVER') {
				return {
					resolveIds: hoisted.resolverMocks.resolveIds,
				}
			}
			throw new Error(`Unexpected binding: ${binding?.name ?? 'unknown'}`)
		})
		hoisted.resolverMocks.resolveIds.mockResolvedValue({})
	})

	it('falls back to managed corporation names for application lists', async () => {
		const db = createDb()
		hoisted.hrMocks.listApplications.mockResolvedValue([
			{
				id: 'app-1',
				corporationId: 'corp-1',
				userId: 'user-1',
				characterId: 'char-1',
				characterName: 'Pilot One',
				applicationText: 'Hello',
				status: 'pending',
				reviewedBy: null,
				reviewedByCharacterName: null,
				reviewedAt: null,
				reviewNotes: null,
				createdAt: new Date('2026-06-11T12:00:00.000Z'),
				updatedAt: new Date('2026-06-11T12:00:00.000Z'),
				lastStaffInteractionAt: null,
				altCharacterIds: [],
				isFirstApplication: true,
			},
		])

		const app = createApp(makeUser(), db)
		const response = await app.request(
			'/api/hr/applications',
			{},
			{
				HR: { name: 'HR' },
				ESI_TYPE_RESOLVER: { name: 'ESI_TYPE_RESOLVER' },
			} as any
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([
			expect.objectContaining({
				corporationId: 'corp-1',
				corporationName: 'Managed Corp',
			}),
		])
	})

	it('falls back to managed corporation names for application detail', async () => {
		const db = createDb()
		hoisted.hrMocks.getApplication.mockResolvedValue({
			id: 'app-1',
			corporationId: 'corp-1',
			userId: 'user-1',
			characterId: 'char-1',
			characterName: 'Pilot One',
			applicationText: 'Hello',
			status: 'pending',
			reviewedBy: null,
			reviewedByCharacterName: null,
			reviewedAt: null,
			reviewNotes: null,
			createdAt: new Date('2026-06-11T12:00:00.000Z'),
			updatedAt: new Date('2026-06-11T12:00:00.000Z'),
			lastStaffInteractionAt: null,
			altCharacterIds: [],
			isFirstApplication: true,
			recommendations: [],
			recommendationCount: 0,
			activityLog: [],
		})

		const app = createApp(makeUser(), db)
		const response = await app.request(
			'/api/hr/applications/app-1',
			{},
			{
				HR: { name: 'HR' },
				ESI_TYPE_RESOLVER: { name: 'ESI_TYPE_RESOLVER' },
			} as any
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual(
			expect.objectContaining({
				corporationId: 'corp-1',
				corporationName: 'Managed Corp',
			})
		)
	})
})
