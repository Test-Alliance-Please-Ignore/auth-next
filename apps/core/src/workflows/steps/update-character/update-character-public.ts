/**
 * Update database with workflow completion timestamp
 */

import { eq } from 'drizzle-orm'

import { getStub } from '@repo/do-utils'
import { CharacterDeletedError, getEsiInstanceForCharacter } from '@repo/esi'

import { userCharacters } from '../../../db/schema'
import { getWorkflowLogger } from '../../context'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { CharacterPublicInfo, EsiTypeResolver } from '@repo/esi'
import type { WorkflowContext } from '../../context'

/**
 * Refresh and persist the user's authoritative character affiliation state.
 *
 * Source of truth breakdown:
 * - ESI public character info (`GET /characters/{id}`) is the source of truth for
 *   `characterName`, `corporationId`, and `allianceId` during refresh.
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
}> {
	const logger = getWorkflowLogger(ctx, 'update-character-public-info')

	let characterInfo: CharacterPublicInfo | null = null
	const esiStub = getEsiInstanceForCharacter(ctx.env.ESI, characterId)
	try {
		characterInfo = await esiStub.fetchCharacterPublicInfo(characterId, {
			cacheMode: ctx.refreshMode === 'manual' ? 'no-store' : 'default',
		})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		logger.error('[Workflow] Failed to fetch character public info', {
			characterId,
			error: errorMessage,
		})

		const isDeletedCharacterError =
			error instanceof CharacterDeletedError ||
			errorMessage.includes('Character has been deleted!') ||
			/character .* has been deleted/i.test(errorMessage)

		if (isDeletedCharacterError) {
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

		throw error
	}

	if (!characterInfo) {
		throw new Error(`No character public info found for character ID: ${characterId}`)
	}

	const allianceId = characterInfo.alliance_id ? String(characterInfo.alliance_id) : null

	// Persist the authoritative affiliation IDs before any best-effort name resolution.
	await ctx.db
		.update(userCharacters)
		.set({
			characterName: characterInfo.name,
			corporationId: characterInfo.corporation_id,
			allianceId,
			isDeleted: false,
			lastCharacterRefresh: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(userCharacters.characterId, characterId))

	const typeResolver = getStub<EsiTypeResolver>(ctx.env.ESI_TYPE_RESOLVER, 'global')
	const idsToResolve = [characterInfo.corporation_id]
	if (allianceId) {
		idsToResolve.push(allianceId)
	}

	let corporationName: string | null = null
	let allianceName: string | null = null
	try {
		const nameMap = await typeResolver.resolveIds(idsToResolve)
		corporationName = nameMap[characterInfo.corporation_id] ?? null
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
			corporationId: characterInfo.corporation_id,
			allianceId,
		})
	}

	// Sync to eve-character-data store (drives character detail page).
	// Non-blocking: failure here must not prevent the workflow from continuing.
	try {
		const eveCharDataStub = getStub<EveCharacterData>(ctx.env.EVE_CHARACTER_DATA, characterId)
		await Promise.all([
			eveCharDataStub.storePublicInfo(characterId, characterInfo),
			eveCharDataStub.fetchCorporationHistory(characterId),
		])
		logger.info('[Workflow] Synced character public data to eve-character-data', {
			characterId,
		})
	} catch (error) {
		logger.warn('[Workflow] Failed to sync to eve-character-data; continuing', {
			characterId,
			error: error instanceof Error ? error.message : String(error),
		})
	}

	logger.info('[Workflow] Updated character public info', {
		characterId,
		userId: ctx.userId,
		workflowInstanceId: ctx.workflowInstanceId,
	})

	return {
		characterId: characterId,
		characterName: characterInfo.name,
		corporationId: characterInfo.corporation_id,
		corporationName,
		allianceId,
		allianceName,
		isDeleted: false,
	}
}
