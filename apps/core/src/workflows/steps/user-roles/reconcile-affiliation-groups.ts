import { and, eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { managedCorporations, userCharacters } from '../../../db/schema'
import { getWorkflowLogger } from '../../context'

import type { Groups } from '@repo/groups'
import type { WorkflowContext } from '../../context'

export interface AffiliationGroupReconciliationResult {
	shouldStripGroups: boolean
	hasQualifyingAffiliation: boolean
	removedGroupIds: string[]
	transferredOwnershipGroupIds: string[]
	deletedGroupIds: string[]
}

/**
 * Strip affiliation-based group memberships when the user no longer has any
 * persisted character affiliation to a member corporation or alliance.
 */
export async function reconcileAffiliationBasedGroupMemberships(
	ctx: WorkflowContext
): Promise<AffiliationGroupReconciliationResult> {
	const logger = getWorkflowLogger(ctx, 'reconcile-affiliation-groups')

	const [characters, memberCorporations] = await Promise.all([
		ctx.db.query.userCharacters.findMany({
			where: and(eq(userCharacters.userId, ctx.userId), eq(userCharacters.isDeleted, false)),
			columns: {
				characterId: true,
				corporationId: true,
				allianceId: true,
			},
		}),
		ctx.db.query.managedCorporations.findMany({
			where: eq(managedCorporations.isMemberCorporation, true),
			columns: {
				corporationId: true,
			},
		}),
	])

	const memberCorporationIds = new Set(memberCorporations.map((corporation) => corporation.corporationId))
	const qualifyingCharacter = characters.find(
		(character) =>
			(!!character.corporationId && memberCorporationIds.has(character.corporationId)) ||
			!!character.allianceId
	)

	if (qualifyingCharacter) {
		logger.info('[Workflow] User still has qualifying affiliation; skipping group strip', {
			userId: ctx.userId,
			characterId: qualifyingCharacter.characterId,
			corporationId: qualifyingCharacter.corporationId,
			allianceId: qualifyingCharacter.allianceId,
		})
		return {
			shouldStripGroups: false,
			hasQualifyingAffiliation: true,
			removedGroupIds: [],
			transferredOwnershipGroupIds: [],
			deletedGroupIds: [],
		}
	}

	const groupsStub = getStub<Groups>(ctx.env.GROUPS, 'default')
	const memberships = await groupsStub.getUserMemberships(ctx.userId)
	if (memberships.length === 0) {
		logger.info('[Workflow] User has no group memberships to strip', { userId: ctx.userId })
		return {
			shouldStripGroups: false,
			hasQualifyingAffiliation: false,
			removedGroupIds: [],
			transferredOwnershipGroupIds: [],
			deletedGroupIds: [],
		}
	}

	const removalResult = await groupsStub.forceRemoveUserFromAllGroups(ctx.userId)
	logger.info('[Workflow] Removed affiliation-based group memberships', {
		userId: ctx.userId,
		removedGroupCount: removalResult.removedGroupIds.length,
		transferredOwnershipGroupCount: removalResult.transferredOwnershipGroupIds.length,
		deletedGroupCount: removalResult.deletedGroupIds.length,
	})

	return {
		shouldStripGroups: true,
		hasQualifyingAffiliation: false,
		removedGroupIds: removalResult.removedGroupIds,
		transferredOwnershipGroupIds: removalResult.transferredOwnershipGroupIds,
		deletedGroupIds: removalResult.deletedGroupIds,
	}
}
