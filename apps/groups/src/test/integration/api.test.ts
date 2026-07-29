import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getStub } from '@repo/do-utils'

import worker from '../../index'

import type { Groups } from '@repo/groups'
import type { Env } from '../../context'

// Cast env to have correct types
const testEnv = env as unknown as Env

// Mock user IDs for testing (these would normally come from the core database)
const ADMIN_USER_ID = 'admin-user-123'
const USER_1_ID = 'user-1-456'
const USER_2_ID = 'user-2-789'
const USER_3_ID = 'user-3-abc'
const FALLBACK_OWNER_USER_ID = '4a16f141-ddd2-4179-8e3f-7d64a6548f74'

describe('Groups Worker', () => {
	it('responds to root endpoint', async () => {
		const request = new Request('http://example.com/')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const data = await response.json()
		expect(data).toHaveProperty('status', 'ok')
		expect(data).toHaveProperty('service', 'groups')
	})
})

describe('Groups Durable Object - Categories', () => {
	it('should create a category', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-category-create')

		const category = await stub.createCategory(
			{
				name: 'Test Category',
				description: 'A test category',
				visibility: 'public',
				allowGroupCreation: 'anyone',
			},
			ADMIN_USER_ID
		)

		expect(category).toBeDefined()
		expect(category.name).toBe('Test Category')
		expect(category.visibility).toBe('public')
	})

	it('should list categories', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-category-list')

		// Create a category first
		await stub.createCategory(
			{
				name: 'Public Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const categories = await stub.listCategories(USER_1_ID)

		expect(Array.isArray(categories)).toBe(true)
		expect(categories.length).toBeGreaterThan(0)
		expect(categories[0].name).toBe('Public Category')
	})

	it('should get a category with groups', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-category-get')

		const category = await stub.createCategory(
			{
				name: 'Gaming Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const retrieved = await stub.getCategory(category.id, USER_1_ID)

		expect(retrieved).toBeDefined()
		expect(retrieved?.name).toBe('Gaming Category')
		expect(retrieved?.groups).toBeDefined()
	})

	it('should update a category', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-category-update')

		const category = await stub.createCategory(
			{
				name: 'Original Name',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const updated = await stub.updateCategory(
			category.id,
			{
				name: 'Updated Name',
				description: 'New description',
			},
			ADMIN_USER_ID
		)

		expect(updated.name).toBe('Updated Name')
		expect(updated.description).toBe('New description')
	})

	it('should delete a category', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-category-delete')

		const category = await stub.createCategory(
			{
				name: 'To Delete',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		await stub.deleteCategory(category.id, ADMIN_USER_ID)

		const retrieved = await stub.getCategory(category.id, ADMIN_USER_ID)
		expect(retrieved).toBeNull()
	})
})

describe('Groups Durable Object - Global Permissions', () => {
	it('should list uncategorized permissions when filtering by uncategorized', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-permissions-uncategorized')

		const category = await stub.createCategory(
			{
				name: 'Categorized Permissions Test',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const categorizedPermission = await stub.createPermission(
			{
				urn: 'urn:broadcasts:test:categorized:send',
				name: 'Categorized Permission',
				categoryId: category.id,
			},
			ADMIN_USER_ID
		)

		const uncategorizedPermission = await stub.createPermission(
			{
				urn: 'urn:broadcasts:test:uncategorized:send',
				name: 'Uncategorized Permission',
			},
			ADMIN_USER_ID
		)

		const uncategorizedPermissions = await stub.listPermissions('uncategorized')

		expect(uncategorizedPermissions.some((permission) => permission.id === uncategorizedPermission.id)).toBe(
			true
		)
		expect(uncategorizedPermissions.some((permission) => permission.id === categorizedPermission.id)).toBe(
			false
		)
		expect(uncategorizedPermissions.every((permission) => permission.category === null)).toBe(true)
	})
})

describe('Groups Durable Object - Groups', () => {
	it('should create a group', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-group-create')

		const category = await stub.createCategory(
			{
				name: 'Test Category for Groups',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'My Test Group',
				description: 'A test group',
				visibility: 'public',
				joinMode: 'open',
			},
			USER_1_ID
		)

		expect(group).toBeDefined()
		expect(group.name).toBe('My Test Group')
		expect(group.ownerId).toBe(USER_1_ID)
		expect(group.joinMode).toBe('open')
		expect(group.mumbleSyncEnabled).toBe(false)
		expect(group.mumbleTicker).toBeNull()
	})

	it('should allow a site admin to create an admin-managed group', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-group-create-admin-managed')

		const category = await stub.createCategory(
			{
				name: 'Locked Group Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Admin Managed Group',
				joinMode: 'admin_managed',
			},
			ADMIN_USER_ID
		)

		expect(group.joinMode).toBe('admin_managed')
	})

	it('should reject non-admin attempts to create an admin-managed group', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-group-create-admin-managed-denied')

		const category = await stub.createCategory(
			{
				name: 'Locked Denied Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		await expect(
			stub.createGroup(
				{
					categoryId: category.id,
					name: 'Should Not Admin Manage',
					joinMode: 'admin_managed',
				},
				USER_1_ID
			)
		).rejects.toThrow('Only site admins can configure admin-managed groups')
	})

	it('should allow a site admin to create a group with mumble settings', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-group-create-admin-mumble')

		const category = await stub.createCategory(
			{
				name: 'Admin Mumble Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Admin Mumble Group',
				mumbleSyncEnabled: true,
				mumbleTicker: 'fc-1234!',
			},
			ADMIN_USER_ID
		)

		expect(group).toBeDefined()
		expect(group.mumbleSyncEnabled).toBe(true)
		expect(group.mumbleTicker).toBe('FC123')
	})

	it('should reject an invalid mumble ticker when creating a group', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-group-create-invalid-ticker')

		const category = await stub.createCategory(
			{
				name: 'Invalid Ticker Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		await expect(
			stub.createGroup(
				{
					categoryId: category.id,
					name: 'Bad Group',
					mumbleTicker: 'fc-1234!',
				},
				ADMIN_USER_ID
			)
		).rejects.toThrow('Mumble ticker must be 1 to 5 alphanumeric characters')
	})

	it('should list groups', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-group-list')

		const category = await stub.createCategory(
			{
				name: 'List Test Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Group 1',
			},
			USER_1_ID
		)

		await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Group 2',
			},
			USER_2_ID
		)

		const groups = await stub.listGroups({}, USER_1_ID)

		expect(Array.isArray(groups)).toBe(true)
		expect(groups.length).toBeGreaterThanOrEqual(2)
	})

	it('should get a group with details', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-group-get')

		const category = await stub.createCategory(
			{
				name: 'Get Test Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Detailed Group',
			},
			USER_1_ID
		)

		const retrieved = await stub.getGroup(group.id, USER_1_ID)

		expect(retrieved).toBeDefined()
		expect(retrieved?.name).toBe('Detailed Group')
		expect(retrieved?.category).toBeDefined()
		expect(retrieved?.memberCount).toBeGreaterThanOrEqual(1) // Owner is auto-member
		expect(retrieved?.isOwner).toBe(true)
	})

	it('should transfer ownership to the fallback owner when removing an owner from all groups', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-group-owner-fallback')

		const category = await stub.createCategory(
			{
				name: 'Owner Fallback Test Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Owner Fallback Group',
			},
			USER_1_ID
		)

		await stub.joinGroup(group.id, USER_2_ID)
		await stub.createGroupScopedPermission(
			{
				groupId: group.id,
				urn: 'urn:groups:test:owner-fallback',
				name: 'Owner Fallback Permission',
				targetType: 'all_members',
			},
			USER_1_ID
		)

		const beforePermissions = await stub.listGroupPermissions(group.id, ADMIN_USER_ID)
		expect(beforePermissions).toHaveLength(1)

		const cleanup = await stub.forceRemoveUserFromAllGroups(USER_1_ID)
		expect(cleanup.transferredOwnershipGroupIds).toContain(group.id)
		expect(cleanup.deletedGroupIds).toHaveLength(0)

		const retrieved = await stub.getGroup(group.id, ADMIN_USER_ID)
		expect(retrieved).toBeDefined()
		expect(retrieved?.ownerId).toBe(FALLBACK_OWNER_USER_ID)

		const originalOwnerMemberships = await stub.getUserMemberships(USER_1_ID)
		expect(originalOwnerMemberships.some((membership) => membership.groupId === group.id)).toBe(false)

		const fallbackOwnerMemberships = await stub.getUserMemberships(FALLBACK_OWNER_USER_ID)
		expect(fallbackOwnerMemberships.some((membership) => membership.groupId === group.id)).toBe(true)

		const afterPermissions = await stub.listGroupPermissions(group.id, ADMIN_USER_ID)
		expect(afterPermissions).toHaveLength(1)
	})

	it('should update a group', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-group-update')

		const category = await stub.createCategory(
			{
				name: 'Update Test Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Original Group Name',
			},
			USER_1_ID
		)

		const updated = await stub.updateGroup(
			group.id,
			{
				name: 'Updated Group Name',
				joinMode: 'approval',
			},
			USER_1_ID
		)

		expect(updated.name).toBe('Updated Group Name')
		expect(updated.joinMode).toBe('approval')
		expect(updated.mumbleSyncEnabled).toBe(false)
		expect(updated.mumbleTicker).toBeNull()
	})

	it('should allow a site admin to update mumble settings', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-group-update-admin-mumble')

		const category = await stub.createCategory(
			{
				name: 'Admin Update Mumble Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Admin Update Group',
			},
			USER_1_ID
		)

		const updated = await stub.updateGroup(
			group.id,
			{
				mumbleSyncEnabled: true,
				mumbleTicker: 'fc-1234!',
			},
			ADMIN_USER_ID
		)

		expect(updated.mumbleSyncEnabled).toBe(true)
		expect(updated.mumbleTicker).toBe('FC123')
	})

	it('should allow a site admin to toggle admin-managed groups', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-group-update-admin-managed-admin')

		const category = await stub.createCategory(
			{
				name: 'Update Locked Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Admin Managed Toggle Group',
			},
			USER_1_ID
		)

		const updated = await stub.updateGroup(
			group.id,
			{
				joinMode: 'admin_managed',
			},
			ADMIN_USER_ID
		)

		expect(updated.joinMode).toBe('admin_managed')
	})

	it('should reject non-admin attempts to toggle admin-managed groups', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-group-update-admin-managed-denied')

		const category = await stub.createCategory(
			{
				name: 'Update Locked Denied Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Admin Managed Toggle Denied Group',
			},
			USER_1_ID
		)

		await expect(
			stub.updateGroup(
				group.id,
				{
					joinMode: 'admin_managed',
				},
				USER_1_ID
			)
		).rejects.toThrow('Only site admins can configure admin-managed groups')
	})

	it('should allow a site admin to force-add a member to an admin-managed group and block self-leave', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-group-force-add-admin-managed')

		const category = await stub.createCategory(
			{
				name: 'Force Add Locked Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Force Add Admin Managed Group',
				joinMode: 'admin_managed',
			},
			ADMIN_USER_ID
		)

		await stub.addMember(group.id, ADMIN_USER_ID, USER_2_ID)

		const members = await stub.getGroupMembers(group.id, ADMIN_USER_ID)
		expect(members.some((member) => member.userId === USER_2_ID)).toBe(true)

		await expect(stub.leaveGroup(group.id, USER_2_ID)).rejects.toThrow(
			'This group is admin managed. Members can only be removed by a site admin.'
		)
	})

	it('should block direct self-join for admin-managed groups', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-group-admin-managed-join-blocked')

		const category = await stub.createCategory(
			{
				name: 'Admin Managed Join Blocked Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Admin Managed Join Blocked Group',
				joinMode: 'admin_managed',
			},
			ADMIN_USER_ID
		)

		await expect(stub.joinGroup(group.id, USER_2_ID)).rejects.toThrow(
			'This group is admin managed. Members must be added by a site admin.'
		)
	})

	it('should reject an invalid mumble ticker when updating a group', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-group-update-invalid-ticker')

		const category = await stub.createCategory(
			{
				name: 'Update Invalid Ticker Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Original Group Name',
			},
			USER_1_ID
		)

		await expect(
			stub.updateGroup(
				group.id,
				{
					mumbleTicker: 'fc-1234!',
				},
				ADMIN_USER_ID
			)
		).rejects.toThrow('Mumble ticker must be 1 to 5 alphanumeric characters')
	})

	it('should delete a group', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-group-delete')

		const category = await stub.createCategory(
			{
				name: 'Delete Test Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Group to Delete',
			},
			USER_1_ID
		)

		await stub.deleteGroup(group.id, USER_1_ID)

		const retrieved = await stub.getGroup(group.id, USER_1_ID)
		expect(retrieved).toBeNull()
	})
})

describe('Groups Durable Object - Membership', () => {
	it('should allow user to join open group', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-membership-join')

		const category = await stub.createCategory(
			{
				name: 'Join Test Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Open Group',
				joinMode: 'open',
			},
			USER_1_ID
		)

		await stub.joinGroup(group.id, USER_2_ID)

		const members = await stub.getGroupMembers(group.id, USER_1_ID)
		expect(members.length).toBe(2) // Owner + new member
		expect(members.some((m: { userId: string }) => m.userId === USER_2_ID)).toBe(true)
	})

	it('should allow user to leave group', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-membership-leave')

		const category = await stub.createCategory(
			{
				name: 'Leave Test Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Leave Group',
				joinMode: 'open',
			},
			USER_1_ID
		)

		await stub.joinGroup(group.id, USER_2_ID)
		await stub.leaveGroup(group.id, USER_2_ID)

		const members = await stub.getGroupMembers(group.id, USER_1_ID)
		expect(members.length).toBe(1) // Only owner remains
		expect(members.some((m: { userId: string }) => m.userId === USER_2_ID)).toBe(false)
	})

	it('should allow admin to remove member', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-membership-remove')

		const category = await stub.createCategory(
			{
				name: 'Remove Test Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Remove Group',
				joinMode: 'open',
			},
			USER_1_ID
		)

		await stub.joinGroup(group.id, USER_2_ID)
		await stub.removeMember(group.id, USER_1_ID, USER_2_ID)

		const members = await stub.getGroupMembers(group.id, USER_1_ID)
		expect(members.length).toBe(1) // Only owner remains
	})

	it('should get user memberships', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-membership-list')

		const category = await stub.createCategory(
			{
				name: 'Memberships Test Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		await stub.createGroup(
			{
				categoryId: category.id,
				name: 'User Group 1',
			},
			USER_1_ID
		)

		await stub.createGroup(
			{
				categoryId: category.id,
				name: 'User Group 2',
			},
			USER_1_ID
		)

		const memberships = await stub.getUserMemberships(USER_1_ID)

		expect(Array.isArray(memberships)).toBe(true)
		expect(memberships.length).toBe(2)
		expect(memberships.every((m: { isOwner: boolean }) => m.isOwner)).toBe(true)
	})
})

describe('Groups Durable Object - Invitations', () => {
	// Note: These tests would require actual user characters to exist in the database
	// For now, we test the error handling when character is not found

	it('should reject invitation for non-existent character', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-invitation-nonexistent')

		const category = await stub.createCategory(
			{
				name: 'Invitation Test Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Invite Group',
			},
			USER_1_ID
		)

		await expect(
			stub.createInvitation(
				{
					groupId: group.id,
					characterName: 'NonExistentCharacter',
				},
				USER_1_ID
			)
		).rejects.toThrow('not found')
	})

	it('should list pending invitations', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-invitation-list')

		const invitations = await stub.listPendingInvitations(USER_2_ID)

		expect(Array.isArray(invitations)).toBe(true)
	})
})

describe('Groups Durable Object - Invite Codes', () => {
	it('should create an invite code', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-invite-code-create')

		const category = await stub.createCategory(
			{
				name: 'Invite Code Test Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Code Group',
			},
			USER_1_ID
		)

		const result = await stub.createInviteCode(
			{
				groupId: group.id,
				expiresInDays: 7,
				maxUses: 10,
			},
			USER_1_ID
		)

		expect(result.code).toBeDefined()
		expect(result.code.code).toBeTruthy()
		expect(result.code.maxUses).toBe(10)
	})

	it('should reject invite code creation for admin-managed groups', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-invite-code-admin-managed-reject')

		const category = await stub.createCategory(
			{
				name: 'Admin Managed Invite Code Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Admin Managed Invite Code Group',
				joinMode: 'admin_managed',
			},
			ADMIN_USER_ID
		)

		await expect(
			stub.createInviteCode(
				{
					groupId: group.id,
					expiresInDays: 7,
				},
				ADMIN_USER_ID
			)
		).rejects.toThrow('Invite codes are disabled')
	})

	it('should list invite codes', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-invite-code-list')

		const category = await stub.createCategory(
			{
				name: 'List Codes Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Code List Group',
			},
			USER_1_ID
		)

		await stub.createInviteCode(
			{
				groupId: group.id,
				expiresInDays: 7,
			},
			USER_1_ID
		)

		const codes = await stub.listInviteCodes(group.id, USER_1_ID)

		expect(Array.isArray(codes)).toBe(true)
		expect(codes.length).toBeGreaterThan(0)
	})

	it('should redeem an invite code', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-invite-code-redeem')

		const category = await stub.createCategory(
			{
				name: 'Redeem Code Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Redeem Group',
			},
			USER_1_ID
		)

		const { code } = await stub.createInviteCode(
			{
				groupId: group.id,
				expiresInDays: 7,
			},
			USER_1_ID
		)

		const result = await stub.redeemInviteCode(code.code, USER_2_ID)

		expect(result.success).toBe(true)
		expect(result.group).toBeDefined()
		if (!result.group) throw new Error('Group not found')
		expect(result.group.id).toBe(group.id)

		const members = await stub.getGroupMembers(group.id, USER_1_ID)
		expect(members.some((m: { userId: string }) => m.userId === USER_2_ID)).toBe(true)
	})

	it('should revoke an invite code', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-invite-code-revoke')

		const category = await stub.createCategory(
			{
				name: 'Revoke Code Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Revoke Group',
			},
			USER_1_ID
		)

		const { code } = await stub.createInviteCode(
			{
				groupId: group.id,
				expiresInDays: 7,
			},
			USER_1_ID
		)

		await stub.revokeInviteCode(code.id, USER_1_ID)

		const codes = await stub.listInviteCodes(group.id, USER_1_ID)
		const revokedCode = codes.find((inviteCode) => inviteCode.id === code.id)
		expect(revokedCode).toBeDefined()
		expect(revokedCode?.revokedAt).not.toBeNull()

		await expect(stub.redeemInviteCode(code.code, USER_2_ID)).rejects.toThrow('revoked')
	})
})

describe('Groups Durable Object - Join Requests', () => {
	it('should create a join request', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-join-request-create')

		const category = await stub.createCategory(
			{
				name: 'Join Request Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Approval Group',
				joinMode: 'approval',
			},
			USER_1_ID
		)

		const request = await stub.createJoinRequest(
			{
				groupId: group.id,
				reason: 'I want to join!',
			},
			USER_2_ID
		)

		expect(request).toBeDefined()
		expect(request.status).toBe('pending')
		expect(request.reason).toBe('I want to join!')
	})

	it('should list join requests', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-join-request-list')

		const category = await stub.createCategory(
			{
				name: 'List Requests Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'List Requests Group',
				joinMode: 'approval',
			},
			USER_1_ID
		)

		await stub.createJoinRequest(
			{
				groupId: group.id,
			},
			USER_2_ID
		)

		const requests = await stub.listJoinRequests(group.id, USER_1_ID)

		expect(Array.isArray(requests)).toBe(true)
		expect(requests.length).toBeGreaterThan(0)
	})

	it('should approve a join request', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-join-request-approve')

		const category = await stub.createCategory(
			{
				name: 'Approve Request Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Approve Request Group',
				joinMode: 'approval',
			},
			USER_1_ID
		)

		const request = await stub.createJoinRequest(
			{
				groupId: group.id,
			},
			USER_2_ID
		)

		await stub.approveJoinRequest(request.id, USER_1_ID)

		const members = await stub.getGroupMembers(group.id, USER_1_ID)
		expect(members.some((m: { userId: string }) => m.userId === USER_2_ID)).toBe(true)
	})

	it('should reject a join request', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-join-request-reject')

		const category = await stub.createCategory(
			{
				name: 'Reject Request Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Reject Request Group',
				joinMode: 'approval',
			},
			USER_1_ID
		)

		const request = await stub.createJoinRequest(
			{
				groupId: group.id,
			},
			USER_3_ID
		)

		await stub.rejectJoinRequest(request.id, USER_1_ID)

		const members = await stub.getGroupMembers(group.id, USER_1_ID)
		expect(members.some((m: { userId: string }) => m.userId === USER_3_ID)).toBe(false)
	})

	it('should allow rejecting multiple historical join requests for the same user and group', async () => {
		const stub = getStub<Groups>(testEnv.GROUPS, 'test-join-request-reject-repeat')

		const category = await stub.createCategory(
			{
				name: 'Repeat Reject Request Category',
				visibility: 'public',
			},
			ADMIN_USER_ID
		)

		const group = await stub.createGroup(
			{
				categoryId: category.id,
				name: 'Repeat Reject Request Group',
				joinMode: 'approval',
			},
			USER_1_ID
		)

		const firstRequest = await stub.createJoinRequest(
			{
				groupId: group.id,
			},
			USER_3_ID
		)

		await stub.rejectJoinRequest(firstRequest.id, USER_1_ID)

		const secondRequest = await stub.createJoinRequest(
			{
				groupId: group.id,
			},
			USER_3_ID
		)

		await stub.rejectJoinRequest(secondRequest.id, USER_1_ID)

		const members = await stub.getGroupMembers(group.id, USER_1_ID)
		expect(members.some((m: { userId: string }) => m.userId === USER_3_ID)).toBe(false)
	})
})
