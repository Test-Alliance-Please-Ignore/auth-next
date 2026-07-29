import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getStub } from '@repo/do-utils'

import type { Groups, PermissionTarget } from '@repo/groups'
import type { Env } from '../../context'

const testEnv = env as unknown as Env

const ADMIN_USER_ID = 'admin-user-123'
const OWNER_USER_ID = 'owner-user-1'
const GROUP_ADMIN_USER_ID = 'group-admin-user-1'
const MEMBER_USER_ID = 'member-user-1'

function uniqueId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

async function setupGroupWithOwnerAdminAndMember(stub: Groups, scope: string): Promise<string> {
	const category = await stub.createCategory(
		{
			name: uniqueId(`Permissions Category ${scope}`),
			visibility: 'public',
		},
		ADMIN_USER_ID
	)

	const group = await stub.createGroup(
		{
			categoryId: category.id,
			name: uniqueId(`Permissions Group ${scope}`),
			joinMode: 'open',
			visibility: 'public',
		},
		OWNER_USER_ID
	)

	await stub.joinGroup(group.id, GROUP_ADMIN_USER_ID)
	await stub.joinGroup(group.id, MEMBER_USER_ID)
	await stub.addAdmin(group.id, OWNER_USER_ID, GROUP_ADMIN_USER_ID)

	return group.id
}

async function attachGlobalPermissionWithTargetType(
	stub: Groups,
	groupId: string,
	targetType: PermissionTarget,
	scope: string
): Promise<string> {
	const permission = await stub.createPermission(
		{
			urn: uniqueId(`urn:test:permissions:${scope}`).toLowerCase(),
			name: uniqueId(`Permission ${scope}`),
		},
		ADMIN_USER_ID
	)

	await stub.attachPermissionToGroup(
		{
			groupId,
			permissionId: permission.id,
			targetType,
		},
		ADMIN_USER_ID
	)

	return permission.urn
}

describe('Groups permissions targetType behavior', () => {
	it('all_members grants to owner, admins, and members', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, uniqueId('permissions-all-members'))
		const groupId = await setupGroupWithOwnerAdminAndMember(stub, 'all-members')
		const urn = await attachGlobalPermissionWithTargetType(
			stub,
			groupId,
			'all_members',
			'all-members'
		)

		const [ownerPermissions, groupAdminPermissions, memberPermissions] = await Promise.all([
			stub.getUserPermissions(OWNER_USER_ID),
			stub.getUserPermissions(GROUP_ADMIN_USER_ID),
			stub.getUserPermissions(MEMBER_USER_ID),
		])

		expect(ownerPermissions.some((p) => p.urn === urn)).toBe(true)
		expect(groupAdminPermissions.some((p) => p.urn === urn)).toBe(true)
		expect(memberPermissions.some((p) => p.urn === urn)).toBe(true)
	})

	it('all_admins grants only to group admins (not owner unless explicitly admin)', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, uniqueId('permissions-all-admins'))
		const groupId = await setupGroupWithOwnerAdminAndMember(stub, 'all-admins')
		const urn = await attachGlobalPermissionWithTargetType(
			stub,
			groupId,
			'all_admins',
			'all-admins'
		)

		const [ownerPermissions, groupAdminPermissions, memberPermissions] = await Promise.all([
			stub.getUserPermissions(OWNER_USER_ID),
			stub.getUserPermissions(GROUP_ADMIN_USER_ID),
			stub.getUserPermissions(MEMBER_USER_ID),
		])

		expect(ownerPermissions.some((p) => p.urn === urn)).toBe(false)
		expect(groupAdminPermissions.some((p) => p.urn === urn)).toBe(true)
		expect(memberPermissions.some((p) => p.urn === urn)).toBe(false)
	})

	it('owner_only grants only to group owner', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, uniqueId('permissions-owner-only'))
		const groupId = await setupGroupWithOwnerAdminAndMember(stub, 'owner-only')
		const urn = await attachGlobalPermissionWithTargetType(
			stub,
			groupId,
			'owner_only',
			'owner-only'
		)

		const [ownerPermissions, groupAdminPermissions, memberPermissions] = await Promise.all([
			stub.getUserPermissions(OWNER_USER_ID),
			stub.getUserPermissions(GROUP_ADMIN_USER_ID),
			stub.getUserPermissions(MEMBER_USER_ID),
		])

		expect(ownerPermissions.some((p) => p.urn === urn)).toBe(true)
		expect(groupAdminPermissions.some((p) => p.urn === urn)).toBe(false)
		expect(memberPermissions.some((p) => p.urn === urn)).toBe(false)
	})

	it('owner_and_admins grants to owner and group admins, not regular members', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, uniqueId('permissions-owner-and-admins'))
		const groupId = await setupGroupWithOwnerAdminAndMember(stub, 'owner-and-admins')
		const urn = await attachGlobalPermissionWithTargetType(
			stub,
			groupId,
			'owner_and_admins',
			'owner-and-admins'
		)

		const [ownerPermissions, groupAdminPermissions, memberPermissions] = await Promise.all([
			stub.getUserPermissions(OWNER_USER_ID),
			stub.getUserPermissions(GROUP_ADMIN_USER_ID),
			stub.getUserPermissions(MEMBER_USER_ID),
		])

		expect(ownerPermissions.some((p) => p.urn === urn)).toBe(true)
		expect(groupAdminPermissions.some((p) => p.urn === urn)).toBe(true)
		expect(memberPermissions.some((p) => p.urn === urn)).toBe(false)
	})

	it('getGroupMemberPermissions and multi-group permissions deduplicate same URN across groups', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, uniqueId('permissions-dedup'))
		const groupIdA = await setupGroupWithOwnerAdminAndMember(stub, 'dedup-a')
		const groupIdB = await setupGroupWithOwnerAdminAndMember(stub, 'dedup-b')

		const permission = await stub.createPermission(
			{
				urn: uniqueId('urn:test:permissions:dedup').toLowerCase(),
				name: uniqueId('Permission dedup'),
			},
			ADMIN_USER_ID
		)

		await stub.attachPermissionToGroup(
			{ groupId: groupIdA, permissionId: permission.id, targetType: 'all_members' },
			ADMIN_USER_ID
		)
		await stub.attachPermissionToGroup(
			{ groupId: groupIdB, permissionId: permission.id, targetType: 'owner_and_admins' },
			ADMIN_USER_ID
		)

		// Regular member in each group only gets all_members from A, not owner_and_admins from B.
		const memberPermissions = await stub.getUserPermissions(MEMBER_USER_ID)
		const urnMatches = memberPermissions.filter((p) => p.urn === permission.urn)
		expect(urnMatches).toHaveLength(1)

		// Group member permissions are scoped by group and should honor targetType rules.
		const groupAMemberPerms = await stub.getGroupMemberPermissions(groupIdA)
		const groupBMemberPerms = await stub.getGroupMemberPermissions(groupIdB)
		expect(groupAMemberPerms.userPermissions[MEMBER_USER_ID]?.some((p) => p.urn === permission.urn)).toBe(
			true
		)
		expect(groupBMemberPerms.userPermissions[MEMBER_USER_ID]?.some((p) => p.urn === permission.urn)).toBe(
			false
		)
	})
})
