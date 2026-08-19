/**
 * Update database with workflow completion timestamp
 */

import { eq } from 'drizzle-orm'

import { getStub } from '@repo/do-utils'

import { userCharacters } from '../../../db/schema'
import { markCharacterDeletedEverywhere } from '../../../services/character-deletion.service'
import { getWorkflowLogger } from '../../context'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EsiTypeResolver } from '@repo/esi'
import type { WorkflowContext } from '../../context'

/**
 * Refresh and persist the user's authoritative character affiliation state.
 *
 * Source of truth breakdown:
 * - `eve-character-data` owns the public ESI fetch/classification logic.
 * - `user_characters` is the persisted source of truth used by downstream core
 *   workflows after this step completes.
 * - Corporation/alliance display names are best-effort cached metadata and are not
 *   allowed to block persistence of the affiliation IDs themselves.
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
	corporationName: string | null
	allianceId: string | null
	allianceName: string | null
	isDeleted: boolean
	affiliationChanged: boolean
}> {
	const logger = getWorkflowLogger(ctx, 'update-character-public-info')
	const eveCharDataStub = getStub<EveCharacterData>(ctx.env.EVE_CHARACTER_DATA, 'default')

	const publicRefreshResult = await eveCharDataStub.refreshPublicCharacterData(characterId, false)

	if (publicRefreshResult.isDeleted) {
		await markCharacterDeletedEverywhere(ctx.db, ctx.env, characterId, {
			reconcileCorporationMembership: false,
		})

		logger.info('[Workflow] Character marked as deleted during public info refresh', {
			characterId,
		})

		return {
			characterId,
			characterName: '',
			corporationId: '',
			corporationName: '',
			allianceId: null,
			allianceName: null,
			isDeleted: true,
			affiliationChanged: true,
		}
	}

	const characterName = publicRefreshResult.characterName ?? ''
	const affiliationCorporationId = publicRefreshResult.currentCorporationId ?? ''
	const affiliationAllianceId = publicRefreshResult.currentAllianceId ?? null
	const allianceId = affiliationAllianceId ? String(affiliationAllianceId) : null
	const existingCharacter = await ctx.db.query.userCharacters.findFirst({
		where: eq(userCharacters.characterId, characterId),
		columns: { corporationId: true, allianceId: true, isDeleted: true },
	})
	const affiliationChanged =
		publicRefreshResult.affiliationChanged ??
		(!existingCharacter ||
			existingCharacter.isDeleted === true ||
			existingCharacter.corporationId !== affiliationCorporationId ||
			(existingCharacter.allianceId ?? null) !== allianceId)

	// Persist the authoritative affiliation IDs before any best-effort name resolution.
	await ctx.db
		.update(userCharacters)
		.set({
			characterName,
			corporationId: affiliationCorporationId,
			allianceId,
			isDeleted: false,
			lastCharacterRefresh: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(userCharacters.characterId, characterId))

	const typeResolver = getStub<EsiTypeResolver>(ctx.env.ESI_TYPE_RESOLVER, 'global')
	const idsToResolve = [affiliationCorporationId]
	if (allianceId) {
		idsToResolve.push(allianceId)
	}

	let corporationName: string | null = null
	let allianceName: string | null = null
	try {
		const nameMap = await typeResolver.resolveIds(idsToResolve)
		corporationName = nameMap[affiliationCorporationId] ?? null
		allianceName = allianceId ? String(nameMap[allianceId] ?? '') || null : null

		await ctx.db
			.update(userCharacters)
			.set({
				corporationName,
				allianceName,
				updatedAt: new Date(),
			})
			.where(eq(userCharacters.characterId, characterId))
	} catch (error) {
		logger.warn('[Workflow] Failed to resolve character affiliation names', {
			characterId,
			error: error instanceof Error ? error.message : String(error),
			corporationId: affiliationCorporationId,
			allianceId,
		})
	}

	logger.info('[Workflow] Updated character public info', {
		characterId,
		userId: ctx.userId,
		workflowInstanceId: ctx.workflowInstanceId,
	})

	return {
		characterId,
		characterName,
		corporationId: affiliationCorporationId,
		corporationName,
		allianceId,
		allianceName,
		isDeleted: false,
		affiliationChanged,
	}
}
