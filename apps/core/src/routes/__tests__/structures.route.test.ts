import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import structuresRoutes from '../structures'
import { getCachedUserPermissions } from '../../lib/groups-cache'

import type { SessionUser } from '../../context'

const structuresMocks = vi.hoisted(() => ({
	listCitadelStructures: vi.fn(),
	getVisibleStructureDetail: vi.fn(),
}))
const corpDataMocks = vi.hoisted(() => ({
	rebuildStructureInventorySnapshot: vi.fn(),
}))
const corpDataNamespace = vi.hoisted(
	() => ({ __ns: 'EVE_CORPORATION_DATA' } as unknown as DurableObjectNamespace)
)

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: vi.fn(),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: (namespace: unknown) =>
		namespace === corpDataNamespace
			? {
					rebuildStructureInventorySnapshot: corpDataMocks.rebuildStructureInventorySnapshot,
				}
			: {},
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
		structuresMocks.getVisibleStructureDetail.mockResolvedValue({
			corporationId: 'corp-1',
			corporationName: 'Test Corp',
			structureId: 'structure-1',
			name: 'Structure One',
		})
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

	it('queues structure asset debug as a workflow and exposes status/download endpoints', async () => {
		const exportWorkflow = {
			create: vi.fn().mockResolvedValue({ id: 'workflow-1' }),
			get: vi.fn().mockResolvedValue({
				status: vi.fn().mockResolvedValue({
					status: 'completed',
					output: { status: 'completed' },
				}),
			}),
		}
		const storedArtifact = {
			text: vi.fn().mockResolvedValue(
				JSON.stringify({
					corporationId: 'corp-1',
					corporationName: 'Test Corp',
					structureId: 'structure-1',
					structureName: 'Structure One',
					fetchedAt: '2026-07-13T00:00:00.000Z',
					fetchedAssetCount: 2,
					itemCount: 1,
					items: [],
				})
			),
			customMetadata: {
				fileName: 'structure-assets-debug-workflow-1.json',
				expiresAt: '2030-07-13T23:59:00.000Z',
			},
			httpMetadata: {
				contentType: 'application/json; charset=utf-8',
			},
		}
		const debugBucket = {
			get: vi.fn().mockResolvedValue(storedArtifact),
			delete: vi.fn().mockResolvedValue(undefined),
		}

		const app = createApp(makeUser({ is_admin: true }))
		const env = {
			STRUCTURES: {
				getVisibleStructureDetail: structuresMocks.getVisibleStructureDetail,
			},
			EXPORT_WORKFLOW: exportWorkflow,
			STRUCTURE_ASSETS_DEBUG_EXPORTS: debugBucket,
		} as any

		const startResponse = await app.request(
			'/api/structures/structure-1/assets-debug',
			{ method: 'POST' },
			env
		)
		expect(startResponse.status).toBe(202)
		expect(exportWorkflow.create).toHaveBeenCalledWith({
			params: {
				kind: 'structure-assets-debug',
				userId: 'user-1',
				corporationId: 'corp-1',
				corporationName: 'Test Corp',
				structureId: 'structure-1',
				structureName: 'Structure One',
			},
		})
		const startBody = (await startResponse.json()) as {
			workflowInstanceId: string
			exportId: string
			fileName: string
			status: string
		}
		expect(startBody).toMatchObject({
			workflowInstanceId: 'workflow-1',
			exportId: 'workflow-1',
			fileName: 'structure-assets-debug-workflow.json',
			status: 'queued',
		})

		const statusResponse = await app.request(
			'/api/structures/structure-1/assets-debug/workflow-1',
			{},
			env
		)
		expect(statusResponse.status).toBe(200)
		const statusBody = (await statusResponse.json()) as {
			workflowInstanceId: string
			status: string
			rawStatus: string
			output: unknown
		}
		expect(statusBody).toMatchObject({
			workflowInstanceId: 'workflow-1',
			status: 'completed',
			rawStatus: 'completed',
		})

		const downloadResponse = await app.request(
			'/api/structures/structure-1/assets-debug/workflow-1/download',
			{},
			env
		)
		expect(debugBucket.get).toHaveBeenCalledWith('structure-assets-debug/workflow-1.json')
		expect(downloadResponse.status).toBe(200)
		expect(debugBucket.delete).toHaveBeenCalledWith('structure-assets-debug/workflow-1.json')
		const downloadBody = (await downloadResponse.json()) as { corporationId: string; items: [] }
		expect(downloadBody.corporationId).toBe('corp-1')
	})

	it('rebuilds a structure inventory snapshot for site admins', async () => {
		corpDataMocks.rebuildStructureInventorySnapshot.mockResolvedValue({
			inventoryCount: 42,
		})

		const app = createApp(makeUser({ is_admin: true }))
		const env = {
			STRUCTURES: {
				getVisibleStructureDetail: structuresMocks.getVisibleStructureDetail,
			},
			EVE_CORPORATION_DATA: corpDataNamespace,
		} as any

		const response = await app.request(
			'/api/structures/structure-1/inventory-rebuild',
			{ method: 'POST' },
			env
		)

		expect(response.status).toBe(200)
		expect(structuresMocks.getVisibleStructureDetail).toHaveBeenCalled()
		expect(corpDataMocks.rebuildStructureInventorySnapshot).toHaveBeenCalledWith(
			'corp-1',
			'structure-1'
		)
		const body = (await response.json()) as {
			structureId: string
			corporationId: string
			inventoryCount: number
		}
		expect(body).toEqual({
			structureId: 'structure-1',
			corporationId: 'corp-1',
			inventoryCount: 42,
		})
	})
})
