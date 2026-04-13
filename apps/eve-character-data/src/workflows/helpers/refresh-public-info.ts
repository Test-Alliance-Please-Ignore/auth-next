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
	const normalizedCharacterId = String(characterId)

	// Create fresh stubs for this operation
	const characterDataStub = getStub<EveCharacterData>(env.EVE_CHARACTER_DATA, normalizedCharacterId)

	try {
		// Fetch and store public data (public info, portrait, corporation history)
		await characterDataStub.fetchCharacterData(normalizedCharacterId, true)

		// Get character info to return name
		const characterInfo = await characterDataStub.getCharacterInfo(normalizedCharacterId)
		const characterName = characterInfo?.name

		logger.info('[refreshPublicInfo] Public info refreshed', {
			characterId: normalizedCharacterId,
			characterName,
		})

		return {
			success: true,
			characterName,
		}
	} catch (error) {
		logger.error('[refreshPublicInfo] Failed to refresh public info', {
			characterId: normalizedCharacterId,
			error: error instanceof Error ? error.message : String(error),
		})
		throw error
	}
}
