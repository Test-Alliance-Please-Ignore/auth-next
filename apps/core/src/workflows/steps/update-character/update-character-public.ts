/**
 * Update database with workflow completion timestamp
 */

import { eq } from 'drizzle-orm'

import { getStub } from '@repo/do-utils'
import { getEsiInstanceForCharacter } from '@repo/esi'

import { userCharacters } from '../../../db/schema'
import { getWorkflowLogger } from '../../context'

import type { CharacterPublicInfo, EsiTypeResolver } from '@repo/esi'
import type { WorkflowContext } from '../../context'

/**
 * Update database to mark workflow as completed
 *
 * @param ctx - Workflow context
 */
export async function updateCharacterPublicInfo(
	ctx: WorkflowContext,
	characterId: string
): Promise<{
	characterId: string
	characterName: string
	corporationId: string
	corporationName: string
	allianceId: string | null
	allianceName: string | null
	isDeleted: boolean
}> {
	const logger = getWorkflowLogger(ctx, 'update-character-public-info')

	let characterInfo: CharacterPublicInfo | null = null
	const esiStub = getEsiInstanceForCharacter(ctx.env.ESI, characterId)
	try {
		characterInfo = await esiStub.fetchCharacterPublicInfo(characterId)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		logger.error('[Workflow] Failed to fetch character public info', {
			characterId,
			error: errorMessage,
		})

		if (errorMessage.includes('Character has been deleted!')) {
			return {
				characterId: characterId,
				characterName: '',
				corporationId: '',
				corporationName: '',
				allianceId: null,
				allianceName: null,
				isDeleted: true,
			}
		}
	}

	if (!characterInfo) {
		return {
			characterId: characterId,
			characterName: '',
			corporationId: '',
			corporationName: '',
			allianceId: null,
			allianceName: null,
			isDeleted: true,
		}
	}

	const typeResolver = getStub<EsiTypeResolver>(ctx.env.ESI_TYPE_RESOLVER, 'global')
	const idsToResolve = [characterInfo.corporation_id]
	if (characterInfo.alliance_id) {
		idsToResolve.push(characterInfo.alliance_id)
	}
	const nameMap = await typeResolver.resolveIds(idsToResolve)
	const corporationName = nameMap[characterInfo.corporation_id]
	const allianceName = characterInfo.alliance_id ? String(nameMap[characterInfo.alliance_id]) : null
	const allianceId = characterInfo.alliance_id ? String(characterInfo.alliance_id) : null
	await ctx.db
		.update(userCharacters)
		.set({
			characterName: characterInfo.name,
			corporationId: characterInfo.corporation_id,
			corporationName: corporationName,
			allianceId: allianceId,
			allianceName: allianceName,
			lastCharacterRefresh: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(userCharacters.characterId, characterId))

	logger.info('[Workflow] Updated character public info', {
		characterId,
		userId: ctx.userId,
		workflowInstanceId: ctx.workflowInstanceId,
	})

	return {
		characterId: characterId,
		characterName: characterInfo.name,
		corporationId: characterInfo.corporation_id,
		corporationName: corporationName,
		allianceId: allianceId,
		allianceName: allianceName,
		isDeleted: false,
	}
}
