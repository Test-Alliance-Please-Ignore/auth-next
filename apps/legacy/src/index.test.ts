import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LegacyDO } from './durable-object'

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

const { coreStubMock } = vi.hoisted(() => ({
	coreStubMock: {
		getUserCharacters: vi.fn(),
		getUserDiscordUserId: vi.fn(),
		createUserBlacklist: vi.fn(),
		createCharacterBlacklist: vi.fn(),
		legacyImportCharacterLinks: vi.fn(),
		legacyImportNotes: vi.fn(),
		legacyImportIpAssociations: vi.fn(),
		getLegacyCharacterImportMetadata: vi.fn(),
		evaluateLegacyMigrationBlacklistSignals: vi.fn(),
	},
}))

vi.mock('@repo/do-utils', () => ({
	getStub: () => coreStubMock,
}))

describe('legacy durable object rpc', () => {
	const migrationQueueFindFirst = vi.fn()
	const migrationQueueFindMany = vi.fn()
	const legacyCharactersFindMany = vi.fn()
	const legacyNotesFindMany = vi.fn()
	const legacyIpsFindMany = vi.fn()
	const legacyApplicationsFindMany = vi.fn()
	const legacyApplicationEventsFindMany = vi.fn()
	const legacyAuthDiscordAccountsFindMany = vi.fn()
	const updateSetMock = vi.fn()
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
				legacyMigrationQueue: {
					findFirst: migrationQueueFindFirst,
					findMany: migrationQueueFindMany,
				},
				legacyAuthCharacters: { findMany: legacyCharactersFindMany },
				legacyAuthNotes: { findMany: legacyNotesFindMany },
				legacyAuthUserIpAddresses: { findMany: legacyIpsFindMany },
				legacyAuthApplications: { findMany: legacyApplicationsFindMany, findFirst: vi.fn() },
				legacyAuthApplicationEvents: { findMany: legacyApplicationEventsFindMany },
				legacyAuthDiscordAccounts: { findMany: legacyAuthDiscordAccountsFindMany },
			},
			select: selectMock,
			update: vi.fn(() => ({
				set: (value: unknown) => {
					updateSetMock(value)
					return {
						where: () => ({
							returning: updateReturning,
						}),
					}
				},
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
		legacyCharactersFindMany.mockResolvedValue([
			{
				legacyAuthUserId: 'legacy-1',
				characterId: '2001',
				characterName: 'One',
				source: 'esi_owner',
			},
		])
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
		legacyAuthDiscordAccountsFindMany.mockResolvedValue([])
		selectWhereMock.mockReturnValue(selectWhereResult)
		selectGroupByMock.mockResolvedValue([])
		updateReturning.mockResolvedValue([{ id: 'queue-1', status: 'applied' }])
		actionInsertValues.mockResolvedValue(undefined)
		actionInsertReturning.mockResolvedValue([{ id: 'queue-row-1' }])

		coreStubMock.getUserCharacters.mockResolvedValue([
			{ characterId: '2001', characterName: 'One' },
		])
		coreStubMock.getUserDiscordUserId.mockResolvedValue(null)
		coreStubMock.getLegacyCharacterImportMetadata.mockResolvedValue([])
		coreStubMock.createUserBlacklist.mockResolvedValue({ entryId: 'entry-1' })
		coreStubMock.createCharacterBlacklist.mockResolvedValue({ entryId: 'char-entry-1' })
		coreStubMock.legacyImportCharacterLinks.mockResolvedValue({
			inserted: 1,
			alreadyLinkedToUser: 0,
			linkedToOtherUser: 0,
			totalRequested: 1,
		})
		coreStubMock.legacyImportNotes.mockResolvedValue({ created: 1, failed: 0, totalRequested: 1 })
		coreStubMock.legacyImportIpAssociations.mockResolvedValue({
			imported: 1,
			failed: 0,
			totalRequested: 1,
		})
		coreStubMock.evaluateLegacyMigrationBlacklistSignals.mockResolvedValue({
			hasAnyBlacklistSignal: false,
			modernUserBlacklisted: false,
			matchedTargets: [],
			matchingCharactersBlacklisted: [],
			matchingDiscordUserIdsBlacklisted: [],
			ipAssociatedBlacklistedUsers: [],
		})

		legacy = new LegacyDO(
			{} as DurableObjectState,
			{
				DATABASE_URL: 'postgresql://test',
				CORE: {} as DurableObjectNamespace,
			} as any
		)
	})

	it('executes import actions and records apply payload results', async () => {
		const result = await legacy.applyMigration('queue-1', {
			applyBlacklistToUser: true,
			importCharacterLinks: true,
			importNotes: true,
			importIpAssociations: true,
		})

		expect(result?.item.status).toBe('applied')
		expect(coreStubMock.legacyImportCharacterLinks).toHaveBeenCalledTimes(1)
		expect(coreStubMock.createCharacterBlacklist).toHaveBeenCalledWith(
			expect.objectContaining({
				characterId: '2001',
				characterName: 'One',
				reason: 'Legacy migration blacklist action for legacy user legacy-1',
				metadata: expect.objectContaining({
					source: 'legacy_migration_apply',
					queueId: 'queue-1',
					legacyAuthUserId: 'legacy-1',
					modernUserId: '11111111-1111-4111-8111-111111111111',
				}),
			})
		)
		expect(coreStubMock.legacyImportNotes).toHaveBeenCalledTimes(1)
		expect(coreStubMock.legacyImportIpAssociations).toHaveBeenCalledTimes(1)
		expect(actionInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'apply',
				payload: expect.objectContaining({
					applyResults: expect.objectContaining({
						applyBlacklistToUser: expect.objectContaining({ status: 'applied' }),
						importCharacterLinks: expect.objectContaining({ status: 'applied' }),
						importCharacterBlacklists: expect.objectContaining({ status: 'applied' }),
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
		coreStubMock.getUserCharacters.mockResolvedValue([
			{ characterId: '2001', characterName: 'One' },
			{ characterId: '2002', characterName: 'Two' },
		])
		coreStubMock.getUserDiscordUserId.mockResolvedValue('discord-1')
		const result = await legacy.recheckUser('11111111-1111-4111-8111-111111111111', 'admin-1')
		expect(result.ok).toBe(true)
		expect(result.modernUserId).toBe('11111111-1111-4111-8111-111111111111')
		expect(coreStubMock.evaluateLegacyMigrationBlacklistSignals).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceHints: expect.arrayContaining([
					expect.objectContaining({
						targetType: 'character_id',
						targetValue: '2001',
						source: 'tang_direct',
					}),
					expect.objectContaining({
						targetType: 'character_name',
						targetValue: 'One',
						source: 'tang_direct',
					}),
					expect.objectContaining({
						targetType: 'discord_id',
						targetValue: 'discord-1',
						source: 'tang_direct',
					}),
				]),
			})
		)
	})

	it('does not re-trigger an applied migration on a normal recheck', async () => {
		migrationQueueFindMany.mockResolvedValue([
			{
				id: 'queue-1',
				modernUserId: '11111111-1111-4111-8111-111111111111',
				legacyAuthUserId: 'legacy-1',
				status: 'applied',
				candidateSnapshot: {
					matchingCharacters: [{ characterId: '2001', characterName: 'One', source: 'esi_owner' }],
					matchingDiscordAccounts: [],
					associatedCounts: {
						characters: 1,
						ipAddresses: 0,
						notes: 0,
						applications: 0,
						discordAccounts: 0,
					},
				},
				conflicts: {
					multipleLegacyUsersForModernUser: false,
					crossModernUserQueueMatches: [],
				},
			},
		])

		const result = await legacy.recheckUser('11111111-1111-4111-8111-111111111111', 'admin-1')

		expect(result.ok).toBe(true)
		expect(result.legacyAuthUserIds).toEqual(['legacy-1'])
		expect(result.created).toBe(0)
		expect(result.updated).toBe(0)
		expect(result.dismissed).toBe(0)
		expect(updateSetMock).not.toHaveBeenCalled()
		expect(actionInsertValues).not.toHaveBeenCalled()
	})

	it('reopens an applied migration when force recheck finds new evidence', async () => {
		legacyCharactersFindMany.mockResolvedValue([
			{
				legacyAuthUserId: 'legacy-1',
				characterId: '2001',
				characterName: 'One',
				source: 'esi_owner',
			},
			{
				legacyAuthUserId: 'legacy-1',
				characterId: '2002',
				characterName: 'Two',
				source: 'xml_account',
			},
		])
		migrationQueueFindMany.mockResolvedValue([
			{
				id: 'queue-1',
				modernUserId: '11111111-1111-4111-8111-111111111111',
				legacyAuthUserId: 'legacy-1',
				status: 'applied',
				candidateSnapshot: {
					matchingCharacters: [{ characterId: '2001', characterName: 'One', source: 'esi_owner' }],
					matchingDiscordAccounts: [],
					associatedCounts: {
						characters: 1,
						ipAddresses: 0,
						notes: 0,
						applications: 0,
						discordAccounts: 0,
					},
				},
				conflicts: {
					multipleLegacyUsersForModernUser: false,
					crossModernUserQueueMatches: [],
				},
			},
		])

		const result = await legacy.recheckUser('11111111-1111-4111-8111-111111111111', 'admin-1', {
			force: true,
		})

		expect(result.ok).toBe(true)
		expect(result.legacyAuthUserIds).toEqual(['legacy-1'])
		expect(updateSetMock).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'pending',
			})
		)
	})
})
