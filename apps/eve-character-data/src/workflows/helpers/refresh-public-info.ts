import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { Env } from '../../context'

export interface RefreshPublicInfoResult {
	success: boolean
	characterName?: string
}

/**
 * Refresh public character data (public info, portrait, corporation history)
 * Creates its own Durable Object stubs to avoid sharing invalidated stubs
 */
export async function refreshPublicInfo(
	env: Env,
	characterId: string
): Promise<RefreshPublicInfoResult> {
	// Create fresh stubs for this operation
	const characterDataStub = getStub<EveCharacterData>(env.EVE_CHARACTER_DATA, characterId)
	const characterData = await characterDataStub.getInstance(characterId)

	try {
		// Fetch and store public data (public info, portrait, corporation history)
		await characterData.fetchCharacterData(true)

		// Get character info to return name
		const characterInfo = await characterData.getCharacterInfo()
		const characterName = characterInfo?.name

		logger.info('[refreshPublicInfo] Public info refreshed', {
			characterId,
			characterName,
		})

		return {
			success: true,
			characterName,
		}
	} catch (error) {
		logger.error('[refreshPublicInfo] Failed to refresh public info', {
			characterId,
			error: error instanceof Error ? error.message : String(error),
		})
		throw error
	}
}
