import {
	CORE_ROLES,
	ROLE_CORE_ALLIANCE_MEMBER,
	ROLE_CORE_CORP_MEMBER,
	SERVICE_CORE,
} from '@repo/core'
import { getStub } from '@repo/do-utils'
import { ResourceType } from '@repo/groups'

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

const MISSING_CORE_MEMBERSHIP_ROLES_ERROR = 'Core membership roles are missing.'

function coreRoleDefinitions() {
	return CORE_ROLES.map((role) => ({
		name: role,
		ownedBy: SERVICE_CORE,
		description: `${role} role for the HR system`,
	}))
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

	const characters = await coreStub.getUserCharacters(userId)
	const corporationIds = [
		...new Set(
			characters
				.map((character) => character.corporationId)
				.filter((corporationId): corporationId is string => Boolean(corporationId))
		),
	]
	const memberCorporationIds = new Set(await coreStub.getMemberCorporationIds(corporationIds))

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
		if (
			character.allianceId &&
			character.corporationId &&
			memberCorporationIds.has(character.corporationId)
		) {
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

	const request = {
		userId,
		roles: roleTargets,
	}
	let result: ReplaceCoreMembershipRolesForUserResponse
	try {
		result = await groupsStub.replaceCoreMembershipRolesForUser(request)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		if (!errorMessage.includes(MISSING_CORE_MEMBERSHIP_ROLES_ERROR)) {
			throw error
		}

		// Core's singleton seeds these roles during initialization. This recovery path
		// keeps reconciliation self-healing if an operator removes them, without adding
		// an otherwise redundant Groups write to every login.
		await groupsStub.batchCreateRoles({ roles: coreRoleDefinitions() })
		result = await groupsStub.replaceCoreMembershipRolesForUser(request)
	}

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
