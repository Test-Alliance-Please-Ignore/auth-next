import { Hono } from 'hono'
import { createExecutionContext } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import hrRoutes from '../hr'

import type { SessionUser } from '../../context'

const serviceMocks = vi.hoisted(() => ({
	dispatchCorporationAlert: vi.fn(),
	waitUntilWithTelemetry: vi.fn((_: unknown, __: string, task: () => Promise<unknown>) => {
		void task()
	}),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../services/corporation-alerts.service', () => ({
	dispatchCorporationAlert: serviceMocks.dispatchCorporationAlert,
}))

vi.mock('../../lib/background-task', () => ({
	waitUntilWithTelemetry: serviceMocks.waitUntilWithTelemetry,
}))

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: vi.fn().mockResolvedValue([]),
}))

const getStubMock = vi.mocked(getStub)

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: 'main-1',
		sessionId: 'session-1',
		characters: [
			{
				id: 'uc-main',
				characterOwnerHash: 'hash-main',
				characterId: 'main-1',
				characterName: 'Main Pilot',
				is_primary: true,
				hasValidToken: true,
			},
			{
				id: 'uc-alt',
				characterOwnerHash: 'hash-alt',
				characterId: 'alt-1',
				characterName: 'Alt Pilot',
				is_primary: false,
				hasValidToken: true,
			},
		],
		is_admin: false,
		roles: [],
		discordUserId: null,
		...overrides,
	}
}

function createDb() {
	return {
		query: {
			managedCorporations: {
				findFirst: vi.fn().mockResolvedValue({
					corporationId: 'corp-1',
					name: 'Test Corporation',
				}),
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

describe('HR application submission alerts', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		getStubMock.mockImplementation(() => {
			return {
				submitApplication: vi.fn().mockResolvedValue({
					id: 'app-1',
					createdAt: new Date('2026-06-11T12:00:00.000Z'),
					isFirstApplication: true,
				}),
			}
		})
		serviceMocks.dispatchCorporationAlert.mockResolvedValue({
			alertType: 'corp_application_submitted',
			destinationCount: 1,
			sentCount: 1,
			failedCount: 0,
		})
	})

	it('dispatches a corp application alert after submission', async () => {
		const app = createApp(makeUser(), createDb())
		const executionCtx = createExecutionContext()
		const response = await app.request(
			'/api/hr/applications',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					characterId: 'main-1',
					corporationId: 'corp-1',
					applicationText: 'Let me in.',
					altCharacterIds: ['alt-1'],
				}),
			},
			{
				HR: { name: 'HR' },
			} as any,
			executionCtx
		)

		expect(response.status).toBe(201)
		expect(serviceMocks.waitUntilWithTelemetry).toHaveBeenCalled()
		expect(serviceMocks.dispatchCorporationAlert).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({
				corporationId: 'corp-1',
				alertType: 'corp_application_submitted',
				payload: expect.objectContaining({
					applicationId: 'app-1',
					corporationId: 'corp-1',
					corporationName: 'Test Corporation',
					applicantCharacterId: 'main-1',
					applicantCharacterName: 'Main Pilot',
					altCharacterCount: 1,
					isFirstApplication: true,
					submittedAt: '2026-06-11T12:00:00.000Z',
				}),
			})
		)
	})
})
