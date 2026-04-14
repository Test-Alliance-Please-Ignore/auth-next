import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { Env } from '../../context'

export interface RefreshPublicInfoResult {
	success: boolean
	characterName?: string
}

function extractErrorDetails(error: unknown): Record<string, unknown> {
	if (!error || typeof error !== 'object') {
		return { rawError: String(error) }
	}

	const e = error as Record<string, unknown>
	return {
		name: e.name,
		message: e.message,
		code: e.code,
		detail: e.detail,
		hint: e.hint,
		constraint: e.constraint,
		table: e.table,
		column: e.column,
		schema: e.schema,
		severity: e.severity,
		where: e.where,
		routine: e.routine,
		stack: e.stack,
		cause: e.cause,
	}
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
			errorDetails: extractErrorDetails(error),
		})
		throw error
	}
}
