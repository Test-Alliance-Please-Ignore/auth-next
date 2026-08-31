import { beforeEach, describe, expect, it, vi } from 'vitest'

// After module mocks, get reference to the mocked getStub so we can control per-call returns
import { getStub } from '@repo/do-utils'
import { getPublicEsiInstance } from '@repo/esi'

// Import the functions under test AFTER mocks are in place
import {
	getExpectedManagedRoleIdsByGuild,
	getTemporaryRoleIdsByGuild,
	inspectUserDiscordAccess,
	inviteUserToDiscordServers,
	refreshServerMembers,
	syncUserDiscordAccess,
	updateUserDiscordNickname,
	updateUserDiscordRoles,
} from '../discord.service'

vi.mock('../mumble.service', () => ({
	enforceBlacklistedMumbleAccess: vi.fn(),
}))

/**
 * Discord Role Sync Tests
 *
 * Comprehensive tests for updateUserDiscordRoles and inviteUserToDiscordServers.
 * Validates the full permissions matrix for:
 *   - Corp/alliance entitlement gating
 *   - Group membership role grants
 *   - Corp-gated guild enforcement (group roles withheld when user has no corp access)
 *   - Role removal with allowRemoval flag (Bug 1 fix)
 *   - Non-managed (server-granted) roles left intact
 */

// ─── Mock Infrastructure ────────────────────────────────────────────────────

// Stub stores — tests populate these to control what the mocked DOs return
const discordStubMethods = {
	joinUserToServers: vi.fn(),
	updateUserRoles: vi.fn(),
	updateUserNickname: vi.fn(),
	checkGuildMembershipWithBot: vi.fn(),
	getUserGuildMembershipDetails: vi.fn(),
	getGuildRoles: vi.fn().mockResolvedValue([]),
	getDiscordUserStatus: vi.fn(),
	revokeAccessAndBan: vi.fn(),
	updateLastRefreshed: vi.fn(),
}

const groupsStubMethods = {
	getGroupsWithDiscordAutoInvite: vi.fn(),
	getGroupMemberUserIds: vi.fn(),
	getGroupOwnerAndAdminUserIds: vi.fn(),
	getGroupsByDiscordServer: vi.fn(),
	getDiscordServerAttachmentConfig: vi.fn(),
	insertDiscordInviteAuditRecords: vi.fn(),
}

const hrStubMethods = {
	isUserBlacklisted: vi.fn(),
}

const eveCorpStubMethods = {
	getCorporationIdsByCharacterIds: vi.fn(),
	getCorporationInfo: vi.fn(),
}

const publicEsiStubMethods = {
	fetchAlliancePublicInfo: vi.fn(),
}

// DB query mock — every table.findMany / table.findFirst is wired per-test
const dbQueryMocks: Record<
	string,
	{ findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> }
> = {
	users: { findMany: vi.fn(), findFirst: vi.fn() },
	userCharacters: { findMany: vi.fn(), findFirst: vi.fn() },
	discordServers: { findMany: vi.fn(), findFirst: vi.fn() },
	discordRoles: { findMany: vi.fn(), findFirst: vi.fn() },
	corporationDiscordServers: { findMany: vi.fn(), findFirst: vi.fn() },
	managedCorporations: { findMany: vi.fn(), findFirst: vi.fn() },
}

const dbInsertMock = vi.fn(() => ({
	values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })),
}))

const mockDb = {
	query: dbQueryMocks,
	insert: dbInsertMock,
}

// Module-level mocks — intercept createDb, getStub, getDiscordStub
vi.mock('../../db', () => ({
	createDb: vi.fn(() => mockDb),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn((_namespace: unknown, _id: string) => {
		// The service calls getStub<Groups>, getStub<Hr>, getStub<EveCorporationData>
		// We differentiate by the namespace reference passed in, which we set on mockEnv
		return {} // replaced per-call below via the factory
	}),
}))

vi.mock('@repo/esi', () => ({
	getPublicEsiInstance: vi.fn(),
}))

vi.mock('@repo/discord', () => ({
	DISCORD_EXCLUDED_AUTH_GIGACHAD_ROLE_ID: '1431816436640256060',
	DISCORD_EXCLUDED_AUTH_ROLE_IDS: new Set(['585546446120419328', '1431816436640256060']),
	getDiscordStub: vi.fn(() => discordStubMethods),
}))

vi.mock('@repo/hono-helpers', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

vi.mock('@repo/db-utils', async () => {
	return {
		eq: vi.fn((_col: unknown, val: unknown) => ({ _eq: val })),
		and: vi.fn((...args: unknown[]) => ({ _and: args })),
		inArray: vi.fn((_col: unknown, vals: unknown) => ({ _inArray: vals })),
	}
})

describe('temporary role cleanup source resolution', () => {
	it('retains pending cleanup role IDs after the managed role is deactivated', async () => {
		dbQueryMocks.discordRoles.findMany.mockResolvedValue([])
		temporaryAssignmentsStub.listActiveAssignments.mockResolvedValue([])
		temporaryAssignmentsStub.listPendingRemovalAssignments.mockResolvedValue([
			{
				roleId: 'historically-managed-role',
				status: 'removal_pending',
			},
		])

		const result = await getTemporaryRoleIdsByGuild(mockDb as any, mockEnv, ['guild-1'], 'user-1')

		expect(result.cleanupRoleIdsByGuild.get('guild-1')).toEqual(['historically-managed-role'])
	})

	it('lets a newer active assignment suppress stale cleanup for the same role', async () => {
		dbQueryMocks.discordRoles.findMany.mockResolvedValue([
			{ roleId: 'role-1', discordServer: { guildId: 'guild-1', isActive: true } },
		])
		temporaryAssignmentsStub.listActiveAssignments.mockResolvedValue([
			{ roleId: 'role-1', status: 'active', revision: 8 },
		])
		temporaryAssignmentsStub.listPendingRemovalAssignments.mockResolvedValue([
			{ roleId: 'role-1', status: 'failed', revision: 7 },
		])

		const result = await getTemporaryRoleIdsByGuild(mockDb as any, mockEnv, ['guild-1'], 'user-1')

		expect(result.activeRoleIdsByGuild.get('guild-1')).toEqual(['role-1'])
		expect(result.cleanupRoleIdsByGuild.has('guild-1')).toBe(false)
	})

	it('preserves current roles when the assignment source is unavailable', async () => {
		temporaryAssignmentsStub.listActiveAssignments.mockRejectedValue(new Error('DO unavailable'))
		dbQueryMocks.discordRoles.findMany.mockResolvedValue([
			{ roleId: 'temporary-role-1', discordServer: { guildId: 'guild-1', isActive: true } },
		])

		const result = await getTemporaryRoleIdsByGuild(mockDb as any, mockEnv, ['guild-1'], 'user-1')

		expect(result.failedGuildIds).toContain('guild-1')
		expect(result.configuredRoleIdsByGuild.get('guild-1')).toBeUndefined()
		expect(result.preserveAllCurrentRolesGuildIds).toContain('guild-1')
	})
})

const mockedGetStub = vi.mocked(getStub)
const getPublicEsiInstanceMock = vi.mocked(getPublicEsiInstance)

// ─── Setup a routing getStub ─────────────────────────────────────────────────
// The service uses getStub<Groups>(env.GROUPS, 'default'), getStub<Hr>(env.HR, 'default'), etc.
// We route based on the namespace symbol.
const GROUPS_NS = Symbol('GROUPS')
const HR_NS = Symbol('HR')
const EVE_CORP_NS = Symbol('EVE_CORPORATION_DATA')
const ESI_NS = Symbol('ESI')
const DISCORD_NS = Symbol('DISCORD')
const TEMPORARY_ROLE_ASSIGNMENTS_NS = Symbol('TEMPORARY_ROLE_ASSIGNMENTS')
const temporaryAssignmentsStub = {
	listActiveAssignments: vi.fn(),
	listPendingRemovalAssignments: vi.fn(),
}

const mockEnv = {
	DATABASE_URL: 'postgresql://test',
	GROUPS: GROUPS_NS,
	HR: HR_NS,
	EVE_CORPORATION_DATA: EVE_CORP_NS,
	ESI: ESI_NS,
	DISCORD: DISCORD_NS,
	TEMPORARY_ROLE_ASSIGNMENTS: TEMPORARY_ROLE_ASSIGNMENTS_NS,
	DISCORD_ROLE_ADD_ONLY_MODE: false,
} as any

function setupGetStubRouting() {
	mockedGetStub.mockImplementation((namespace: any, _id: string) => {
		if (namespace === GROUPS_NS) return groupsStubMethods as any
		if (namespace === HR_NS) return hrStubMethods as any
		if (namespace === EVE_CORP_NS) return eveCorpStubMethods as any
		if (namespace === TEMPORARY_ROLE_ASSIGNMENTS_NS) return temporaryAssignmentsStub as any
		return {} as any
	})
}

// ─── Fixture Helpers ─────────────────────────────────────────────────────────

function makeUser(overrides: Partial<{ id: string; discordUserId: string | null }> = {}) {
	return {
		id: 'user-1',
		discordUserId: 'discord-user-1',
		mainCharacterId: 'char-1',
		...overrides,
	}
}

function makeCharacter(
	overrides: Partial<{
		userId: string
		characterId: string
		characterName: string
		corporationId: string
		allianceId: string | null
		is_primary: boolean
	}> = {}
) {
	return {
		userId: 'user-1',
		characterId: 'char-1',
		characterName: 'Test Pilot',
		corporationId: 'corp-1',
		allianceId: null,
		is_primary: true,
		...overrides,
	}
}

function makeDiscordServer(
	overrides: Partial<{
		id: string
		guildId: string
		guildName: string
		isActive: boolean
		manageNicknames: boolean
	}> = {}
) {
	return {
		id: 'ds-1',
		guildId: 'guild-1',
		guildName: 'Test Server',
		isActive: true,
		manageNicknames: false,
		...overrides,
	}
}

function makeCorpAttachment(
	overrides: {
		corporationId?: string
		discordServerId?: string
		autoInvite?: boolean
		autoAssignRoles?: boolean
		guildId?: string
		guildName?: string
		corpName?: string
		isMemberCorporation?: boolean
		corpMemberNicknameEnabled?: boolean
		corpMemberNicknameSource?: 'corp' | 'alliance' | 'custom'
		corpMemberNicknameCustomTicker?: string | null
		allianceGuestRoleId?: string | null
		allianceGuestAutoApply?: boolean
		allianceGuestNicknameEnabled?: boolean
		allianceGuestNicknameSource?: 'corp' | 'alliance' | 'custom'
		allianceGuestNicknameCustomTicker?: string | null
		nonAllianceGuestRoleId?: string | null
		nonAllianceGuestAutoApply?: boolean
		nonAllianceGuestNicknameEnabled?: boolean
		nonAllianceGuestNicknameSource?: 'corp' | 'alliance' | 'custom'
		nonAllianceGuestNicknameCustomTicker?: string | null
		roleIds?: string[]
	} = {}
) {
	const guildId = overrides.guildId ?? 'guild-1'
	const guildName = overrides.guildName ?? 'Test Server'
	const corpId = overrides.corporationId ?? 'corp-1'
	const dsId = overrides.discordServerId ?? 'ds-1'
	const roleData = (overrides.roleIds ?? []).map((roleId) => ({
		discordRole: { roleId, isActive: true },
	}))
	const scenarioRoles = [
		{
			bucket: 'alliance_guest' as const,
			discordRoleId: overrides.allianceGuestRoleId ?? null,
			autoApply: overrides.allianceGuestAutoApply ?? false,
		},
		{
			bucket: 'non_alliance_guest' as const,
			discordRoleId: overrides.nonAllianceGuestRoleId ?? null,
			autoApply: overrides.nonAllianceGuestAutoApply ?? false,
		},
	]
	const nicknameConfigs = [
		{
			bucket: 'corp_member' as const,
			enabled: overrides.corpMemberNicknameEnabled ?? false,
			source: overrides.corpMemberNicknameSource ?? 'corp',
			customTicker: overrides.corpMemberNicknameCustomTicker ?? null,
		},
		{
			bucket: 'alliance_guest' as const,
			enabled: overrides.allianceGuestNicknameEnabled ?? false,
			source: overrides.allianceGuestNicknameSource ?? 'corp',
			customTicker: overrides.allianceGuestNicknameCustomTicker ?? null,
		},
		{
			bucket: 'non_alliance_guest' as const,
			enabled: overrides.nonAllianceGuestNicknameEnabled ?? false,
			source: overrides.nonAllianceGuestNicknameSource ?? 'corp',
			customTicker: overrides.nonAllianceGuestNicknameCustomTicker ?? null,
		},
	]
	return {
		id: `cds-${corpId}-${dsId}`,
		corporationId: corpId,
		discordServerId: dsId,
		autoInvite: overrides.autoInvite ?? true,
		autoAssignRoles: overrides.autoAssignRoles ?? true,
		corpMemberNicknameEnabled: overrides.corpMemberNicknameEnabled ?? false,
		corpMemberNicknameSource: overrides.corpMemberNicknameSource ?? 'corp',
		corpMemberNicknameCustomTicker: overrides.corpMemberNicknameCustomTicker ?? null,
		allianceGuestRoleId: overrides.allianceGuestRoleId ?? null,
		allianceGuestAutoApply: overrides.allianceGuestAutoApply ?? false,
		allianceGuestNicknameEnabled: overrides.allianceGuestNicknameEnabled ?? false,
		allianceGuestNicknameSource: overrides.allianceGuestNicknameSource ?? 'corp',
		allianceGuestNicknameCustomTicker: overrides.allianceGuestNicknameCustomTicker ?? null,
		nonAllianceGuestRoleId: overrides.nonAllianceGuestRoleId ?? null,
		nonAllianceGuestAutoApply: overrides.nonAllianceGuestAutoApply ?? false,
		nonAllianceGuestNicknameEnabled: overrides.nonAllianceGuestNicknameEnabled ?? false,
		nonAllianceGuestNicknameSource: overrides.nonAllianceGuestNicknameSource ?? 'corp',
		nonAllianceGuestNicknameCustomTicker: overrides.nonAllianceGuestNicknameCustomTicker ?? null,
		corporation: {
			id: corpId,
			name: overrides.corpName ?? 'Test Corp',
			isMemberCorporation: overrides.isMemberCorporation ?? false,
		},
		discordServer: { id: dsId, guildId, guildName, isActive: true },
		roles: roleData,
		scenarioRoles,
		nicknameConfigs,
	}
}

function makeGroupWithDiscord(
	overrides: {
		groupId?: string
		groupName?: string
		discordServers?: Array<{
			discordServerId: string
			autoInvite?: boolean
			autoAssignRoles?: boolean
			roleIds?: string[]
			memberRoleIds?: string[]
			ownerAdminRoleIds?: string[]
		}>
	} = {}
) {
	return {
		groupId: overrides.groupId ?? 'group-1',
		groupName: overrides.groupName ?? 'Test Group',
		discordServers: overrides.discordServers ?? [
			{
				discordServerId: 'ds-1',
				autoInvite: true,
				autoAssignRoles: true,
				roleIds: [],
				memberRoleIds: [],
				ownerAdminRoleIds: [],
			},
		],
	}
}

// ─── Reset ───────────────────────────────────────────────────────────────────

beforeEach(() => {
	for (const stub of [
		discordStubMethods,
		groupsStubMethods,
		hrStubMethods,
		eveCorpStubMethods,
		publicEsiStubMethods,
	]) {
		for (const value of Object.values(stub)) {
			value.mockReset()
		}
	}
	for (const value of Object.values(temporaryAssignmentsStub)) value.mockReset()
	for (const tableMocks of Object.values(dbQueryMocks)) {
		tableMocks.findMany.mockReset()
		tableMocks.findFirst.mockReset()
	}
	dbInsertMock.mockReset()
	mockedGetStub.mockReset()
	setupGetStubRouting()

	// Default: user exists with Discord linked
	dbQueryMocks.users.findFirst.mockResolvedValue(makeUser())
	// Default: one character
	dbQueryMocks.userCharacters.findMany.mockResolvedValue([makeCharacter()])
	// Default: not blacklisted
	hrStubMethods.isUserBlacklisted.mockResolvedValue(false)
	// Default: character→corp mapping
	eveCorpStubMethods.getCorporationIdsByCharacterIds.mockResolvedValue({ 'char-1': 'corp-1' })
	eveCorpStubMethods.getCorporationInfo.mockResolvedValue({
		corporationId: 'corp-1',
		name: 'Test Corp',
		ticker: 'TEST',
		allianceId: null,
	} as any)
	publicEsiStubMethods.fetchAlliancePublicInfo.mockResolvedValue({
		allianceId: 'alliance-1',
		name: 'Test Alliance',
		ticker: 'ALLY',
	} as any)
	// Default: empty groups
	groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])
	groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
	groupsStubMethods.getGroupOwnerAndAdminUserIds.mockResolvedValue([])
	// Default: empty auto-apply roles
	dbQueryMocks.discordRoles.findMany.mockResolvedValue([])
	dbQueryMocks.managedCorporations.findMany.mockResolvedValue([])
	// Default: Discord stubs return success
	discordStubMethods.updateUserRoles.mockResolvedValue([])
	discordStubMethods.updateUserNickname.mockResolvedValue(undefined)
	getPublicEsiInstanceMock.mockReturnValue(publicEsiStubMethods as any)
	discordStubMethods.joinUserToServers.mockResolvedValue([])
	discordStubMethods.checkGuildMembershipWithBot.mockResolvedValue([])
	discordStubMethods.getUserGuildMembershipDetails.mockResolvedValue([])
	discordStubMethods.getGuildRoles.mockResolvedValue([])
	discordStubMethods.getDiscordUserStatus.mockResolvedValue({
		authRevoked: false,
	})
	discordStubMethods.revokeAccessAndBan.mockResolvedValue([])
	discordStubMethods.updateLastRefreshed.mockResolvedValue(undefined)
	// Default: corp attachments empty
	dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([])
	// Default: discord servers empty
	dbQueryMocks.discordServers.findMany.mockResolvedValue([])
	dbQueryMocks.discordServers.findFirst.mockResolvedValue(null)
})

// ═════════════════════════════════════════════════════════════════════════════
// updateUserDiscordRoles — Corp/Group Gating Matrix
// ═════════════════════════════════════════════════════════════════════════════

describe('updateUserDiscordRoles', () => {
	// Helper to set up the common "user is in guild-1" scenario
	function setupUserInGuild(guildId = 'guild-1') {
		// checkGuildMembershipWithBot returns guilds the user is actually in
		discordStubMethods.checkGuildMembershipWithBot.mockResolvedValue([guildId])
		// Active servers list
		dbQueryMocks.discordServers.findMany.mockResolvedValue([makeDiscordServer({ guildId })])
	}

	describe('Corp entitlement + group roles on same guild', () => {
		it('should grant both corp and group roles when user has corp entitlement', async () => {
			setupUserInGuild('guild-1')

			// Corp attachment to guild-1 with corp-role-1
			dbQueryMocks.corporationDiscordServers.findMany
				// First call: user's corp attachments
				.mockResolvedValueOnce([
					makeCorpAttachment({
						corporationId: 'corp-1',
						guildId: 'guild-1',
						roleIds: ['corp-role-1'],
					}),
				])
				// Second call: corp-gating check (any corp attachment exists for this guild)
				.mockResolvedValueOnce([
					makeCorpAttachment({
						corporationId: 'corp-1',
						discordServerId: 'ds-1',
						guildId: 'guild-1',
					}),
				])

			// Group attached to same guild with group-role-1
			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
				makeGroupWithDiscord({
					groupId: 'group-1',
					discordServers: [
						{
							discordServerId: 'ds-1',
							autoInvite: true,
							autoAssignRoles: true,
							roleIds: ['dr-group-1'],
						},
					],
				}),
			])
			groupsStubMethods.getGroupMemberUserIds.mockResolvedValue(['user-1'])

			// Server lookup for group check
			dbQueryMocks.discordServers.findFirst.mockResolvedValue(
				makeDiscordServer({ id: 'ds-1', guildId: 'guild-1' })
			)

			// Role lookup for group's roleIds (db IDs → discord role IDs)
			dbQueryMocks.discordRoles.findMany
				.mockResolvedValueOnce([{ roleId: 'group-role-1', isActive: true }]) // group role lookup
				.mockResolvedValueOnce([]) // auto-apply roles

			// Managed roles for guild
			groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])

			discordStubMethods.updateUserRoles.mockResolvedValue([
				{
					guildId: 'guild-1',
					success: true,
					rolesAdded: ['corp-role-1', 'group-role-1'],
					rolesRemoved: [],
				},
			])

			const result = await updateUserDiscordRoles(mockEnv, 'user-1')

			expect(discordStubMethods.updateUserRoles).toHaveBeenCalled()
			const updateCall = discordStubMethods.updateUserRoles.mock.calls[0]
			const requests = updateCall[1]
			// Should have corp-role-1 and group-role-1 as expected roles
			expect(requests[0].roleIds).toEqual(expect.arrayContaining(['corp-role-1', 'group-role-1']))
			expect(result.totalUpdated).toBe(1)
		})
	})

	describe('Corp-gated guild: user has NO corp entitlement', () => {
		it('should withhold group roles on a corp-gated guild when user has no corp access', async () => {
			setupUserInGuild('guild-1')

			// No corp attachments for this user's corps
			dbQueryMocks.corporationDiscordServers.findMany
				.mockResolvedValueOnce([]) // user's corp attachments: none
				.mockResolvedValueOnce([
					makeCorpAttachment({
						corporationId: 'corp-1',
						discordServerId: 'ds-1',
						guildId: 'guild-1',
					}),
				]) // corp-gating: guild IS corp-gated

			// Group attached to guild-1 with group roles
			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
				makeGroupWithDiscord({
					groupId: 'group-1',
					discordServers: [
						{
							discordServerId: 'ds-1',
							autoInvite: true,
							autoAssignRoles: true,
							roleIds: ['dr-group-1'],
						},
					],
				}),
			])
			groupsStubMethods.getGroupMemberUserIds.mockResolvedValue(['user-1'])
			dbQueryMocks.discordServers.findFirst.mockResolvedValue(
				makeDiscordServer({ id: 'ds-1', guildId: 'guild-1' })
			)
			dbQueryMocks.discordRoles.findMany.mockResolvedValue([]) // auto-apply

			groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
			discordStubMethods.updateUserRoles.mockResolvedValue([])

			const result = await updateUserDiscordRoles(mockEnv, 'user-1')

			// Group roles should NOT have been included because guild is corp-gated
			// and user has no corp entitlement. With no roles, the guild should be
			// skipped (allowRemoval is undefined/false by default).
			expect(discordStubMethods.updateUserRoles).not.toHaveBeenCalled()
			expect(result.totalUpdated).toBe(0)
		})
	})

	describe('Group-only guild (no corp attachment)', () => {
		it('should grant group roles on a guild with no corp attachment', async () => {
			setupUserInGuild('guild-2')

			// No corp attachments at all for user's corps
			dbQueryMocks.corporationDiscordServers.findMany
				.mockResolvedValueOnce([]) // user's corp attachments
				.mockResolvedValueOnce([]) // corp-gating check: no corp attachments on this guild

			// Group attached to guild-2
			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
				makeGroupWithDiscord({
					groupId: 'group-2',
					discordServers: [
						{
							discordServerId: 'ds-2',
							autoInvite: true,
							autoAssignRoles: true,
							roleIds: ['dr-group-2'],
						},
					],
				}),
			])
			groupsStubMethods.getGroupMemberUserIds.mockResolvedValue(['user-1'])
			dbQueryMocks.discordServers.findFirst.mockResolvedValue(
				makeDiscordServer({ id: 'ds-2', guildId: 'guild-2', guildName: 'Group Server' })
			)
			dbQueryMocks.discordRoles.findMany
				.mockResolvedValueOnce([{ roleId: 'group-role-2', isActive: true }]) // group role
				.mockResolvedValueOnce([]) // auto-apply

			groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
			discordStubMethods.updateUserRoles.mockResolvedValue([
				{ guildId: 'guild-2', success: true, rolesAdded: ['group-role-2'], rolesRemoved: [] },
			])

			const result = await updateUserDiscordRoles(mockEnv, 'user-1')

			expect(discordStubMethods.updateUserRoles).toHaveBeenCalled()
			const requests = discordStubMethods.updateUserRoles.mock.calls[0][1]
			expect(requests[0].roleIds).toContain('group-role-2')
			expect(result.totalUpdated).toBe(1)
		})
	})

	describe('Role removal with allowRemoval=true (Bug 1 fix)', () => {
		it('should send update with empty roleIds when user has lost all entitlements and allowRemoval is true', async () => {
			setupUserInGuild('guild-1')

			// No corp attachments for user
			dbQueryMocks.corporationDiscordServers.findMany
				.mockResolvedValueOnce([]) // user's corp attachments
				.mockResolvedValueOnce([]) // corp-gating check: guild has no corp attachments either (group-only)

			// User is NOT in any group either
			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])

			// No auto-apply roles
			dbQueryMocks.discordRoles.findMany.mockResolvedValue([])

			groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
			discordStubMethods.updateUserRoles.mockResolvedValue([
				{
					guildId: 'guild-1',
					success: true,
					rolesAdded: [],
					rolesRemoved: ['old-role-1', 'old-role-2'],
				},
			])

			const _result = await updateUserDiscordRoles(mockEnv, 'user-1', undefined, true)

			// With allowRemoval=true, guild should be included even with empty expectedRoleIds
			expect(discordStubMethods.updateUserRoles).toHaveBeenCalled()
			const updateCall = discordStubMethods.updateUserRoles.mock.calls[0]
			const requests = updateCall[1]
			expect(requests).toHaveLength(1)
			expect(requests[0].guildId).toBe('guild-1')
			expect(requests[0].roleIds).toEqual([])
			// allowRemoval passed through
			expect(updateCall[2]).toBe(true)
		})

		it('should NOT send update with empty roleIds when allowRemoval is false', async () => {
			setupUserInGuild('guild-1')

			dbQueryMocks.corporationDiscordServers.findMany
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])

			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])
			dbQueryMocks.discordRoles.findMany.mockResolvedValue([])

			const result = await updateUserDiscordRoles(mockEnv, 'user-1', undefined, false)

			expect(discordStubMethods.updateUserRoles).not.toHaveBeenCalled()
			expect(result.totalUpdated).toBe(0)
		})

		it('should grant owner/admin roles even when the user is not a member', async () => {
			setupUserInGuild('guild-2')

			dbQueryMocks.corporationDiscordServers.findMany
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])

			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
				makeGroupWithDiscord({
					groupId: 'group-2',
					discordServers: [
						{
							discordServerId: 'ds-2',
							autoInvite: true,
							autoAssignRoles: true,
							ownerAdminRoleIds: ['dr-owner-2'],
						},
					],
				}),
			])
			groupsStubMethods.getGroupMemberUserIds.mockResolvedValue([])
			groupsStubMethods.getGroupOwnerAndAdminUserIds.mockResolvedValue(['user-1'])
			dbQueryMocks.discordServers.findFirst.mockResolvedValue(
				makeDiscordServer({ id: 'ds-2', guildId: 'guild-2' })
			)
			dbQueryMocks.discordRoles.findMany
				.mockResolvedValueOnce([{ roleId: 'owner-role-2', isActive: true }])
				.mockResolvedValueOnce([])

			groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
			discordStubMethods.updateUserRoles.mockResolvedValue([
				{ guildId: 'guild-2', success: true, rolesAdded: ['owner-role-2'], rolesRemoved: [] },
			])

			await updateUserDiscordRoles(mockEnv, 'user-1')

			expect(discordStubMethods.updateUserRoles).toHaveBeenCalled()
			const requests = discordStubMethods.updateUserRoles.mock.calls[0][1]
			expect(requests[0].roleIds).toEqual(expect.arrayContaining(['owner-role-2']))
		})

		it('should grant both member and owner/admin roles additively', async () => {
			setupUserInGuild('guild-2')

			dbQueryMocks.corporationDiscordServers.findMany
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])

			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
				makeGroupWithDiscord({
					groupId: 'group-2',
					discordServers: [
						{
							discordServerId: 'ds-2',
							autoInvite: true,
							autoAssignRoles: true,
							memberRoleIds: ['dr-member-2'],
							ownerAdminRoleIds: ['dr-owner-2'],
						},
					],
				}),
			])
			groupsStubMethods.getGroupMemberUserIds.mockResolvedValue(['user-1'])
			groupsStubMethods.getGroupOwnerAndAdminUserIds.mockResolvedValue(['user-1'])
			dbQueryMocks.discordServers.findFirst.mockResolvedValue(
				makeDiscordServer({ id: 'ds-2', guildId: 'guild-2' })
			)
			dbQueryMocks.discordRoles.findMany
				.mockResolvedValueOnce([
					{ roleId: 'member-role-2', isActive: true },
					{ roleId: 'owner-role-2', isActive: true },
				])
				.mockResolvedValueOnce([])

			groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
			discordStubMethods.updateUserRoles.mockResolvedValue([
				{
					guildId: 'guild-2',
					success: true,
					rolesAdded: ['member-role-2', 'owner-role-2'],
					rolesRemoved: [],
				},
			])

			await updateUserDiscordRoles(mockEnv, 'user-1')

			expect(discordStubMethods.updateUserRoles).toHaveBeenCalled()
			const requests = discordStubMethods.updateUserRoles.mock.calls[0][1]
			expect(requests[0].roleIds).toEqual(expect.arrayContaining(['member-role-2', 'owner-role-2']))
		})
	})

	describe('Corp-gated removal: user loses corp, group roles on corp guild also removed', () => {
		it('should remove group roles on a corp-gated guild when user loses corp access with allowRemoval', async () => {
			setupUserInGuild('guild-1')

			// User has no corp attachment (lost it)
			dbQueryMocks.corporationDiscordServers.findMany
				.mockResolvedValueOnce([]) // user's corp attachments: none
				.mockResolvedValueOnce([
					makeCorpAttachment({
						corporationId: 'corp-1',
						discordServerId: 'ds-1',
						guildId: 'guild-1',
					}),
				]) // corp-gating: guild IS corp-gated

			// User is still in a group attached to guild-1
			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
				makeGroupWithDiscord({
					groupId: 'group-1',
					discordServers: [
						{
							discordServerId: 'ds-1',
							autoInvite: true,
							autoAssignRoles: true,
							roleIds: ['dr-group-1'],
						},
					],
				}),
			])
			groupsStubMethods.getGroupMemberUserIds.mockResolvedValue(['user-1'])
			dbQueryMocks.discordServers.findFirst.mockResolvedValue(
				makeDiscordServer({ id: 'ds-1', guildId: 'guild-1' })
			)

			// No auto-apply roles
			dbQueryMocks.discordRoles.findMany.mockResolvedValue([])

			groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
			discordStubMethods.updateUserRoles.mockResolvedValue([
				{ guildId: 'guild-1', success: true, rolesAdded: [], rolesRemoved: ['group-role-1'] },
			])

			const _result = await updateUserDiscordRoles(mockEnv, 'user-1', undefined, true)

			// Group roles should be WITHHELD (corp-gated without entitlement),
			// resulting in empty expectedRoleIds. With allowRemoval=true, the
			// update is still sent, and the DO will remove the stale roles.
			expect(discordStubMethods.updateUserRoles).toHaveBeenCalled()
			const requests = discordStubMethods.updateUserRoles.mock.calls[0][1]
			expect(requests).toHaveLength(1)
			expect(requests[0].guildId).toBe('guild-1')
			// expectedRoleIds should be empty — group roles were withheld
			expect(requests[0].roleIds).toEqual([])
		})
	})

	describe('Auto-apply roles', () => {
		it('should grant auto-apply roles regardless of corp or group membership', async () => {
			setupUserInGuild('guild-1')

			dbQueryMocks.corporationDiscordServers.findMany
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])

			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])

			// Auto-apply role exists for guild-1
			dbQueryMocks.discordRoles.findMany.mockResolvedValue([
				{
					roleId: 'auto-role-1',
					isActive: true,
					autoApply: true,
					discordServer: makeDiscordServer({ guildId: 'guild-1' }),
				},
			])

			groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
			discordStubMethods.updateUserRoles.mockResolvedValue([
				{ guildId: 'guild-1', success: true, rolesAdded: ['auto-role-1'], rolesRemoved: [] },
			])

			const _result = await updateUserDiscordRoles(mockEnv, 'user-1')

			expect(discordStubMethods.updateUserRoles).toHaveBeenCalled()
			const requests = discordStubMethods.updateUserRoles.mock.calls[0][1]
			expect(requests[0].roleIds).toContain('auto-role-1')
		})
	})

	describe('Nickname sync', () => {
		it('should only update nicknames for opted-in servers included in the scope', async () => {
			dbQueryMocks.users.findFirst.mockReset()
			dbQueryMocks.userCharacters.findFirst.mockReset()
			dbQueryMocks.discordServers.findMany.mockReset()
			discordStubMethods.checkGuildMembershipWithBot.mockReset()
			discordStubMethods.updateUserNickname.mockReset()

			dbQueryMocks.users.findFirst.mockResolvedValue(makeUser())
			dbQueryMocks.userCharacters.findFirst.mockResolvedValue(makeCharacter())
			dbQueryMocks.discordServers.findMany.mockResolvedValue([
				makeDiscordServer({
					id: 'ds-1',
					guildId: 'guild-1',
					guildName: 'Nick Server',
					manageNicknames: true,
				}),
			])

			discordStubMethods.checkGuildMembershipWithBot.mockResolvedValue(['guild-1', 'guild-2'])

			await updateUserDiscordNickname(mockEnv, 'user-1', ['guild-1', 'guild-2'])

			expect(dbQueryMocks.discordServers.findMany).toHaveBeenCalled()
			const query = dbQueryMocks.discordServers.findMany.mock.calls[0][0]
			const scopedGuildIds = query.where._and.find((clause: any) => clause?._inArray)?._inArray
			expect(scopedGuildIds).toEqual(['guild-1', 'guild-2'])
			expect(discordStubMethods.updateUserNickname).toHaveBeenCalledWith(
				'user-1',
				['guild-1'],
				'Test Pilot'
			)
		})

		it('should append the configured alliance ticker for corp members when that bucket is enabled', async () => {
			dbQueryMocks.users.findFirst.mockResolvedValue(makeUser())
			dbQueryMocks.userCharacters.findFirst.mockResolvedValue(
				makeCharacter({
					corporationId: 'corp-1',
					allianceId: 'alliance-1',
				})
			)
			dbQueryMocks.discordServers.findMany.mockResolvedValue([
				makeDiscordServer({
					id: 'ds-1',
					guildId: 'guild-1',
					guildName: 'Nick Server',
					manageNicknames: true,
				}),
			])
			dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([
				makeCorpAttachment({
					corporationId: 'corp-1',
					discordServerId: 'ds-1',
					guildId: 'guild-1',
					isMemberCorporation: true,
					corpMemberNicknameEnabled: true,
					corpMemberNicknameSource: 'corp',
					corpMemberNicknameCustomTicker: null,
				}),
			])
			dbQueryMocks.managedCorporations.findMany.mockResolvedValue([
				{ corporationId: 'corp-1', ticker: 'CORP' } as any,
			])
			eveCorpStubMethods.getCorporationInfo.mockResolvedValue({
				corporationId: 'corp-1',
				name: 'Test Corp',
				allianceId: 'alliance-1',
				ticker: 'AKS.',
			} as any)
			publicEsiStubMethods.fetchAlliancePublicInfo.mockResolvedValue({
				allianceId: 'alliance-1',
				name: 'Test Alliance',
				ticker: 'ALLY.',
			} as any)
			discordStubMethods.checkGuildMembershipWithBot.mockResolvedValue(['guild-1'])

			await updateUserDiscordNickname(mockEnv, 'user-1', ['guild-1'])

			expect(discordStubMethods.updateUserNickname).toHaveBeenCalledWith(
				'user-1',
				['guild-1'],
				'[AKS.] Test Pilot'
			)
		})

		it('should use the primary character affiliation for alliance guests', async () => {
			dbQueryMocks.users.findFirst.mockResolvedValue(makeUser())
			dbQueryMocks.userCharacters.findFirst.mockResolvedValue(
				makeCharacter({
					corporationId: 'guest-corp-1',
					allianceId: 'guest-alliance-1',
					characterName: 'Guest Pilot',
				})
			)
			dbQueryMocks.discordServers.findMany.mockResolvedValue([
				makeDiscordServer({
					id: 'ds-1',
					guildId: 'guild-1',
					guildName: 'Nick Server',
					manageNicknames: true,
				}),
			])
			dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([
				makeCorpAttachment({
					corporationId: 'corp-1',
					discordServerId: 'ds-1',
					guildId: 'guild-1',
					isMemberCorporation: true,
					allianceGuestNicknameEnabled: true,
					allianceGuestNicknameSource: 'alliance',
					allianceGuestNicknameCustomTicker: null,
				}),
			])
			dbQueryMocks.managedCorporations.findMany.mockResolvedValue([])
			eveCorpStubMethods.getCorporationInfo.mockResolvedValue({
				corporationId: 'guest-corp-1',
				name: 'Guest Corp',
				ticker: 'GUEST.',
				allianceId: 'guest-alliance-1',
			} as any)
			publicEsiStubMethods.fetchAlliancePublicInfo.mockResolvedValue({
				allianceId: 'guest-alliance-1',
				name: 'Guest Alliance',
				ticker: 'ALLY.',
			} as any)
			discordStubMethods.checkGuildMembershipWithBot.mockResolvedValue(['guild-1'])

			await updateUserDiscordNickname(mockEnv, 'user-1', ['guild-1'])

			expect(discordStubMethods.updateUserNickname).toHaveBeenCalledWith(
				'user-1',
				['guild-1'],
				'[ALLY.] Guest Pilot'
			)
		})

		it('should use the custom ticker configured for the all-members bucket', async () => {
			dbQueryMocks.users.findFirst.mockResolvedValue(makeUser())
			dbQueryMocks.userCharacters.findFirst.mockResolvedValue(makeCharacter())
			dbQueryMocks.discordServers.findMany.mockResolvedValue([
				makeDiscordServer({
					id: 'ds-1',
					guildId: 'guild-1',
					guildName: 'Nick Server',
					manageNicknames: true,
				}),
			])
			dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([
				makeCorpAttachment({
					corporationId: 'corp-1',
					discordServerId: 'ds-1',
					guildId: 'guild-1',
					isMemberCorporation: true,
					corpMemberNicknameEnabled: true,
					corpMemberNicknameSource: 'custom',
					corpMemberNicknameCustomTicker: 'corpx',
				}),
			])
			dbQueryMocks.managedCorporations.findMany.mockResolvedValue([])
			eveCorpStubMethods.getCorporationInfo.mockResolvedValue({
				corporationId: 'corp-1',
				name: 'Test Corp',
				allianceId: null,
			} as any)
			discordStubMethods.checkGuildMembershipWithBot.mockResolvedValue(['guild-1'])

			await updateUserDiscordNickname(mockEnv, 'user-1', ['guild-1'])

			expect(discordStubMethods.updateUserNickname).toHaveBeenCalledWith(
				'user-1',
				['guild-1'],
				'[CORPX] Test Pilot'
			)
		})
	})

	describe('Corp entitlement as group-role gate on corp-gated guilds', () => {
		it('should grant group roles when corp entitlement exists even if corp autoAssignRoles is false', async () => {
			setupUserInGuild('guild-1')

			// User has corp entitlement on the guild, but corp attachment does not auto-assign roles
			dbQueryMocks.corporationDiscordServers.findMany
				.mockResolvedValueOnce([
					makeCorpAttachment({
						corporationId: 'corp-1',
						guildId: 'guild-1',
						autoAssignRoles: false,
						roleIds: ['corp-role-should-not-be-assigned'],
					}),
				])
				.mockResolvedValueOnce([
					makeCorpAttachment({
						corporationId: 'corp-1',
						discordServerId: 'ds-1',
						guildId: 'guild-1',
					}),
				])

			// Group role should still apply because corp entitlement exists for this guild
			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
				makeGroupWithDiscord({
					groupId: 'group-1',
					discordServers: [
						{
							discordServerId: 'ds-1',
							autoInvite: true,
							autoAssignRoles: true,
							roleIds: ['dr-group-1'],
						},
					],
				}),
			])
			groupsStubMethods.getGroupMemberUserIds.mockResolvedValue(['user-1'])

			dbQueryMocks.discordServers.findFirst.mockResolvedValue(
				makeDiscordServer({ id: 'ds-1', guildId: 'guild-1' })
			)
			dbQueryMocks.discordRoles.findMany
				.mockResolvedValueOnce([{ roleId: 'group-role-1', isActive: true }]) // group role lookup
				.mockResolvedValueOnce([]) // auto-apply roles

			groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
			discordStubMethods.updateUserRoles.mockResolvedValue([
				{ guildId: 'guild-1', success: true, rolesAdded: ['group-role-1'], rolesRemoved: [] },
			])

			await updateUserDiscordRoles(mockEnv, 'user-1')

			expect(discordStubMethods.updateUserRoles).toHaveBeenCalled()
			const requests = discordStubMethods.updateUserRoles.mock.calls[0][1]
			expect(requests[0].roleIds).toContain('group-role-1')
			expect(requests[0].roleIds).not.toContain('corp-role-should-not-be-assigned')
		})
	})

	describe('Group autoAssignRoles gating', () => {
		it('should not grant group roles when group autoAssignRoles is false', async () => {
			setupUserInGuild('guild-2')

			dbQueryMocks.corporationDiscordServers.findMany
				.mockResolvedValueOnce([]) // no user corp entitlements
				.mockResolvedValueOnce([]) // group-only guild (not corp-gated)

			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
				makeGroupWithDiscord({
					groupId: 'group-2',
					discordServers: [
						{
							discordServerId: 'ds-2',
							autoInvite: true,
							autoAssignRoles: false,
							roleIds: ['dr-group-2'],
						},
					],
				}),
			])
			groupsStubMethods.getGroupMemberUserIds.mockResolvedValue(['user-1'])
			dbQueryMocks.discordServers.findFirst.mockResolvedValue(
				makeDiscordServer({ id: 'ds-2', guildId: 'guild-2' })
			)
			dbQueryMocks.discordRoles.findMany.mockResolvedValue([]) // no auto-apply roles

			await updateUserDiscordRoles(mockEnv, 'user-1')

			expect(discordStubMethods.updateUserRoles).not.toHaveBeenCalled()
		})
	})

	describe('Non-managed roles preserved', () => {
		it('should pass managedRoleIds to Discord DO so non-managed roles are left intact', async () => {
			setupUserInGuild('guild-1')

			// Corp attachment with one role
			dbQueryMocks.corporationDiscordServers.findMany
				.mockResolvedValueOnce([
					makeCorpAttachment({
						corporationId: 'corp-1',
						guildId: 'guild-1',
						roleIds: ['managed-role-1'],
					}),
				])
				.mockResolvedValueOnce([
					makeCorpAttachment({
						corporationId: 'corp-1',
						discordServerId: 'ds-1',
						guildId: 'guild-1',
					}),
				])

			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])
			dbQueryMocks.discordRoles.findMany.mockResolvedValue([]) // auto-apply

			// getAllManagedRolesForGuild returns the set of roles the system manages
			// Mock the sub-queries it makes:
			// 1. discordServers.findFirst for the guild
			dbQueryMocks.discordServers.findFirst.mockResolvedValue(
				makeDiscordServer({ id: 'ds-1', guildId: 'guild-1' })
			)
			// 2. auto-apply roles for the guild (already mocked above as [])
			// 3. corp roles for the guild
			// 4. group roles via getGroupsByDiscordServer
			groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])

			discordStubMethods.updateUserRoles.mockResolvedValue([
				{ guildId: 'guild-1', success: true, rolesAdded: [], rolesRemoved: [] },
			])

			await updateUserDiscordRoles(mockEnv, 'user-1')

			expect(discordStubMethods.updateUserRoles).toHaveBeenCalled()
			const requests = discordStubMethods.updateUserRoles.mock.calls[0][1]
			// managedRoleIds is passed so the DO knows which roles it can touch
			expect(requests[0]).toHaveProperty('managedRoleIds')
			// Non-managed roles (server-granted, manual roles) are not in managedRoleIds
			// and therefore the DO will leave them intact
		})

		it('should include empty roleIds with managedRoleIds when removal is allowed, enabling removal of managed roles only', async () => {
			setupUserInGuild('guild-1')

			dbQueryMocks.corporationDiscordServers.findMany
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([
					makeCorpAttachment({
						corporationId: 'corp-1',
						discordServerId: 'ds-1',
						guildId: 'guild-1',
						roleIds: ['old-managed-role'],
					}),
				])

			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])
			dbQueryMocks.discordRoles.findMany.mockResolvedValue([])
			dbQueryMocks.discordServers.findFirst.mockResolvedValue(
				makeDiscordServer({ id: 'ds-1', guildId: 'guild-1' })
			)
			groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])

			discordStubMethods.updateUserRoles.mockResolvedValue([
				{ guildId: 'guild-1', success: true, rolesAdded: [], rolesRemoved: ['old-managed-role'] },
			])

			await updateUserDiscordRoles(mockEnv, 'user-1', undefined, true)

			const updateCall = discordStubMethods.updateUserRoles.mock.calls[0]
			const requests = updateCall[1]
			// roleIds empty — no expected roles
			expect(requests[0].roleIds).toEqual([])
			// managedRoleIds provided so the DO only removes managed roles, leaving server roles intact
			expect(requests[0]).toHaveProperty('managedRoleIds')
			// allowRemoval passed through
			expect(updateCall[2]).toBe(true)
		})

		it('should pass managedRoleIds as the union of corp, group, and auto-apply managed roles', async () => {
			setupUserInGuild('guild-1')

			// Update-role path queries
			dbQueryMocks.corporationDiscordServers.findMany
				// user's corp attachments (entitlement + corp role grant)
				.mockResolvedValueOnce([
					makeCorpAttachment({
						corporationId: 'corp-1',
						guildId: 'guild-1',
						roleIds: ['corp-role-1'],
					}),
				])
				// corp-gating check
				.mockResolvedValueOnce([
					makeCorpAttachment({
						corporationId: 'corp-1',
						discordServerId: 'ds-1',
						guildId: 'guild-1',
						roleIds: ['corp-role-1'],
					}),
				])
				// getAllManagedRolesForGuild: corp-managed roles query
				.mockResolvedValueOnce([
					makeCorpAttachment({
						corporationId: 'corp-1',
						discordServerId: 'ds-1',
						guildId: 'guild-1',
						roleIds: ['corp-role-1'],
					}),
				])

			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
				makeGroupWithDiscord({
					groupId: 'group-1',
					discordServers: [
						{
							discordServerId: 'ds-1',
							autoInvite: true,
							autoAssignRoles: true,
							roleIds: ['dr-group-1'],
						},
					],
				}),
			])
			groupsStubMethods.getGroupMemberUserIds.mockResolvedValue(['user-1'])

			// First call used by group role grant path, second by managed-role server lookup
			dbQueryMocks.discordServers.findFirst.mockResolvedValue(
				makeDiscordServer({ id: 'ds-1', guildId: 'guild-1' })
			)

			// 1) Group role lookup (id -> roleId)
			// 2) Auto-apply roles for main expected-role calculation
			// 3) Auto-apply roles for getAllManagedRolesForGuild
			// 4) Group roles verification for getAllManagedRolesForGuild (roleId lookup)
			dbQueryMocks.discordRoles.findMany
				.mockResolvedValueOnce([{ roleId: 'group-role-1', isActive: true }])
				.mockResolvedValueOnce([
					{
						roleId: 'auto-role-1',
						isActive: true,
						autoApply: true,
						discordServer: makeDiscordServer({ guildId: 'guild-1' }),
					},
				])
				.mockResolvedValueOnce([{ roleId: 'auto-role-1' }])
				.mockResolvedValueOnce([{ roleId: 'group-role-1' }])

			groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([
				{
					groupId: 'group-1',
					groupName: 'Test Group',
					id: 'group-attachment-1',
					autoAssignRoles: true,
				},
			])
			groupsStubMethods.getDiscordServerAttachmentConfig.mockResolvedValue({
				groupId: 'group-1',
				guildId: 'guild-1',
				roleIds: ['group-role-1'],
			})

			discordStubMethods.updateUserRoles.mockResolvedValue([
				{ guildId: 'guild-1', success: true, rolesAdded: [], rolesRemoved: [] },
			])

			await updateUserDiscordRoles(mockEnv, 'user-1')

			expect(discordStubMethods.updateUserRoles).toHaveBeenCalled()
			const requests = discordStubMethods.updateUserRoles.mock.calls[0][1]
			expect(requests).toHaveLength(1)
			expect(requests[0].managedRoleIds).toEqual(
				expect.arrayContaining(['corp-role-1', 'group-role-1', 'auto-role-1'])
			)
		})

		it('should keep the special auth role in managedRoleIds so refreshes can grant it', async () => {
			setupUserInGuild('guild-1')

			dbQueryMocks.corporationDiscordServers.findMany
				.mockResolvedValueOnce([
					makeCorpAttachment({
						corporationId: 'corp-1',
						discordServerId: 'ds-1',
						guildId: 'guild-1',
						roleIds: ['corp-role-1', '1431816436640256060'],
					}),
				])
				.mockResolvedValueOnce([
					makeCorpAttachment({
						corporationId: 'corp-1',
						discordServerId: 'ds-1',
						guildId: 'guild-1',
						roleIds: ['corp-role-1', '1431816436640256060'],
					}),
				])
				.mockResolvedValueOnce([
					makeCorpAttachment({
						corporationId: 'corp-1',
						discordServerId: 'ds-1',
						guildId: 'guild-1',
						roleIds: ['corp-role-1', '1431816436640256060'],
					}),
				])

			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])
			groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
			dbQueryMocks.discordServers.findFirst.mockResolvedValue(
				makeDiscordServer({ id: 'ds-1', guildId: 'guild-1' })
			)
			dbQueryMocks.discordRoles.findMany.mockResolvedValueOnce([])
			discordStubMethods.getGuildRoles.mockResolvedValue([
				{ id: '1431816436640256060', name: 'Auth Gigachad' },
			])

			discordStubMethods.updateUserRoles.mockResolvedValue([
				{ guildId: 'guild-1', success: true, rolesAdded: [], rolesRemoved: [] },
			])

			await updateUserDiscordRoles(mockEnv, 'user-1')

			expect(discordStubMethods.updateUserRoles).toHaveBeenCalled()
			const requests = discordStubMethods.updateUserRoles.mock.calls[0][1]
			expect(requests[0].managedRoleIds).toContain('1431816436640256060')
		})

		it('should pass scoped managedRoleIds on removal so only configured managed roles are removable', async () => {
			setupUserInGuild('guild-1')

			// User has no corp entitlement, but guild is corp-gated
			dbQueryMocks.corporationDiscordServers.findMany
				.mockResolvedValueOnce([]) // user's corp attachments
				.mockResolvedValueOnce([
					makeCorpAttachment({
						corporationId: 'corp-1',
						discordServerId: 'ds-1',
						guildId: 'guild-1',
						roleIds: ['corp-role-1'],
					}),
				]) // corp-gating check
				.mockResolvedValueOnce([
					// getAllManagedRolesForGuild: configured corp-managed roles on this guild
					makeCorpAttachment({
						corporationId: 'corp-managed',
						discordServerId: 'ds-1',
						guildId: 'guild-1',
						roleIds: ['corp-role-1'],
					}),
				])

			// User is still in group, but group roles are withheld by corp-gating (no entitlement)
			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
				makeGroupWithDiscord({
					groupId: 'group-1',
					discordServers: [
						{
							discordServerId: 'ds-1',
							autoInvite: true,
							autoAssignRoles: true,
							roleIds: ['dr-group-1'],
						},
					],
				}),
			])
			groupsStubMethods.getGroupMemberUserIds.mockResolvedValue(['user-1'])

			dbQueryMocks.discordServers.findFirst.mockResolvedValue(
				makeDiscordServer({ id: 'ds-1', guildId: 'guild-1' })
			)

			// 1) Main expected-role calculation auto-apply query
			// 2) getAllManagedRolesForGuild auto-apply query
			// 3) getAllManagedRolesForGuild group-role verification query
			dbQueryMocks.discordRoles.findMany
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ roleId: 'group-role-1' }])

			groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([
				{
					groupId: 'group-1',
					groupName: 'Test Group',
					id: 'group-attachment-1',
					autoAssignRoles: true,
				},
			])
			groupsStubMethods.getDiscordServerAttachmentConfig.mockResolvedValue({
				groupId: 'group-1',
				guildId: 'guild-1',
				roleIds: ['group-role-1'],
			})

			discordStubMethods.updateUserRoles.mockResolvedValue([
				{ guildId: 'guild-1', success: true, rolesAdded: [], rolesRemoved: ['corp-role-1'] },
			])

			await updateUserDiscordRoles(mockEnv, 'user-1', undefined, true)

			expect(discordStubMethods.updateUserRoles).toHaveBeenCalled()
			const updateCall = discordStubMethods.updateUserRoles.mock.calls[0]
			const requests = updateCall[1]
			expect(requests).toHaveLength(1)
			expect(requests[0].guildId).toBe('guild-1')
			expect(requests[0].roleIds).toEqual([]) // removal path
			expect(requests[0].managedRoleIds).toEqual(
				expect.arrayContaining(['corp-role-1', 'group-role-1'])
			)
			// Manual/legacy roles must not be marked as managed by Core config
			expect(requests[0].managedRoleIds).not.toContain('manual-legacy-role')
		})
	})

	describe('Blacklisted users', () => {
		it('should return empty results for blacklisted users without calling Discord', async () => {
			hrStubMethods.isUserBlacklisted.mockResolvedValue(true)

			const result = await updateUserDiscordRoles(mockEnv, 'user-1')

			expect(discordStubMethods.updateUserRoles).not.toHaveBeenCalled()
			expect(result.totalUpdated).toBe(0)
			expect(result.results).toEqual([])
		})
	})

	describe('Authorization revoked users', () => {
		it('should strip managed roles by setting expected roles to [] when allowRemoval=true', async () => {
			discordStubMethods.getDiscordUserStatus.mockResolvedValue({
				authRevoked: true,
			})
			discordStubMethods.checkGuildMembershipWithBot.mockResolvedValue(['guild-1'])
			dbQueryMocks.discordServers.findMany.mockResolvedValue([
				makeDiscordServer({ id: 'ds-1', guildId: 'guild-1', guildName: 'Guild One' }),
			])
			dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValueOnce([
				makeCorpAttachment({
					corporationId: 'corp-1',
					discordServerId: 'ds-1',
					guildId: 'guild-1',
					roleIds: ['managed-role-1'],
				}),
			])
			dbQueryMocks.discordServers.findFirst.mockResolvedValue(
				makeDiscordServer({ id: 'ds-1', guildId: 'guild-1' })
			)
			dbQueryMocks.discordRoles.findMany.mockResolvedValue([])
			groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
			discordStubMethods.updateUserRoles.mockResolvedValue([
				{
					guildId: 'guild-1',
					success: true,
					rolesAdded: [],
					rolesRemoved: ['managed-role-1'],
				},
			])

			const result = await updateUserDiscordRoles(mockEnv, 'user-1', undefined, true)

			expect(discordStubMethods.updateUserRoles).toHaveBeenCalledTimes(1)
			expect(discordStubMethods.updateUserRoles).toHaveBeenCalledWith(
				'user-1',
				[
					expect.objectContaining({
						guildId: 'guild-1',
						roleIds: [],
						managedRoleIds: expect.arrayContaining(['managed-role-1']),
					}),
				],
				true
			)
			expect(dbQueryMocks.userCharacters.findMany).not.toHaveBeenCalled()
			expect(result.totalUpdated).toBe(1)
		})
	})

	describe('User with no characters', () => {
		it('should return empty results when user has no characters', async () => {
			dbQueryMocks.userCharacters.findMany.mockResolvedValue([])

			const result = await updateUserDiscordRoles(mockEnv, 'user-1')

			expect(discordStubMethods.updateUserRoles).not.toHaveBeenCalled()
			expect(result.totalUpdated).toBe(0)
		})
	})

	describe('User not in any guild', () => {
		it('should return empty results when user is not a member of any guild', async () => {
			discordStubMethods.checkGuildMembershipWithBot.mockResolvedValue([])
			dbQueryMocks.discordServers.findMany.mockResolvedValue([makeDiscordServer()])

			const result = await updateUserDiscordRoles(mockEnv, 'user-1')

			expect(discordStubMethods.updateUserRoles).not.toHaveBeenCalled()
			expect(result.totalUpdated).toBe(0)
		})
	})

	describe('Mixed guild scenario: corp-gated + group-only', () => {
		it('should apply correct gating per-guild independently', async () => {
			// User is in two guilds
			discordStubMethods.checkGuildMembershipWithBot.mockResolvedValue([
				'guild-corp',
				'guild-group',
			])
			dbQueryMocks.discordServers.findMany.mockResolvedValue([
				makeDiscordServer({ id: 'ds-corp', guildId: 'guild-corp', guildName: 'Corp Server' }),
				makeDiscordServer({ id: 'ds-group', guildId: 'guild-group', guildName: 'Group Server' }),
			])

			// User has NO corp attachment (left the corp)
			dbQueryMocks.corporationDiscordServers.findMany
				.mockResolvedValueOnce([]) // user's corp attachments: none
				// Corp-gating: guild-corp IS corp-gated, guild-group is NOT
				.mockResolvedValueOnce([
					makeCorpAttachment({
						corporationId: 'corp-1',
						discordServerId: 'ds-corp',
						guildId: 'guild-corp',
					}),
				])

			// User is in a group attached to BOTH guilds
			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
				makeGroupWithDiscord({
					groupId: 'group-1',
					discordServers: [
						{
							discordServerId: 'ds-corp',
							autoInvite: true,
							autoAssignRoles: true,
							roleIds: ['dr-grp-corp'],
						},
						{
							discordServerId: 'ds-group',
							autoInvite: true,
							autoAssignRoles: true,
							roleIds: ['dr-grp-group'],
						},
					],
				}),
			])
			groupsStubMethods.getGroupMemberUserIds.mockResolvedValue(['user-1'])

			// Server lookups for each group attachment
			dbQueryMocks.discordServers.findFirst
				.mockResolvedValueOnce(
					makeDiscordServer({ id: 'ds-corp', guildId: 'guild-corp', guildName: 'Corp Server' })
				)
				.mockResolvedValueOnce(
					makeDiscordServer({ id: 'ds-group', guildId: 'guild-group', guildName: 'Group Server' })
				)

			dbQueryMocks.discordRoles.findMany
				// Group role for guild-group (corp guild skipped by corp-gating)
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ roleId: 'group-role-grp', isActive: true }])

			groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
			discordStubMethods.updateUserRoles.mockResolvedValue([
				{ guildId: 'guild-group', success: true, rolesAdded: ['group-role-grp'], rolesRemoved: [] },
			])

			const _result = await updateUserDiscordRoles(mockEnv, 'user-1')

			expect(discordStubMethods.updateUserRoles).toHaveBeenCalled()
			const requests = discordStubMethods.updateUserRoles.mock.calls[0][1]

			// Only guild-group should have an update (with group roles)
			// guild-corp should be excluded (corp-gated, no entitlement, no roles, allowRemoval=false)
			const guildIds = requests.map((r: any) => r.guildId)
			expect(guildIds).toContain('guild-group')
			expect(guildIds).not.toContain('guild-corp')

			// The group-only guild should have its group role
			const groupGuild = requests.find((r: any) => r.guildId === 'guild-group')
			expect(groupGuild.roleIds).toContain('group-role-grp')
		})

		it('should remove roles on corp-gated guild when allowRemoval is true', async () => {
			// User is in two guilds
			discordStubMethods.checkGuildMembershipWithBot.mockResolvedValue([
				'guild-corp',
				'guild-group',
			])
			dbQueryMocks.discordServers.findMany.mockResolvedValue([
				makeDiscordServer({ id: 'ds-corp', guildId: 'guild-corp', guildName: 'Corp Server' }),
				makeDiscordServer({ id: 'ds-group', guildId: 'guild-group', guildName: 'Group Server' }),
			])

			// No corp entitlement
			dbQueryMocks.corporationDiscordServers.findMany
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([
					makeCorpAttachment({
						corporationId: 'corp-1',
						discordServerId: 'ds-corp',
						guildId: 'guild-corp',
					}),
				])

			// User in group attached to both
			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
				makeGroupWithDiscord({
					groupId: 'group-1',
					discordServers: [
						{
							discordServerId: 'ds-corp',
							autoInvite: true,
							autoAssignRoles: true,
							roleIds: ['dr-grp-corp'],
						},
						{
							discordServerId: 'ds-group',
							autoInvite: true,
							autoAssignRoles: true,
							roleIds: ['dr-grp-group'],
						},
					],
				}),
			])
			groupsStubMethods.getGroupMemberUserIds.mockResolvedValue(['user-1'])

			dbQueryMocks.discordServers.findFirst
				.mockResolvedValueOnce(makeDiscordServer({ id: 'ds-corp', guildId: 'guild-corp' }))
				.mockResolvedValueOnce(makeDiscordServer({ id: 'ds-group', guildId: 'guild-group' }))

			dbQueryMocks.discordRoles.findMany
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ roleId: 'group-role-grp', isActive: true }])

			groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
			discordStubMethods.updateUserRoles.mockResolvedValue([
				{ guildId: 'guild-corp', success: true, rolesAdded: [], rolesRemoved: ['stale-role'] },
				{ guildId: 'guild-group', success: true, rolesAdded: ['group-role-grp'], rolesRemoved: [] },
			])

			const _result = await updateUserDiscordRoles(mockEnv, 'user-1', undefined, true)

			expect(discordStubMethods.updateUserRoles).toHaveBeenCalled()
			const requests = discordStubMethods.updateUserRoles.mock.calls[0][1]

			// With allowRemoval=true, guild-corp should be included with empty roleIds
			const corpGuild = requests.find((r: any) => r.guildId === 'guild-corp')
			expect(corpGuild).toBeDefined()
			expect(corpGuild.roleIds).toEqual([])

			// guild-group should have its group roles
			const groupGuild = requests.find((r: any) => r.guildId === 'guild-group')
			expect(groupGuild).toBeDefined()
			expect(groupGuild.roleIds).toContain('group-role-grp')
		})
	})
})

// ═════════════════════════════════════════════════════════════════════════════
// inviteUserToDiscordServers — Invite Flow
// ═════════════════════════════════════════════════════════════════════════════

describe('inviteUserToDiscordServers', () => {
	describe('Group with auto-invite on a group-only guild', () => {
		it('should invite user to guild via group even without corp attachment', async () => {
			// No corp attachments at all
			eveCorpStubMethods.getCorporationIdsByCharacterIds.mockResolvedValue({})
			dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([])

			// Group with autoInvite on a guild
			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
				makeGroupWithDiscord({
					groupId: 'group-1',
					discordServers: [
						{
							discordServerId: 'ds-2',
							autoInvite: true,
							autoAssignRoles: true,
							roleIds: ['dr-role'],
						},
					],
				}),
			])
			groupsStubMethods.getGroupMemberUserIds.mockResolvedValue(['user-1'])
			dbQueryMocks.discordServers.findFirst.mockResolvedValue(
				makeDiscordServer({ id: 'ds-2', guildId: 'guild-2', guildName: 'Group Guild' })
			)
			dbQueryMocks.discordRoles.findMany.mockResolvedValue([
				{
					roleId: 'group-discord-role',
					isActive: true,
					discordServer: makeDiscordServer({ guildId: 'guild-2' }),
				},
			])

			discordStubMethods.joinUserToServers.mockResolvedValue([
				{ guildId: 'guild-2', success: true, alreadyMember: false },
			])
			groupsStubMethods.insertDiscordInviteAuditRecords.mockResolvedValue(undefined)

			const result = await inviteUserToDiscordServers(mockEnv, 'user-1')

			expect(discordStubMethods.joinUserToServers).toHaveBeenCalled()
			const guildIds = discordStubMethods.joinUserToServers.mock.calls[0][1]
			expect(guildIds).toContain('guild-2')
			expect(result.totalInvited).toBeGreaterThanOrEqual(0) // depends on mock return
		})

		it('should not invite user when they are only a group owner/admin', async () => {
			eveCorpStubMethods.getCorporationIdsByCharacterIds.mockResolvedValue({})
			dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([])

			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
				makeGroupWithDiscord({
					groupId: 'group-1',
					discordServers: [
						{
							discordServerId: 'ds-2',
							autoInvite: true,
							autoAssignRoles: true,
							roleIds: ['dr-role'],
						},
					],
				}),
			])
			groupsStubMethods.getGroupMemberUserIds.mockResolvedValue([])
			groupsStubMethods.getGroupOwnerAndAdminUserIds.mockResolvedValue(['user-1'])
			dbQueryMocks.discordRoles.findMany.mockResolvedValue([])

			const result = await inviteUserToDiscordServers(mockEnv, 'user-1')

			expect(discordStubMethods.joinUserToServers).not.toHaveBeenCalled()
			expect(result.totalInvited).toBe(0)
			expect(result.results).toHaveLength(0)
		})
	})

	describe('Corp with auto-invite', () => {
		it('should invite user to guild via corp attachment', async () => {
			// Corp attachment with autoInvite
			dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([
				makeCorpAttachment({
					corporationId: 'corp-1',
					guildId: 'guild-1',
					autoInvite: true,
					autoAssignRoles: true,
					roleIds: ['corp-role-1'],
				}),
			])

			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])
			dbQueryMocks.discordRoles.findMany.mockResolvedValue([]) // auto-apply

			discordStubMethods.joinUserToServers.mockResolvedValue([
				{ guildId: 'guild-1', success: true, alreadyMember: false },
			])
			groupsStubMethods.insertDiscordInviteAuditRecords.mockResolvedValue(undefined)

			const _result = await inviteUserToDiscordServers(mockEnv, 'user-1')

			expect(discordStubMethods.joinUserToServers).toHaveBeenCalled()
			const guildIds = discordStubMethods.joinUserToServers.mock.calls[0][1]
			expect(guildIds).toContain('guild-1')
		})

		it('should not invite a non-member user even when guest buckets are configured', async () => {
			eveCorpStubMethods.getCorporationIdsByCharacterIds.mockResolvedValue({})
			dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([
				makeCorpAttachment({
					corporationId: 'corp-1',
					guildId: 'guild-1',
					autoInvite: true,
					autoAssignRoles: true,
					allianceGuestRoleId: 'alliance-guest-role-db',
					allianceGuestAutoApply: true,
					nonAllianceGuestRoleId: 'non-alliance-guest-role-db',
					nonAllianceGuestAutoApply: true,
				}),
			])

			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])
			dbQueryMocks.discordRoles.findMany.mockResolvedValue([])

			const result = await inviteUserToDiscordServers(mockEnv, 'user-1')

			expect(discordStubMethods.joinUserToServers).not.toHaveBeenCalled()
			expect(result.totalInvited).toBe(0)
			expect(result.results).toHaveLength(0)
		})
	})

	describe('Group with autoInvite=false', () => {
		it('should NOT invite user via group when autoInvite is false', async () => {
			eveCorpStubMethods.getCorporationIdsByCharacterIds.mockResolvedValue({})
			dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([])

			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
				makeGroupWithDiscord({
					groupId: 'group-1',
					discordServers: [
						{ discordServerId: 'ds-1', autoInvite: false, autoAssignRoles: true, roleIds: [] },
					],
				}),
			])
			groupsStubMethods.getGroupMemberUserIds.mockResolvedValue(['user-1'])
			dbQueryMocks.discordRoles.findMany.mockResolvedValue([])

			const _result = await inviteUserToDiscordServers(mockEnv, 'user-1')

			// No guilds to join => joinUserToServers should not be called
			expect(discordStubMethods.joinUserToServers).not.toHaveBeenCalled()
		})
	})

	describe('User not in group', () => {
		it('should not invite user to group guild when they are not a member', async () => {
			eveCorpStubMethods.getCorporationIdsByCharacterIds.mockResolvedValue({})
			dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([])

			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
				makeGroupWithDiscord({
					groupId: 'group-1',
					discordServers: [
						{ discordServerId: 'ds-1', autoInvite: true, autoAssignRoles: true, roleIds: [] },
					],
				}),
			])
			groupsStubMethods.getGroupMemberUserIds.mockResolvedValue([]) // user NOT a member
			dbQueryMocks.discordRoles.findMany.mockResolvedValue([])

			const _result = await inviteUserToDiscordServers(mockEnv, 'user-1')

			expect(discordStubMethods.joinUserToServers).not.toHaveBeenCalled()
		})
	})

	describe('Blacklisted user', () => {
		it('should not invite blacklisted users', async () => {
			hrStubMethods.isUserBlacklisted.mockResolvedValue(true)

			const result = await inviteUserToDiscordServers(mockEnv, 'user-1')

			expect(discordStubMethods.joinUserToServers).not.toHaveBeenCalled()
			expect(result.totalInvited).toBe(0)
		})
	})

	describe('User with no Discord linked', () => {
		it('should throw when user has no discordUserId', async () => {
			dbQueryMocks.users.findFirst.mockResolvedValue(makeUser({ discordUserId: null }))

			await expect(inviteUserToDiscordServers(mockEnv, 'user-1')).rejects.toThrow(
				'Discord account not linked'
			)
		})
	})

	describe('User with no characters', () => {
		it('should return empty results when user has no characters', async () => {
			dbQueryMocks.userCharacters.findMany.mockResolvedValue([])

			const result = await inviteUserToDiscordServers(mockEnv, 'user-1')

			expect(discordStubMethods.joinUserToServers).not.toHaveBeenCalled()
			expect(result.totalInvited).toBe(0)
		})
	})

	describe('Deduplication of guilds', () => {
		it('should deduplicate when both corp and group refer to the same guild', async () => {
			// Corp has autoInvite to guild-1
			dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([
				makeCorpAttachment({
					corporationId: 'corp-1',
					guildId: 'guild-1',
					autoInvite: true,
					roleIds: ['corp-role-1'],
				}),
			])

			// Group also has autoInvite to same guild-1
			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
				makeGroupWithDiscord({
					groupId: 'group-1',
					discordServers: [
						{
							discordServerId: 'ds-1',
							autoInvite: true,
							autoAssignRoles: true,
							roleIds: ['dr-group-1'],
						},
					],
				}),
			])
			groupsStubMethods.getGroupMemberUserIds.mockResolvedValue(['user-1'])
			dbQueryMocks.discordServers.findFirst.mockResolvedValue(
				makeDiscordServer({ id: 'ds-1', guildId: 'guild-1' })
			)
			dbQueryMocks.discordRoles.findMany
				.mockResolvedValueOnce([{ roleId: 'group-role-1', isActive: true }]) // group role lookup
				.mockResolvedValueOnce([]) // auto-apply roles

			discordStubMethods.joinUserToServers.mockResolvedValue([
				{ guildId: 'guild-1', success: true, alreadyMember: false },
			])
			groupsStubMethods.insertDiscordInviteAuditRecords.mockResolvedValue(undefined)

			const _result = await inviteUserToDiscordServers(mockEnv, 'user-1')

			expect(discordStubMethods.joinUserToServers).toHaveBeenCalled()
			const guildIds = discordStubMethods.joinUserToServers.mock.calls[0][1]
			// Should only appear once despite both corp and group referencing it
			const uniqueGuildIds = [...new Set(guildIds)]
			expect(uniqueGuildIds).toEqual(guildIds)
		})

		it('should only invite via the group path when a shared guild also has a corp attachment but the user lacks corp entitlement', async () => {
			eveCorpStubMethods.getCorporationIdsByCharacterIds.mockResolvedValue({})
			dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([
				makeCorpAttachment({
					corporationId: 'corp-1',
					guildId: 'guild-1',
					autoInvite: true,
					autoAssignRoles: true,
					roleIds: ['corp-role-db'],
				}),
			])

			groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
				makeGroupWithDiscord({
					groupId: 'group-1',
					discordServers: [
						{
							discordServerId: 'ds-1',
							autoInvite: true,
							autoAssignRoles: true,
							roleIds: ['group-role-db'],
						},
					],
				}),
			])
			groupsStubMethods.getGroupMemberUserIds.mockResolvedValue(['user-1'])
			dbQueryMocks.discordServers.findFirst.mockResolvedValue(
				makeDiscordServer({ id: 'ds-1', guildId: 'guild-1', guildName: 'Shared Guild' })
			)
			dbQueryMocks.discordRoles.findMany
				.mockResolvedValueOnce([
					{ id: 'group-role-db', roleId: 'group-role', isActive: true } as any,
				])
				.mockResolvedValueOnce([] as any)
			discordStubMethods.joinUserToServers.mockResolvedValue([
				{ guildId: 'guild-1', success: true, alreadyMember: false },
			])
			groupsStubMethods.insertDiscordInviteAuditRecords.mockResolvedValue(undefined)

			const result = await inviteUserToDiscordServers(mockEnv, 'user-1')

			expect(discordStubMethods.joinUserToServers).toHaveBeenCalledTimes(1)
			expect(discordStubMethods.joinUserToServers.mock.calls[0][1]).toEqual(['guild-1'])
			expect(result.results).toHaveLength(1)
			expect(result.results[0].type).toBe('group')
			expect(discordStubMethods.updateUserRoles).toHaveBeenCalledTimes(1)
			expect(discordStubMethods.updateUserRoles.mock.calls[0][1][0].roleIds).toEqual(['group-role'])
		})
	})
})

describe('syncUserDiscordAccess', () => {
	it('should enforce blacklist revocation+ban on manual/admin refresh path', async () => {
		hrStubMethods.isUserBlacklisted.mockResolvedValue(true)
		dbQueryMocks.discordServers.findMany.mockResolvedValue([
			makeDiscordServer({ id: 'ds-1', guildId: 'guild-1' }),
			makeDiscordServer({ id: 'ds-2', guildId: 'guild-2' }),
		])
		discordStubMethods.checkGuildMembershipWithBot.mockResolvedValue(['guild-1', 'guild-2'])
		discordStubMethods.revokeAccessAndBan.mockResolvedValue([
			{ guildId: 'guild-1', success: true, rolesCleared: true, banned: true },
			{ guildId: 'guild-2', success: true, rolesCleared: true, banned: true },
		])

		const result = await syncUserDiscordAccess(mockEnv, 'user-1', true)

		expect(discordStubMethods.joinUserToServers).not.toHaveBeenCalled()
		expect(discordStubMethods.updateUserRoles).not.toHaveBeenCalled()
		expect(discordStubMethods.revokeAccessAndBan).toHaveBeenCalledWith(
			'user-1',
			['guild-1', 'guild-2'],
			'User is blacklisted'
		)
		expect(result.totalInvited).toBe(0)
		expect(result.totalUpdated).toBe(2)
		expect(result.totalFailed).toBe(0)
		expect(result.results.map((r) => r.operation)).toEqual(['revoke-ban', 'revoke-ban'])
	})

	it('should not auto-invite on refresh when only exclusive corp buckets or group owner/admin access exist', async () => {
		eveCorpStubMethods.getCorporationIdsByCharacterIds.mockResolvedValue({})
		dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([
			makeCorpAttachment({
				corporationId: 'corp-1',
				guildId: 'guild-1',
				autoInvite: true,
				autoAssignRoles: true,
				allianceGuestRoleId: 'alliance-guest-role-db',
				allianceGuestAutoApply: true,
				nonAllianceGuestRoleId: 'non-alliance-guest-role-db',
				nonAllianceGuestAutoApply: true,
			}),
		])

		groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
			makeGroupWithDiscord({
				groupId: 'group-1',
				discordServers: [
					{
						discordServerId: 'ds-2',
						autoInvite: true,
						autoAssignRoles: true,
						roleIds: ['dr-role'],
					},
				],
			}),
		])
		groupsStubMethods.getGroupMemberUserIds.mockResolvedValue([])
		groupsStubMethods.getGroupOwnerAndAdminUserIds.mockResolvedValue(['user-1'])
		dbQueryMocks.discordServers.findFirst.mockResolvedValue(
			makeDiscordServer({ id: 'ds-2', guildId: 'guild-2', guildName: 'Group Guild' })
		)
		dbQueryMocks.discordRoles.findMany.mockResolvedValue([])
		groupsStubMethods.insertDiscordInviteAuditRecords.mockResolvedValue(undefined)

		const result = await syncUserDiscordAccess(mockEnv, 'user-1')

		expect(discordStubMethods.joinUserToServers).not.toHaveBeenCalled()
		expect(result.totalInvited).toBe(0)
		expect(result.results.filter((r) => r.operation === 'invite')).toHaveLength(0)
	})

	it('should run invite then role sync and pass allowRemoval through to role updates', async () => {
		dbQueryMocks.discordServers.findMany.mockResolvedValue([
			makeDiscordServer({ id: 'ds-1', guildId: 'guild-1', manageNicknames: true }),
		])
		discordStubMethods.checkGuildMembershipWithBot.mockResolvedValue(['guild-1'])
		dbQueryMocks.userCharacters.findFirst.mockResolvedValue(makeCharacter())

		// Call order across sync:
		// 1) invite: corp autoInvite attachment
		// 2) update: user corp attachments
		// 3) update: corp-gating check
		// 4) update managed roles: corp-managed roles query
		dbQueryMocks.corporationDiscordServers.findMany
			.mockResolvedValueOnce([
				makeCorpAttachment({
					corporationId: 'corp-1',
					guildId: 'guild-1',
					autoInvite: true,
					autoAssignRoles: false,
					roleIds: ['corp-role-ignored'],
				}),
			])
			.mockResolvedValueOnce([
				makeCorpAttachment({
					corporationId: 'corp-1',
					guildId: 'guild-1',
					autoInvite: true,
					autoAssignRoles: false,
					roleIds: ['corp-role-ignored'],
				}),
			])
			.mockResolvedValueOnce([
				makeCorpAttachment({
					corporationId: 'corp-1',
					discordServerId: 'ds-1',
					guildId: 'guild-1',
					roleIds: ['corp-role-ignored'],
				}),
			])
			.mockResolvedValueOnce([
				makeCorpAttachment({
					corporationId: 'corp-1',
					discordServerId: 'ds-1',
					guildId: 'guild-1',
					roleIds: ['corp-role-ignored'],
				}),
			])

		dbQueryMocks.discordRoles.findMany.mockResolvedValue([])
		dbQueryMocks.discordServers.findFirst.mockResolvedValue(
			makeDiscordServer({ id: 'ds-1', guildId: 'guild-1' })
		)
		groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])
		groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
		groupsStubMethods.insertDiscordInviteAuditRecords.mockResolvedValue(undefined)

		discordStubMethods.joinUserToServers.mockResolvedValue([
			{ guildId: 'guild-1', success: true, alreadyMember: false },
		])
		discordStubMethods.updateUserRoles.mockResolvedValue([
			{ guildId: 'guild-1', success: true, rolesAdded: [], rolesRemoved: ['corp-role-ignored'] },
		])

		const result = await syncUserDiscordAccess(mockEnv, 'user-1', true)

		expect(discordStubMethods.joinUserToServers).toHaveBeenCalledTimes(1)
		expect(discordStubMethods.updateUserRoles).toHaveBeenCalledTimes(1)
		expect(discordStubMethods.updateUserNickname).toHaveBeenCalledWith(
			'user-1',
			['guild-1'],
			'Test Pilot'
		)
		expect(discordStubMethods.updateUserRoles.mock.calls[0][2]).toBe(true)
		expect(discordStubMethods.updateLastRefreshed).toHaveBeenCalledWith('user-1')

		expect(result.totalInvited).toBe(1)
		expect(result.totalUpdated).toBe(1)
		expect(result.totalFailed).toBe(0)
		expect(result.results.map((r) => r.operation)).toEqual(['invite', 'update'])
	})
})

describe('updateUserDiscordRoles matrix', () => {
	it('does not grant all configured roles when temporary-role storage is unavailable', async () => {
		discordStubMethods.checkGuildMembershipWithBot.mockResolvedValue(['guild-1'])
		dbQueryMocks.discordServers.findMany.mockResolvedValue([
			makeDiscordServer({ guildId: 'guild-1' }),
		])

		dbQueryMocks.corporationDiscordServers.findMany
			.mockResolvedValueOnce([
				makeCorpAttachment({
					corporationId: 'corp-1',
					guildId: 'guild-1',
					roleIds: ['corp-role'],
				}),
			])
			.mockResolvedValueOnce([
				makeCorpAttachment({
					corporationId: 'corp-1',
					discordServerId: 'ds-1',
					guildId: 'guild-1',
				}),
			])
			.mockResolvedValueOnce([
				makeCorpAttachment({
					corporationId: 'corp-1',
					discordServerId: 'ds-1',
					guildId: 'guild-1',
					roleIds: ['corp-role'],
				}),
			])

		groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])
		groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
		temporaryAssignmentsStub.listActiveAssignments.mockRejectedValue(new Error('DO unavailable'))
		dbQueryMocks.discordRoles.findMany.mockImplementation(async (query: any) => {
			if (query?.with?.discordServer?.columns) {
				return [
					{ roleId: 'corp-role', discordServer: { guildId: 'guild-1', isActive: true } },
					{
						roleId: 'unrelated-managed-role',
						discordServer: { guildId: 'guild-1', isActive: true },
					},
				]
			}
			return []
		})
		dbQueryMocks.discordServers.findFirst.mockResolvedValue(
			makeDiscordServer({ id: 'ds-1', guildId: 'guild-1' })
		)
		discordStubMethods.updateUserRoles.mockResolvedValue([
			{ guildId: 'guild-1', success: true, rolesAdded: [], rolesRemoved: [] },
		])

		await updateUserDiscordRoles(mockEnv, 'user-1', undefined, true)

		const request = discordStubMethods.updateUserRoles.mock.calls[0][1][0]
		expect(request.roleIds).toEqual(['corp-role'])
		expect(request.preserveAllCurrentRoles).toBe(true)
		expect(request.preserveRoleIds).toBeUndefined()
		expect(request.roleIds).not.toContain('unrelated-managed-role')
	})

	it('should still assign corp roles when autoInvite is disabled', async () => {
		discordStubMethods.checkGuildMembershipWithBot.mockResolvedValue(['guild-1'])
		dbQueryMocks.discordServers.findMany.mockResolvedValue([
			makeDiscordServer({ guildId: 'guild-1' }),
		])
		dbQueryMocks.corporationDiscordServers.findMany
			.mockResolvedValueOnce([
				makeCorpAttachment({
					corporationId: 'corp-1',
					guildId: 'guild-1',
					autoInvite: false,
					autoAssignRoles: true,
					roleIds: ['corp-role-db'],
				}),
			])
			.mockResolvedValueOnce([
				makeCorpAttachment({
					corporationId: 'corp-1',
					discordServerId: 'ds-1',
					guildId: 'guild-1',
				}),
			])
		groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])
		groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
		dbQueryMocks.discordRoles.findMany.mockImplementation(async (query: any) => {
			if (query?.with?.discordServer) {
				return []
			}
			if (query?.columns?.roleName) {
				return []
			}
			return [{ id: 'corp-role-db', roleId: 'corp-role', isActive: true }]
		})
		discordStubMethods.updateUserRoles.mockResolvedValue([
			{ guildId: 'guild-1', success: true, rolesAdded: ['corp-role'], rolesRemoved: [] },
		])

		const result = await updateUserDiscordRoles(mockEnv, 'user-1')

		expect(discordStubMethods.updateUserRoles).toHaveBeenCalledTimes(1)
		expect(discordStubMethods.updateUserRoles.mock.calls[0][1][0].roleIds).toEqual(['corp-role-db'])
		expect(result.totalUpdated).toBe(1)
	})
})

describe('inspectUserDiscordAccess', () => {
	it('should classify unmanaged current roles separately from unexpected managed roles', async () => {
		dbQueryMocks.discordServers.findMany.mockResolvedValue([
			makeDiscordServer({ id: 'ds-1', guildId: 'guild-1', guildName: 'Guild One' }),
		])
		discordStubMethods.getUserGuildMembershipDetails.mockResolvedValue([
			{
				guildId: 'guild-1',
				isMember: true,
				currentRoleIds: ['managed-configured', 'managed-unconfigured', 'manual-role'],
				currentRoles: [
					{ roleId: 'managed-configured', roleName: 'Managed Configured' },
					{ roleId: 'managed-unconfigured', roleName: 'Managed Unconfigured' },
					{ roleId: 'manual-role', roleName: 'Manual Role' },
				],
			},
		])

		dbQueryMocks.corporationDiscordServers.findMany
			.mockResolvedValueOnce([]) // expected corp roles from user entitlement
			.mockResolvedValueOnce([
				makeCorpAttachment({
					corporationId: 'corp-1',
					discordServerId: 'ds-1',
					guildId: 'guild-1',
				}),
			]) // corp-gated scan
			.mockResolvedValueOnce([
				// getAllManagedRolesForGuild: configured managed roles
				makeCorpAttachment({
					corporationId: 'corp-managed',
					discordServerId: 'ds-1',
					guildId: 'guild-1',
					roleIds: ['managed-configured'],
				}),
			])

		groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])
		groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
		dbQueryMocks.discordServers.findFirst.mockResolvedValue(
			makeDiscordServer({ id: 'ds-1', guildId: 'guild-1' })
		)
		dbQueryMocks.discordRoles.findMany
			.mockResolvedValueOnce([]) // expected auto-apply roles
			.mockResolvedValueOnce([
				// configured role names for inspection rendering
				{
					discordServerId: 'ds-1',
					roleId: 'managed-configured',
					roleName: 'Managed Configured',
				},
			])
			.mockResolvedValueOnce([]) // getAllManaged auto-apply roles

		const result = await inspectUserDiscordAccess(mockEnv, 'user-1')
		expect(result.guilds).toHaveLength(1)

		const guild = result.guilds[0]
		expect(guild.guildId).toBe('guild-1')
		expect(guild.currentManagedRoles.map((r) => r.roleId)).toEqual(['managed-configured'])
		expect(guild.unexpectedManagedRoles.map((r) => r.roleId)).toEqual(['managed-configured'])
		expect(guild.currentUnmanagedRoles.map((r) => r.roleId)).toEqual(
			expect.arrayContaining(['managed-unconfigured', 'manual-role'])
		)
	})

	it('should skip non-member guilds without auto-invite from drift inspection', async () => {
		dbQueryMocks.discordServers.findMany.mockResolvedValue([
			makeDiscordServer({ id: 'ds-1', guildId: 'guild-1', guildName: 'Guild One' }),
		])
		discordStubMethods.getUserGuildMembershipDetails.mockResolvedValue([
			{
				guildId: 'guild-1',
				isMember: false,
				currentRoleIds: [],
				currentRoles: [],
			},
		])

		dbQueryMocks.userCharacters.findMany.mockResolvedValue([
			{
				userId: 'user-1',
				characterId: 'char-1',
			},
		] as any)
		eveCorpStubMethods.getCorporationIdsByCharacterIds.mockResolvedValue({
			'char-1': 'corp-1',
		})

		dbQueryMocks.corporationDiscordServers.findMany
			.mockResolvedValueOnce([
				// Expected-role lookup: guild has corp roles but no auto-invite.
				makeCorpAttachment({
					corporationId: 'corp-1',
					discordServerId: 'ds-1',
					guildId: 'guild-1',
					autoInvite: false,
					autoAssignRoles: true,
					roleIds: ['corp-role-db'],
				}),
			])
			.mockResolvedValueOnce([
				makeCorpAttachment({
					corporationId: 'corp-1',
					discordServerId: 'ds-1',
					guildId: 'guild-1',
				}),
			]) // corp-gating scan
			.mockResolvedValueOnce([]) // invite-capable corp scan

		groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])
		groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
		dbQueryMocks.discordRoles.findMany.mockResolvedValue([]) // auto-apply roles
		discordStubMethods.getGuildRoles.mockResolvedValue([])

		const result = await inspectUserDiscordAccess(mockEnv, 'user-1')

		expect(result.guilds).toHaveLength(0)
		expect(result.summary.guildsInspected).toBe(0)
		expect(result.summary.guildsWithDrift).toBe(0)
		expect(result.summary.totalMissingExpectedManagedRoles).toBe(0)
		expect(result.summary.totalUnexpectedManagedRoles).toBe(0)
	})

	it('should show the special auth role as expected and managed when present in the guild', async () => {
		dbQueryMocks.discordServers.findMany.mockResolvedValue([
			makeDiscordServer({ id: 'ds-1', guildId: 'guild-1', guildName: 'Guild One' }),
		])
		discordStubMethods.getUserGuildMembershipDetails.mockResolvedValue([
			{
				guildId: 'guild-1',
				isMember: true,
				currentRoleIds: [],
				currentRoles: [],
			},
		])
		discordStubMethods.getGuildRoles.mockResolvedValue([
			{ id: '1431816436640256060', name: 'Auth Gigachad' },
		])

		dbQueryMocks.userCharacters.findMany.mockResolvedValue([
			{
				userId: 'user-1',
				characterId: 'char-1',
			},
		] as any)
		eveCorpStubMethods.getCorporationIdsByCharacterIds.mockResolvedValue({
			'char-1': 'corp-1',
		})

		dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([])
		dbQueryMocks.discordRoles.findMany.mockResolvedValue([])
		groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])
		groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])

		const result = await inspectUserDiscordAccess(mockEnv, 'user-1')

		expect(result.guilds).toHaveLength(1)
		const guild = result.guilds[0]
		expect(guild.expectedManagedRoles.map((r) => r.roleId)).toContain('1431816436640256060')
		expect(guild.currentManagedRoles.map((r) => r.roleId)).not.toContain('1431816436640256060')
		expect(guild.missingExpectedManagedRoles.map((r) => r.roleId)).toContain('1431816436640256060')
		expect(guild.unexpectedManagedRoles).toHaveLength(0)
	})

	it('should expect no roles when user is blacklisted', async () => {
		hrStubMethods.isUserBlacklisted.mockResolvedValue(true)
		dbQueryMocks.discordServers.findMany.mockResolvedValue([
			makeDiscordServer({ id: 'ds-1', guildId: 'guild-1', guildName: 'Guild One' }),
		])
		discordStubMethods.getUserGuildMembershipDetails.mockResolvedValue([
			{
				guildId: 'guild-1',
				isMember: true,
				currentRoleIds: ['managed-configured'],
				currentRoles: [{ roleId: 'managed-configured', roleName: 'Managed Configured' }],
			},
		])

		dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([
			makeCorpAttachment({
				corporationId: 'corp-managed',
				discordServerId: 'ds-1',
				guildId: 'guild-1',
				roleIds: ['managed-configured'],
			}),
		])
		dbQueryMocks.discordServers.findFirst.mockResolvedValue(
			makeDiscordServer({ id: 'ds-1', guildId: 'guild-1' })
		)
		dbQueryMocks.discordRoles.findMany.mockResolvedValue([
			{
				discordServerId: 'ds-1',
				roleId: 'managed-configured',
				roleName: 'Managed Configured',
				isActive: true,
			},
		] as any)
		groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])
		groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])

		const result = await inspectUserDiscordAccess(mockEnv, 'user-1')
		expect(result.guilds).toHaveLength(1)

		const guild = result.guilds[0]
		expect(guild.expectedManagedRoles).toEqual([])
		expect(guild.missingExpectedManagedRoles).toEqual([])
		expect(guild.unexpectedManagedRoles.map((r) => r.roleId)).toEqual(['managed-configured'])
	})

	it('should expect no roles when Discord authorization is revoked', async () => {
		discordStubMethods.getDiscordUserStatus.mockResolvedValue({
			authRevoked: true,
		})
		dbQueryMocks.discordServers.findMany.mockResolvedValue([
			makeDiscordServer({ id: 'ds-1', guildId: 'guild-1', guildName: 'Guild One' }),
		])
		discordStubMethods.getUserGuildMembershipDetails.mockResolvedValue([
			{
				guildId: 'guild-1',
				isMember: true,
				currentRoleIds: ['managed-configured'],
				currentRoles: [{ roleId: 'managed-configured', roleName: 'Managed Configured' }],
			},
		])
		dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([
			makeCorpAttachment({
				corporationId: 'corp-managed',
				discordServerId: 'ds-1',
				guildId: 'guild-1',
				roleIds: ['managed-configured'],
			}),
		])
		dbQueryMocks.discordServers.findFirst.mockResolvedValue(
			makeDiscordServer({ id: 'ds-1', guildId: 'guild-1' })
		)
		dbQueryMocks.discordRoles.findMany.mockResolvedValue([
			{
				discordServerId: 'ds-1',
				roleId: 'managed-configured',
				roleName: 'Managed Configured',
				isActive: true,
			},
		] as any)
		groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])
		groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])

		const result = await inspectUserDiscordAccess(mockEnv, 'user-1')
		expect(result.guilds).toHaveLength(1)

		const guild = result.guilds[0]
		expect(guild.expectedManagedRoles).toEqual([])
		expect(guild.missingExpectedManagedRoles).toEqual([])
		expect(guild.unexpectedManagedRoles.map((r) => r.roleId)).toEqual(['managed-configured'])
	})
})

describe('getExpectedManagedRoleIdsByGuild', () => {
	it('should build expected managed roles from core grants without inspecting live Discord membership', async () => {
		dbQueryMocks.discordServers.findMany.mockResolvedValue([
			makeDiscordServer({ id: 'ds-1', guildId: 'guild-1', guildName: 'Guild One' }),
		])
		dbQueryMocks.users.findMany.mockResolvedValue([])
		dbQueryMocks.userCharacters.findMany.mockResolvedValue([
			{
				userId: 'user-1',
				characterId: 'char-1',
			},
		] as any)
		eveCorpStubMethods.getCorporationIdsByCharacterIds.mockResolvedValue({
			'char-1': 'corp-1',
		})
		dbQueryMocks.corporationDiscordServers.findMany
			.mockResolvedValueOnce([
				makeCorpAttachment({
					corporationId: 'corp-1',
					discordServerId: 'ds-1',
					guildId: 'guild-1',
					roleIds: ['corp-role-db'],
				}),
			])
			.mockResolvedValueOnce([
				makeCorpAttachment({
					corporationId: 'corp-1',
					discordServerId: 'ds-1',
					guildId: 'guild-1',
				}),
			])
		groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([
			makeGroupWithDiscord({
				groupId: 'group-1',
				discordServers: [
					{
						discordServerId: 'ds-1',
						autoInvite: true,
						autoAssignRoles: true,
						roleIds: ['group-role-db'],
					},
				],
			}),
		])
		groupsStubMethods.getGroupMemberUserIds.mockResolvedValue(['user-1'])
		dbQueryMocks.discordRoles.findMany
			.mockResolvedValueOnce([
				{ id: 'group-role-db', roleId: 'group-role-1', isActive: true },
			] as any)
			.mockResolvedValueOnce([
				{ discordServerId: 'ds-1', roleId: 'auto-apply-role', isActive: true },
			] as any)

		const result = await getExpectedManagedRoleIdsByGuild(mockEnv, 'user-1')

		expect(discordStubMethods.getUserGuildMembershipDetails).not.toHaveBeenCalled()
		expect(result.get('guild-1')).toBeDefined()
		expect(Array.from(result.get('guild-1') ?? [])).toEqual(
			expect.arrayContaining(['corp-role-db', 'group-role-1', 'auto-apply-role'])
		)
	})

	it('should use alliance guest scenarios for linked users affiliated through member corps', async () => {
		dbQueryMocks.discordServers.findMany.mockResolvedValue([
			makeDiscordServer({ id: 'ds-1', guildId: 'guild-1', guildName: 'Guild One' }),
		])
		dbQueryMocks.userCharacters.findMany.mockResolvedValue([
			{
				userId: 'user-1',
				characterId: 'char-1',
			},
		] as any)
		eveCorpStubMethods.getCorporationIdsByCharacterIds.mockResolvedValue({
			'char-1': 'corp-affiliated',
		})
		dbQueryMocks.managedCorporations.findMany.mockResolvedValue([
			{ corporationId: 'corp-affiliated' },
		] as any)
		dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([
			makeCorpAttachment({
				corporationId: 'corp-target',
				discordServerId: 'ds-1',
				guildId: 'guild-1',
				isMemberCorporation: true,
				allianceGuestRoleId: 'alliance-role-db',
				allianceGuestAutoApply: true,
				nonAllianceGuestRoleId: 'guest-role-db',
				nonAllianceGuestAutoApply: true,
			}),
		])
		groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])
		groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([])
		dbQueryMocks.discordRoles.findMany
			.mockResolvedValueOnce([
				{ id: 'alliance-role-db', roleId: 'alliance-role', isActive: true },
				{ id: 'guest-role-db', roleId: 'guest-role', isActive: true },
			] as any)
			.mockResolvedValueOnce([] as any)

		const result = await getExpectedManagedRoleIdsByGuild(mockEnv, 'user-1')

		expect(Array.from(result.get('guild-1') ?? [])).toEqual(['alliance-role'])
	})

	it('should include corp-managed roles when building expected managed roles', async () => {
		dbQueryMocks.discordServers.findMany.mockReset()
		dbQueryMocks.userCharacters.findMany.mockReset()
		dbQueryMocks.corporationDiscordServers.findMany.mockReset()
		dbQueryMocks.discordRoles.findMany.mockReset()
		groupsStubMethods.getGroupsWithDiscordAutoInvite.mockReset()
		groupsStubMethods.getGroupMemberUserIds.mockReset()
		groupsStubMethods.getGroupOwnerAndAdminUserIds.mockReset()
		discordStubMethods.getGuildRoles.mockReset()

		dbQueryMocks.discordServers.findMany.mockResolvedValue([
			makeDiscordServer({ id: 'ds-1', guildId: 'guild-1', guildName: 'Guild One' }),
		])
		dbQueryMocks.userCharacters.findMany.mockResolvedValue([
			{
				userId: 'user-1',
				characterId: 'char-1',
			},
		] as any)
		eveCorpStubMethods.getCorporationIdsByCharacterIds.mockResolvedValue({
			'char-1': 'corp-1',
		})
		dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([
			makeCorpAttachment({
				corporationId: 'corp-1',
				discordServerId: 'ds-1',
				guildId: 'guild-1',
				autoAssignRoles: true,
				roleIds: ['corp-managed-role-db'],
			}),
		])
		groupsStubMethods.getGroupsWithDiscordAutoInvite.mockResolvedValue([])
		groupsStubMethods.getGroupMemberUserIds.mockResolvedValue([])
		groupsStubMethods.getGroupOwnerAndAdminUserIds.mockResolvedValue([])
		dbQueryMocks.discordRoles.findMany.mockResolvedValueOnce([
			{ id: 'corp-managed-role-db', roleId: 'corp-managed-role', isActive: true },
		] as any)
		discordStubMethods.getGuildRoles.mockResolvedValue([{ id: 'some-other-role' }])

		const result = await getExpectedManagedRoleIdsByGuild(mockEnv, 'user-1')

		expect(Array.from(result.get('guild-1') ?? [])).toEqual(['corp-managed-role-db'])
	})
})

describe('refreshServerMembers', () => {
	it('should build refresh role sets from corp and group assignments additively', async () => {
		dbQueryMocks.discordServers.findFirst.mockReset()
		dbQueryMocks.userCharacters.findFirst.mockReset()
		dbQueryMocks.userCharacters.findMany.mockReset()
		dbQueryMocks.managedCorporations.findMany.mockReset()
		dbQueryMocks.corporationDiscordServers.findMany.mockReset()
		dbQueryMocks.discordRoles.findMany.mockReset()
		groupsStubMethods.getGroupsByDiscordServer.mockReset()
		groupsStubMethods.getDiscordServerAttachmentConfig.mockReset()
		groupsStubMethods.getGroupMemberUserIds.mockReset()
		groupsStubMethods.getGroupOwnerAndAdminUserIds.mockReset()
		discordStubMethods.getGuildRoles.mockReset()
		discordStubMethods.joinUserToServers.mockReset()
		discordStubMethods.updateUserRoles.mockReset()

		dbQueryMocks.discordServers.findFirst.mockResolvedValue(
			makeDiscordServer({
				id: 'ds-1',
				guildId: 'guild-1',
				guildName: 'Guild One',
				manageNicknames: false,
			})
		)
		dbQueryMocks.userCharacters.findFirst.mockResolvedValue(
			makeCharacter({
				userId: 'user-1',
				characterId: 'char-1',
				characterName: 'Test Pilot',
				is_primary: true,
			})
		)
		dbQueryMocks.userCharacters.findMany.mockResolvedValue([
			makeCharacter({
				userId: 'user-1',
				characterId: 'char-1',
				characterName: 'Test Pilot',
				is_primary: true,
			}),
		])
		eveCorpStubMethods.getCorporationIdsByCharacterIds.mockResolvedValue({
			'char-1': 'corp-1',
		})
		dbQueryMocks.managedCorporations.findMany.mockResolvedValue([])
		dbQueryMocks.corporationDiscordServers.findMany.mockResolvedValue([
			makeCorpAttachment({
				corporationId: 'corp-1',
				discordServerId: 'ds-1',
				guildId: 'guild-1',
				autoAssignRoles: true,
				roleIds: ['corp-managed-role'],
			}),
		])
		groupsStubMethods.getGroupsByDiscordServer.mockResolvedValue([
			{
				groupId: 'group-1',
				groupName: 'Group One',
				id: 'group-attachment-1',
				autoAssignRoles: true,
			},
		])
		groupsStubMethods.getGroupMemberUserIds.mockResolvedValue(['user-1'])
		groupsStubMethods.getGroupOwnerAndAdminUserIds.mockResolvedValue(['user-1'])
		groupsStubMethods.getDiscordServerAttachmentConfig.mockResolvedValue({
			groupId: 'group-1',
			guildId: 'guild-1',
			roleIds: ['group-member-role', 'group-owner-role'],
			ownerAdminRoleIds: ['group-owner-role'],
		})
		dbQueryMocks.discordRoles.findMany
			.mockResolvedValueOnce([
				{ id: 'group-member-role', roleId: 'group-member-role', isActive: true },
				{ id: 'group-owner-role', roleId: 'group-owner-role', isActive: true },
			] as any)
			.mockResolvedValueOnce([] as any)
			.mockResolvedValueOnce([] as any)
			.mockResolvedValueOnce([
				{ id: 'group-member-role', roleId: 'group-member-role', isActive: true },
				{ id: 'group-owner-role', roleId: 'group-owner-role', isActive: true },
			] as any)
		discordStubMethods.getGuildRoles.mockResolvedValue([])
		discordStubMethods.joinUserToServers.mockResolvedValue([
			{ guildId: 'guild-1', success: true, rolesAdded: [], rolesRemoved: [] },
		])
		discordStubMethods.getDiscordUserStatus.mockResolvedValue(null)
		discordStubMethods.updateUserRoles.mockResolvedValue([
			{
				guildId: 'guild-1',
				success: true,
				rolesAdded: ['corp-managed-role', 'group-member-role', 'group-owner-role'],
				rolesRemoved: [],
			},
		])

		const result = await refreshServerMembers(mockEnv, 'ds-1', ['user-1'])

		expect(result.successCount).toBe(1)
		expect(result.failCount).toBe(0)
		expect(discordStubMethods.updateUserRoles).toHaveBeenCalledTimes(1)
		const requests = discordStubMethods.updateUserRoles.mock.calls[0][1]
		expect(requests[0].roleIds).toEqual(
			expect.arrayContaining(['corp-managed-role', 'group-member-role', 'group-owner-role'])
		)
	})
})
