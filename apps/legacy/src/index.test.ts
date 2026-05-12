import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({
	DurableObject: class {
		constructor(
			public state: unknown,
			public env: unknown
		) {}
	},
}))

const { createDbMock } = vi.hoisted(() => ({
	createDbMock: vi.fn(),
}))

vi.mock('./db', () => ({
	createDb: (...args: unknown[]) => createDbMock(...args),
}))

import { LegacyDO } from './durable-object'

describe('legacy durable object rpc', () => {
	const coreFetch = vi.fn()
	const migrationQueueFindFirst = vi.fn()
	const migrationQueueFindMany = vi.fn()
	const legacyCharactersFindMany = vi.fn()
	const legacyNotesFindMany = vi.fn()
	const legacyIpsFindMany = vi.fn()
	const legacyApplicationsFindMany = vi.fn()
	const legacyApplicationEventsFindMany = vi.fn()
	const updateReturning = vi.fn()
	const actionInsertValues = vi.fn()
	const actionInsertReturning = vi.fn()
	const selectWhereMock = vi.fn()
	const selectGroupByMock = vi.fn()
	const selectWhereResult = {
		groupBy: selectGroupByMock,
		then: (resolve: (value: Array<{ count: number }>) => void) => resolve([{ count: 0 }]),
	}
	const selectFromMock = vi.fn(() => ({ where: selectWhereMock }))
	const selectMock = vi.fn(() => ({ from: selectFromMock }))

	let legacy: LegacyDO

	beforeEach(() => {
		vi.clearAllMocks()

		createDbMock.mockReturnValue({
			query: {
				legacyMigrationQueue: { findFirst: migrationQueueFindFirst, findMany: migrationQueueFindMany },
				legacyAuthCharacters: { findMany: legacyCharactersFindMany },
				legacyAuthNotes: { findMany: legacyNotesFindMany },
				legacyAuthUserIpAddresses: { findMany: legacyIpsFindMany },
				legacyAuthApplications: { findMany: legacyApplicationsFindMany, findFirst: vi.fn() },
				legacyAuthApplicationEvents: { findMany: legacyApplicationEventsFindMany },
			},
			select: selectMock,
			update: vi.fn(() => ({
				set: () => ({
					where: () => ({
						returning: updateReturning,
					}),
				}),
			})),
			insert: vi.fn(() => ({
				values: (...args: unknown[]) => {
					actionInsertValues(...args)
					return { returning: actionInsertReturning }
				},
			})),
		})

		migrationQueueFindFirst.mockResolvedValue({
			id: 'queue-1',
			modernUserId: '11111111-1111-4111-8111-111111111111',
			legacyAuthUserId: 'legacy-1',
			status: 'pending',
		})
		migrationQueueFindMany.mockResolvedValue([])
		legacyCharactersFindMany.mockResolvedValue([{ characterId: '2001', characterName: 'One', source: 'esi_owner' }])
		legacyNotesFindMany.mockResolvedValue([
			{
				legacyNoteId: 'n-1',
				note: 'note one',
				legacyCreatedByUserId: null,
				legacyDateCreated: null,
				metadata: {},
			},
		])
		legacyIpsFindMany.mockResolvedValue([{ ipAddress: '1.1.1.1' }])
		legacyApplicationsFindMany.mockResolvedValue([])
		legacyApplicationEventsFindMany.mockResolvedValue([])
		selectWhereMock.mockReturnValue(selectWhereResult)
		selectGroupByMock.mockResolvedValue([])
		updateReturning.mockResolvedValue([{ id: 'queue-1', status: 'applied' }])
		actionInsertValues.mockResolvedValue(undefined)
		actionInsertReturning.mockResolvedValue([{ id: 'queue-row-1' }])

		coreFetch.mockImplementation(async (url: string) => {
			if (url.includes('/api/admin/users/')) {
				return new Response(
					JSON.stringify({
						id: '11111111-1111-4111-8111-111111111111',
						characters: [{ characterId: '2001' }],
					}),
					{ status: 200 }
				)
			}
			if (url.endsWith('/api/admin/legacy/import-character-links')) {
				return new Response(JSON.stringify({ inserted: 1, linkedToOtherUser: 0 }), { status: 200 })
			}
			if (url.endsWith('/api/admin/legacy/import-notes')) {
				return new Response(JSON.stringify({ created: 1, failed: 0 }), { status: 200 })
			}
			if (url.endsWith('/api/admin/legacy/import-ip-associations')) {
				return new Response(JSON.stringify({ imported: 1, failed: 0 }), { status: 200 })
			}
			if (url.endsWith('/api/admin/blacklist/user')) {
				return new Response(JSON.stringify({ ok: true }), { status: 200 })
			}
			return new Response(JSON.stringify({ ok: true }), { status: 200 })
		})

		legacy = new LegacyDO({} as DurableObjectState, {
			DATABASE_URL: 'postgresql://test',
			CORE: { fetch: coreFetch },
		} as any)
	})

	it('executes import actions and records apply payload results', async () => {
		const result = await legacy.applyMigration('queue-1', {
			importCharacterLinks: true,
			importNotes: true,
			importIpAssociations: true,
		})

		expect(result?.item.status).toBe('applied')
		expect(coreFetch).toHaveBeenCalledWith(
			'https://core.internal/api/admin/legacy/import-character-links',
			expect.objectContaining({ method: 'POST' })
		)
		expect(coreFetch).toHaveBeenCalledWith(
			'https://core.internal/api/admin/legacy/import-notes',
			expect.objectContaining({ method: 'POST' })
		)
		expect(coreFetch).toHaveBeenCalledWith(
			'https://core.internal/api/admin/legacy/import-ip-associations',
			expect.objectContaining({ method: 'POST' })
		)
		expect(actionInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'apply',
				payload: expect.objectContaining({
					applyResults: expect.objectContaining({
						importCharacterLinks: expect.objectContaining({ status: 'applied' }),
						importNotes: expect.objectContaining({ status: 'applied' }),
						importIpAssociations: expect.objectContaining({ status: 'applied' }),
					}),
				}),
			})
		)
	})

	it('lists legacy history with filters and pagination', async () => {
		legacyApplicationsFindMany.mockResolvedValueOnce([
			{
				id: 'app-row-1',
				legacyApplicationId: 'legacy-app-1',
				legacyAuthUserId: 'legacy-1',
				characterId: '2001',
				characterName: 'One',
				corporationId: '98000001',
				corporationName: 'Corp One',
				status: 'accepted',
				applicationDate: null,
				metadata: {},
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			},
		])
		selectWhereMock.mockReturnValueOnce({
			groupBy: selectGroupByMock,
			then: (resolve: (value: Array<{ count: number }>) => void) => resolve([{ count: 1 }]),
		})

		const result = await legacy.listHistory({
			page: 1,
			pageSize: 25,
			characterIds: '2001,2002',
		})
		expect(result.pagination).toMatchObject({ page: 1, pageSize: 25, total: 1, totalPages: 1 })
		expect(result.items).toHaveLength(1)
	})

	it('resolves conflict decision and records action', async () => {
		const result = await legacy.resolveMigration('queue-1', {
			decision: 'needs_review',
			note: 'manual investigation required',
		})
		expect(result?.item).toBeTruthy()
		expect(actionInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'update',
				payload: expect.objectContaining({
					type: 'resolve_conflict',
					decision: 'needs_review',
				}),
			})
		)
	})

	it('rechecks a user and returns queue summary', async () => {
		const result = await legacy.recheckUser('11111111-1111-4111-8111-111111111111', 'admin-1')
		expect(result.ok).toBe(true)
		expect(result.modernUserId).toBe('11111111-1111-4111-8111-111111111111')
	})
})
