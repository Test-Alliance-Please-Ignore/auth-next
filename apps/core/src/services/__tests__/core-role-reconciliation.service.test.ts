import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CORE_ROLES, ROLE_CORE_ALLIANCE_MEMBER, ROLE_CORE_CORP_MEMBER } from '@repo/core'
import { ResourceType } from '@repo/groups'

import { reconcileUserCoreMembershipRoles } from '../core-role-reconciliation.service'

const hoisted = vi.hoisted(() => {
	return {
		coreBinding: {} as DurableObjectNamespace,
		groupsBinding: {} as DurableObjectNamespace,
		mocks: {
			getUserCharacters: vi.fn(),
			isMemberCorporation: vi.fn(),
			getMemberCorporationIds: vi.fn(),
			batchCreateRoles: vi.fn(),
			replaceCoreMembershipRolesForUser: vi.fn(),
			clearUserRolesCache: vi.fn(),
		},
	}
})

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn((binding: DurableObjectNamespace) => {
		if (binding === hoisted.coreBinding) {
			return {
				getUserCharacters: hoisted.mocks.getUserCharacters,
				isMemberCorporation: hoisted.mocks.isMemberCorporation,
				getMemberCorporationIds: hoisted.mocks.getMemberCorporationIds,
			}
		}
		return {
			batchCreateRoles: hoisted.mocks.batchCreateRoles,
			replaceCoreMembershipRolesForUser: hoisted.mocks.replaceCoreMembershipRolesForUser,
		}
	}),
}))

vi.mock('../../lib/groups-cache', () => ({
	clearUserRolesCache: hoisted.mocks.clearUserRolesCache,
}))

describe('reconcileUserCoreMembershipRoles', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		hoisted.mocks.isMemberCorporation.mockResolvedValue(true)
		hoisted.mocks.getMemberCorporationIds.mockImplementation(
			async (corporationIds: string[]) => corporationIds
		)
	})

	it('deduplicates desired role targets and clears role cache', async () => {
		hoisted.mocks.getUserCharacters.mockResolvedValue([
			{
				characterId: '1',
				characterName: 'A',
				isDeleted: false,
				corporationId: '100',
				allianceId: '200',
			},
			{
				characterId: '2',
				characterName: 'B',
				isDeleted: false,
				corporationId: '100',
				allianceId: '200',
			},
		])
		hoisted.mocks.batchCreateRoles.mockResolvedValue([])
		hoisted.mocks.replaceCoreMembershipRolesForUser.mockResolvedValue({
			roleAttachments: [],
			desiredCount: 2,
			attachedCount: 2,
			detachedCount: 0,
		})

		const result = await reconcileUserCoreMembershipRoles(
			{
				CORE: hoisted.coreBinding,
				GROUPS: hoisted.groupsBinding,
			},
			'user-1'
		)

		expect(hoisted.mocks.batchCreateRoles).toHaveBeenCalledWith({
			roles: CORE_ROLES.map((role) => ({
				name: role,
				ownedBy: 'urn:service:core',
				description: `${role} role for the HR system`,
			})),
		})
		expect(hoisted.mocks.replaceCoreMembershipRolesForUser).toHaveBeenCalledWith({
			userId: 'user-1',
			roles: [
				{
					roleName: ROLE_CORE_CORP_MEMBER,
					resourceId: '100',
					resourceType: ResourceType.CORPORATION,
				},
				{
					roleName: ROLE_CORE_ALLIANCE_MEMBER,
					resourceId: '200',
					resourceType: ResourceType.ALLIANCE,
				},
			],
		})
		expect(hoisted.mocks.clearUserRolesCache).toHaveBeenCalledWith('user-1')
		expect(result.desiredCount).toBe(2)
	})

	it('passes empty target set when user has no affiliation data', async () => {
		hoisted.mocks.getUserCharacters.mockResolvedValue([
			{
				characterId: '1',
				characterName: 'A',
				isDeleted: false,
				corporationId: null,
				allianceId: null,
			},
		])
		hoisted.mocks.batchCreateRoles.mockResolvedValue([])
		hoisted.mocks.replaceCoreMembershipRolesForUser.mockResolvedValue({
			roleAttachments: [],
			desiredCount: 0,
			attachedCount: 0,
			detachedCount: 0,
		})

		await reconcileUserCoreMembershipRoles(
			{
				CORE: hoisted.coreBinding,
				GROUPS: hoisted.groupsBinding,
			},
			'user-2'
		)

		expect(hoisted.mocks.replaceCoreMembershipRolesForUser).toHaveBeenCalledWith({
			userId: 'user-2',
			roles: [],
		})
	})

	it('does not grant alliance membership for an alliance character in a non-member corporation', async () => {
		hoisted.mocks.getUserCharacters.mockResolvedValue([
			{
				characterId: '1',
				characterName: 'A',
				isDeleted: false,
				corporationId: '999',
				allianceId: '200',
			},
		])
		hoisted.mocks.getMemberCorporationIds.mockResolvedValue([])
		hoisted.mocks.batchCreateRoles.mockResolvedValue([])
		hoisted.mocks.replaceCoreMembershipRolesForUser.mockResolvedValue({
			roleAttachments: [],
			desiredCount: 1,
			attachedCount: 1,
			detachedCount: 0,
		})

		await reconcileUserCoreMembershipRoles(
			{
				CORE: hoisted.coreBinding,
				GROUPS: hoisted.groupsBinding,
			},
			'user-3'
		)

		expect(hoisted.mocks.replaceCoreMembershipRolesForUser).toHaveBeenCalledWith({
			userId: 'user-3',
			roles: [
				{
					roleName: ROLE_CORE_CORP_MEMBER,
					resourceId: '999',
					resourceType: ResourceType.CORPORATION,
				},
			],
		})
	})
})
