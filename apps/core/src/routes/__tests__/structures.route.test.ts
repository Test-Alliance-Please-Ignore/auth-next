import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import structuresRoutes from '../structures'
import { getCachedUserPermissions } from '../../lib/groups-cache'

import type { SessionUser } from '../../context'

const structuresMocks = vi.hoisted(() => ({
	listCitadelStructures: vi.fn(),
}))

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: vi.fn(),
}))

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: 'main-1',
		sessionId: 'session-1',
		characters: [],
		is_admin: false,
		roles: [],
		discordUserId: null,
		...overrides,
	}
}

function createApp(user?: SessionUser) {
	const app = new Hono<{ Bindings: any; Variables: { user?: SessionUser } }>()

	if (user) {
		app.use('*', async (c, next) => {
			c.set('user', user)
			await next()
		})
	}

	app.route('/api/structures', structuresRoutes)
	return app
}

describe('structures routes', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getCachedUserPermissions).mockResolvedValue([])
		structuresMocks.listCitadelStructures.mockResolvedValue({
			items: [
				{
					structureId: 'structure-1',
					corporationId: 'corp-1',
					corporationName: 'Test Corp',
					name: 'Structure One',
					typeId: '35832',
					typeName: 'Astrahus',
					systemId: '30000142',
					systemName: 'Jita',
					regionId: '10000002',
					regionName: 'The Forge',
					state: 'online',
					nextStateAt: null,
					fuelExpires: null,
					fuelAmount: 2000,
					lowPower: false,
					hidden: false,
					lowPowerAllowed: false,
					assignedGroupId: null,
					syncStatus: 'ok',
					syncFailureReason: null,
					lastSyncedAt: '2026-01-01T00:00:00.000Z',
					canViewDetails: false,
					updatedAt: '2026-01-02T00:00:00.000Z',
				},
			],
			pagination: {
				page: 1,
				pageSize: 25,
				totalCount: 1,
				totalPages: 1,
				hasNextPage: false,
				hasPreviousPage: false,
			},
			filterOptions: {
				corporations: [],
				regions: [],
				systems: [],
				states: [],
				types: [],
				assignedGroups: [],
				alliances: [],
				planets: [],
				raidableStates: [],
			},
			summary: {
				total: 1,
				lowFuel: 0,
				lowPower: 0,
				reinforced: 0,
			},
		})
	})

	it('strips updatedAt from list responses before sending them to the browser', async () => {
		const app = createApp(makeUser())
		const response = await app.request(
			'/api/structures/citadels',
			{},
			{
				STRUCTURES: {
					listCitadelStructures: structuresMocks.listCitadelStructures,
				},
			} as any
		)

		expect(response.status).toBe(200)
		const body = (await response.json()) as {
			items: Array<Record<string, unknown>>
		}
		expect(body.items[0]).not.toHaveProperty('updatedAt')
	})
})
