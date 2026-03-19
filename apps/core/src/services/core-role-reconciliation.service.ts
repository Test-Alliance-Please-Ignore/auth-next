import {
	CORE_ROLES,
	ROLE_CORE_ALLIANCE_MEMBER,
	ROLE_CORE_CORP_MEMBER,
	SERVICE_CORE,
} from '@repo/core'
import { getStub } from '@repo/do-utils'
import { ResourceType } from '@repo/groups'

import { clearUserRolesCache } from '../lib/groups-cache'

import type { Core } from '@repo/core'
import type {
	Groups,
	ReplaceCoreMembershipRolesForUserResponse,
	RoleAttachment,
} from '@repo/groups'

type CoreRoleReconciliationEnv = {
	CORE: DurableObjectNamespace
	GROUPS: DurableObjectNamespace
}

/**
 * Reconcile core membership roles for a user against persisted user character affiliations.
 * This is safe to call from login/link flows and refresh workflows.
 */
export async function reconcileUserCoreMembershipRoles(
	env: CoreRoleReconciliationEnv,
	userId: string
): Promise<ReplaceCoreMembershipRolesForUserResponse> {
	const coreStub = getStub<Core>(env.CORE, 'default')
	const groupsStub = getStub<Groups>(env.GROUPS, 'default')

	// Defensive role seeding: idempotent and safe to run on each reconcile call.
	await groupsStub.batchCreateRoles({
		roles: CORE_ROLES.map((role) => ({
			name: role,
			ownedBy: SERVICE_CORE,
			description: `${role} role for the HR system`,
		})),
	})

	const characters = await coreStub.getUserCharacters(userId)

	const seen = new Set<string>()
	const roleTargets: Array<{
		roleName: string
		resourceId: string
		resourceType: ResourceType.CORPORATION | ResourceType.ALLIANCE
	}> = []

	for (const character of characters) {
		if (character.corporationId) {
			const key = `${ROLE_CORE_CORP_MEMBER}|${character.corporationId}|${ResourceType.CORPORATION}`
			if (!seen.has(key)) {
				seen.add(key)
				roleTargets.push({
					roleName: ROLE_CORE_CORP_MEMBER,
					resourceId: character.corporationId,
					resourceType: ResourceType.CORPORATION,
				})
			}
		}
		if (character.allianceId) {
			const key = `${ROLE_CORE_ALLIANCE_MEMBER}|${character.allianceId}|${ResourceType.ALLIANCE}`
			if (!seen.has(key)) {
				seen.add(key)
				roleTargets.push({
					roleName: ROLE_CORE_ALLIANCE_MEMBER,
					resourceId: character.allianceId,
					resourceType: ResourceType.ALLIANCE,
				})
			}
		}
	}

	const result = await groupsStub.replaceCoreMembershipRolesForUser({
		userId,
		roles: roleTargets,
	})

	clearUserRolesCache(userId)
	return result
}

export function splitCoreRoleAttachments(attachments: RoleAttachment[]): {
	corporationRoleAttachments: RoleAttachment[]
	allianceRoleAttachments: RoleAttachment[]
} {
	return {
		corporationRoleAttachments: attachments.filter(
			(attachment) => attachment.resourceType === ResourceType.CORPORATION
		),
		allianceRoleAttachments: attachments.filter(
			(attachment) => attachment.resourceType === ResourceType.ALLIANCE
		),
	}
}
