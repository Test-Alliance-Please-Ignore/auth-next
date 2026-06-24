import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import type { CharacterPublicRefreshResult, EveCharacterData } from '@repo/eve-character-data'
import type { Env } from '../../context'

export type RefreshPublicInfoResult = CharacterPublicRefreshResult

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
 * `forceRefresh` is reserved for manual refresh paths that need to bypass cache
 * and should remain false for the normal character sync workflow.
 */
export async function refreshPublicInfo(
	env: Env,
	characterId: string,
	forceRefresh = false
): Promise<RefreshPublicInfoResult> {
	const normalizedCharacterId = String(characterId)

	// Create fresh stubs for this operation
	const characterDataStub = getStub<EveCharacterData>(env.EVE_CHARACTER_DATA, normalizedCharacterId)

	logger.info('[refreshPublicInfo] Starting public info refresh', {
		characterId: normalizedCharacterId,
		forceRefresh,
	})

	try {
		const result = await characterDataStub.refreshPublicCharacterData(
			normalizedCharacterId,
			forceRefresh
		)

		logger.info('[refreshPublicInfo] Public info refreshed', {
			characterId: normalizedCharacterId,
			characterName: result.characterName,
			affiliationChanged: result.affiliationChanged,
			previousCorporationId: result.previousCorporationId,
			currentCorporationId: result.currentCorporationId,
			previousAllianceId: result.previousAllianceId,
			currentAllianceId: result.currentAllianceId,
		})

		return result
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		logger.error('[refreshPublicInfo] Failed to refresh public info', {
			characterId: normalizedCharacterId,
			forceRefresh,
			error: errorMessage,
			errorDetails: extractErrorDetails(error),
		})
		throw error
	}
}
