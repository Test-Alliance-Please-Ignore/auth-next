import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reconcileAffiliationBasedGroupMemberships } from './reconcile-affiliation-groups'

import type { WorkflowContext } from '../../context'

const GROUPS_NS = Symbol('GROUPS')
const mocks = vi.hoisted(() => ({
	getStubMock: vi.fn(),
	forceRemoveUserFromAllGroups: vi.fn(),
	getUserMemberships: vi.fn(),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: mocks.getStubMock,
}))

function createDb(
	characters: Array<{
		characterId: string
		corporationId: string | null
		allianceId?: string | null
	}>,
	memberCorporations: Array<{ corporationId: string }>
): WorkflowContext['db'] {
	return {
		query: {
			userCharacters: {
				findMany: vi.fn(async () => characters),
			},
			managedCorporations: {
				findMany: vi.fn(async () => memberCorporations),
			},
		},
	} as unknown as WorkflowContext['db']
}

function createCtx(
	db: WorkflowContext['db'] = createDb([], [])
): WorkflowContext {
	return {
		db,
		env: {
			GROUPS: GROUPS_NS as unknown as WorkflowContext['env']['GROUPS'],
		} as WorkflowContext['env'],
		workflowInstanceId: 'wf-123',
		userId: 'user-123',
		refreshMode: 'scheduled',
	}
}

describe('reconcileAffiliationBasedGroupMemberships', () => {
	beforeEach(() => {
		vi.clearAllMocks()

		mocks.getStubMock.mockImplementation((namespace: symbol) => {
			if (namespace === GROUPS_NS) {
				return {
					getUserMemberships: mocks.getUserMemberships,
					forceRemoveUserFromAllGroups: mocks.forceRemoveUserFromAllGroups,
				}
			}

			return {}
		})
	})

	it('skips stripping when the user still has a qualifying member corporation affiliation', async () => {
		const ctx = createCtx(
			createDb(
				[
					{
						characterId: 'char-1',
						corporationId: 'corp-1',
						allianceId: null,
					},
				],
				[{ corporationId: 'corp-1' }]
			)
		)

		const result = await reconcileAffiliationBasedGroupMemberships(ctx)

		expect(result).toEqual({
			shouldStripGroups: false,
			hasQualifyingAffiliation: true,
			removedGroupIds: [],
			transferredOwnershipGroupIds: [],
			deletedGroupIds: [],
		})
		expect(mocks.getUserMemberships).not.toHaveBeenCalled()
		expect(mocks.forceRemoveUserFromAllGroups).not.toHaveBeenCalled()
	})

	it('strips affiliation-based group memberships when the user no longer has a qualifying affiliation', async () => {
		mocks.getUserMemberships.mockResolvedValue([
			{
				groupId: 'group-1',
				groupName: 'Group 1',
				categoryName: 'Category 1',
				isOwner: false,
				isAdmin: true,
				joinedAt: new Date('2026-01-01T00:00:00Z'),
			},
		])
		mocks.forceRemoveUserFromAllGroups.mockResolvedValue({
			removedGroupIds: ['group-1'],
			transferredOwnershipGroupIds: [],
			deletedGroupIds: [],
		})

		const ctx = createCtx(
			createDb(
				[
					{
						characterId: 'char-1',
						corporationId: 'corp-x',
						allianceId: null,
					},
				],
				[{ corporationId: 'corp-1' }]
			)
		)

		const result = await reconcileAffiliationBasedGroupMemberships(ctx)

		expect(mocks.getUserMemberships).toHaveBeenCalledWith('user-123')
		expect(mocks.forceRemoveUserFromAllGroups).toHaveBeenCalledWith('user-123')
		expect(result).toEqual({
			shouldStripGroups: true,
			hasQualifyingAffiliation: false,
			removedGroupIds: ['group-1'],
			transferredOwnershipGroupIds: [],
			deletedGroupIds: [],
		})
	})
})
