/**
 * Update database with workflow completion timestamp
 */

import { eq } from 'drizzle-orm'

import { getEsiInstanceForCharacter } from '@repo/esi'

import { userCharacters } from '../../../db/schema'
import { getWorkflowLogger } from '../../context'

import type { WorkflowContext } from '../../context'

/**
 * Update database to mark workflow as completed
 *
 * @param ctx - Workflow context
 */
export async function tryCharacterAuthenticatedFetch(
	ctx: WorkflowContext,
	characterId: string
): Promise<{
	characterId: string
	success: boolean
	error?: string
}> {
	const logger = getWorkflowLogger(ctx, 'try-character-authenticated-fetch')

	const esiStub = getEsiInstanceForCharacter(ctx.env.ESI, characterId)

	let success = false
	let errorMessage: string | undefined
	try {
		await esiStub.fetchCharacterLocation(characterId)
		logger.info('[Workflow] Fetched character location', {
			characterId,
		})
		success = true
	} catch (error) {
		errorMessage = error instanceof Error ? error.message : String(error)
		logger.error('[Workflow] Failed to fetch character location', {
			characterId,
			error: errorMessage,
		})
		success = false
	}

	await ctx.db
		.update(userCharacters)
		.set({
			lastCharacterRefresh: new Date(),
			updatedAt: new Date(),
			hasValidToken: success,
		})
		.where(eq(userCharacters.characterId, characterId))

	return {
		characterId: characterId,
		success: success,
		error: errorMessage,
	}
}
