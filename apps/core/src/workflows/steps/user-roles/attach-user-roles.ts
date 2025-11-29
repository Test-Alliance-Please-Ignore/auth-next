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
 * @returns User role attachments
 */
export async function attachUserRoles(ctx: WorkflowContext): Promise<AttachUserRolesResult> {
	const logger = getWorkflowLogger(ctx, 'attach-user-roles')

	const coreStub = getStub<Core>(ctx.env.CORE, 'default')

	const characters = await coreStub.getUserCharacters(ctx.userId)

	const characterInfoResults: CharacterInfo[] = await Promise.all(
		characters.map(async (character) => {
			logger.info('[Workflow] Fetching character public info', {
				characterId: character.characterId,
			})

			const esiStub = getEsiInstanceForCharacter(ctx.env.ESI, character.characterId)
			const affiliation = await esiStub.fetchCharacterAffiliation([character.characterId])
			return {
				characterId: character.characterId,
				characterName: character.characterName,
				allianceId: affiliation[0].alliance_id,
				corporationId: affiliation[0].corporation_id,
			}
		})
	)

	type RoleAttachment = {
		roleName: string
		attachedToType: RoleAttachmentType
		attachedToId: string
		resourceId: string
		resourceType: ResourceType
	}

	const roleAttachments: RoleAttachment[] = []
	const buildCorporationRoleAttachment = (characterInfo: CharacterInfo) => {
		logger.info('[Workflow] Attaching corporation roles', {
			characterId: characterInfo.characterId,
			corporationId: characterInfo.corporationId,
		})

		roleAttachments.push({
			roleName: ROLE_CORE_CORP_MEMBER,
			attachedToType: RoleAttachmentType.USER,
			attachedToId: ctx.userId,
			resourceId: characterInfo.corporationId,
			resourceType: ResourceType.CORPORATION,
		})
	}

	const buildAllianceRoleAttachment = (characterInfo: CharacterInfo) => {
		if (!characterInfo.allianceId) {
			return undefined
		}

		roleAttachments.push({
			roleName: ROLE_CORE_ALLIANCE_MEMBER,
			attachedToType: RoleAttachmentType.USER,
			attachedToId: ctx.userId,
			resourceId: characterInfo.allianceId,
			resourceType: ResourceType.ALLIANCE,
		})
	}

	characterInfoResults.forEach((characterInfo) => {
		buildCorporationRoleAttachment(characterInfo)
		buildAllianceRoleAttachment(characterInfo)
	})

	const groupsStub = getStub<Groups>(ctx.env.GROUPS, 'default')
	const attachedRoleAttachments = await groupsStub.batchAttachRolesTo({
		roles: roleAttachments.map((r) => ({
			roleName: r.roleName,
			attachedToType: r.attachedToType,
			attachedToId: r.attachedToId,
			resourceId: r.resourceId,
			resourceType: r.resourceType,
		})),
	})

	return {
		corporationRoleAttachments: attachedRoleAttachments.filter(
			(r) => r.resourceType === ResourceType.CORPORATION
		),
		allianceRoleAttachments: attachedRoleAttachments.filter(
			(r) => r.resourceType === ResourceType.ALLIANCE
		),
	}
}
