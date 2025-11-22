import { ROLE_CORE_ALLIANCE_MEMBER, ROLE_CORE_CORP_MEMBER } from '@repo/core'
import { getStub } from '@repo/do-utils'
import { getEsiInstanceForCharacter, getEsiInstanceForCorporation } from '@repo/esi'
import { ResourceType, RoleAttachmentType } from '@repo/groups'

import { getWorkflowLogger } from '../../context'

import type { Core } from '@repo/core'
import type { Groups, RoleAttachment } from '@repo/groups'
import type { WorkflowContext } from '../../context'

/**
 * User roles
 */
export interface AttachUserRolesResult {
	corporationRoleAttachments: RoleAttachment[]
	allianceRoleAttachments: RoleAttachment[]
}

interface CharacterInfo {
	characterId: string
	characterName: string
	allianceId?: string
	corporationId: string
}

/**
 * Attach user roles to the user
 * @param ctx - Workflow context
 * @param userId - User ID
 * @param workflowInstanceId - Workflow instance ID
 * @returns void
 */
export async function attachUserRoles(
	ctx: WorkflowContext,
	userId: string
): Promise<AttachUserRolesResult> {
	const logger = getWorkflowLogger(ctx)

	const coreStub = getStub<Core>(ctx.env.CORE, 'default')

	const characters = await coreStub.getUserCharacters(userId)

	const characterInfoResults: CharacterInfo[] = await Promise.all(
		characters.map(async (character) => {
			logger.info('[Workflow] Fetching character public info', {
				characterId: character.characterId,
			})

			const characterInfo = await getEsiInstanceForCharacter(
				ctx.env.ESI,
				character.characterId
			).fetchCharacterPublicInfo(character.characterId)

			return {
				characterId: character.characterId,
				characterName: character.characterName,
				allianceId: characterInfo.alliance_id,
				corporationId: characterInfo.corporation_id,
			}
		})
	)

	const attachCorporationRoles = async (characterInfo: CharacterInfo) => {
		logger.info('[Workflow] Attaching corporation roles', {
			characterId: characterInfo.characterId,
			corporationId: characterInfo.corporationId,
		})

		const groupsStub = getStub<Groups>(ctx.env.GROUPS, 'default')
		try {
			const roleAttachment = await groupsStub.attachRoleTo({
				roleName: ROLE_CORE_CORP_MEMBER,
				attachedToType: RoleAttachmentType.USER,
				attachedToId: userId,
				resourceId: characterInfo.corporationId,
				resourceType: ResourceType.CORPORATION,
			})
			return roleAttachment
		} catch (error) {
			// empty catch
		}
	}

	const attachAllianceRoles = async (characterInfo: CharacterInfo) => {
		if (!characterInfo.allianceId) {
			return undefined
		}
		const groupsStub = getStub<Groups>(ctx.env.GROUPS, 'default')
		try {
			const roleAttachment = await groupsStub.attachRoleTo({
				roleName: ROLE_CORE_ALLIANCE_MEMBER,
				attachedToType: RoleAttachmentType.USER,
				attachedToId: userId,
				resourceId: characterInfo.allianceId,
				resourceType: ResourceType.ALLIANCE,
			})
			return roleAttachment
		} catch (error) {
			// empty catch
		}
	}

	const roleAttachments = await Promise.all(
		characterInfoResults.map(async (characterInfo) => {
			const corporationRoleAttachment = await attachCorporationRoles(characterInfo)
			let allianceRoleAttachment: RoleAttachment | undefined
			if (characterInfo.allianceId) {
				allianceRoleAttachment = await attachAllianceRoles(characterInfo)
			}
			return {
				corporationRoleAttachment,
				allianceRoleAttachment,
			}
		})
	)

	return {
		corporationRoleAttachments: roleAttachments
			.map((r) => r.corporationRoleAttachment)
			.filter((r) => r !== undefined) as RoleAttachment[],
		allianceRoleAttachments: roleAttachments
			.map((r) => r.allianceRoleAttachment)
			.filter((r) => r !== undefined) as RoleAttachment[],
	}
}
