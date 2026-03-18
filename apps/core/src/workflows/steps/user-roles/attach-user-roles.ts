import { ROLE_CORE_ALLIANCE_MEMBER, ROLE_CORE_CORP_MEMBER } from '@repo/core'
import { getStub } from '@repo/do-utils'
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
	allianceId?: string | null
	corporationId?: string | null
}

/**
 * Attach user roles to the user
 *
 * Source of truth breakdown:
 * - `user_characters` in core is the refresh-time source of truth for corporation and
 *   alliance membership role derivation.
 * - The refresh workflow is responsible for hydrating those fields from ESI before this
 *   step runs.
 * - Groups role attachments are the persisted authorization surface consumed by session
 *   auth and route guards.
 * - Live ESI affiliation lookup is intentionally not used here, to avoid divergence
 *   between refresh-persisted character state and attached roles.
 *
 * @param ctx - Workflow context
 * @returns User role attachments
 */
export async function attachUserRoles(ctx: WorkflowContext): Promise<AttachUserRolesResult> {
	const logger = getWorkflowLogger(ctx, 'attach-user-roles')

	const coreStub = getStub<Core>(ctx.env.CORE, 'default')
	const characters = await coreStub.getUserCharacters(ctx.userId)

	const characterInfoResults: CharacterInfo[] = characters.map((character) => ({
		characterId: String(character.characterId),
		characterName: character.characterName,
		allianceId: character.allianceId ?? null,
		corporationId: character.corporationId ?? null,
	}))
	for (const characterInfo of characterInfoResults) {
		logger.info('[Workflow] Derived role source from refreshed character state', {
			characterId: characterInfo.characterId,
			corporationId: characterInfo.corporationId,
			allianceId: characterInfo.allianceId,
		})
	}

	type RoleAttachment = {
		roleName: string
		attachedToType: RoleAttachmentType
		attachedToId: string
		resourceId: string
		resourceType: ResourceType
	}

	const roleAttachments: RoleAttachment[] = []
	const buildCorporationRoleAttachment = (characterInfo: CharacterInfo) => {
		if (!characterInfo.corporationId) {
			return
		}

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
			return
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
	const existingCoreMembershipRoles = await groupsStub.getRolesFor({
		attachedToType: RoleAttachmentType.USER,
		attachedToId: ctx.userId,
	})
	const rolesToDetach = new Map<string, string>()
	for (const attachment of existingCoreMembershipRoles) {
		if (
			attachment.role.name === ROLE_CORE_CORP_MEMBER ||
			attachment.role.name === ROLE_CORE_ALLIANCE_MEMBER
		) {
			rolesToDetach.set(attachment.role.id, attachment.role.name)
		}
	}
	for (const [roleId, roleName] of rolesToDetach) {
		logger.info('[Workflow] Detaching stale core membership role', {
			userId: ctx.userId,
			roleId,
			roleName,
		})
		await groupsStub.detachRoleFrom({
			roleId,
			attachedToType: RoleAttachmentType.USER,
			attachedToId: ctx.userId,
		})
	}

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
