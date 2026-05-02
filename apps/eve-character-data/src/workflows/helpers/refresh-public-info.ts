import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { Env } from '../../context'

export interface RefreshPublicInfoResult {
	success: boolean
	characterName?: string
	affiliationChanged?: boolean
	previousCorporationId?: string | null
	currentCorporationId?: string | null
	previousAllianceId?: string | null
	currentAllianceId?: string | null
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
		const previousCharacterInfo = await characterDataStub.getCharacterInfo(normalizedCharacterId)

		// Fetch and store public data (public info, portrait, corporation history)
		await characterDataStub.fetchCharacterData(normalizedCharacterId, true)

		// Get character info to return name
		const characterInfo = await characterDataStub.getCharacterInfo(normalizedCharacterId)
		const characterName = characterInfo?.name
		const previousCorporationId = previousCharacterInfo?.corporationId ?? null
		const currentCorporationId = characterInfo?.corporationId ?? null
		const previousAllianceId = previousCharacterInfo?.allianceId ?? null
		const currentAllianceId = characterInfo?.allianceId ?? null
		const affiliationChanged =
			previousCorporationId !== currentCorporationId || previousAllianceId !== currentAllianceId

		logger.info('[refreshPublicInfo] Public info refreshed', {
			characterId: normalizedCharacterId,
			characterName,
			affiliationChanged,
			previousCorporationId,
			currentCorporationId,
			previousAllianceId,
			currentAllianceId,
		})

		return {
			success: true,
			characterName,
			affiliationChanged,
			previousCorporationId,
			currentCorporationId,
			previousAllianceId,
			currentAllianceId,
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
