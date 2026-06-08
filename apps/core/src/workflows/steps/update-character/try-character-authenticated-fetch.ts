/**
 * Validate authenticated character access for refresh-sensitive workflows.
 */

import { eq } from 'drizzle-orm'

import { getStub } from '@repo/do-utils'

import { userCharacters } from '../../../db/schema'
import { validateAndSyncCharacterTokenValidity } from '../../../lib/token-validity'
import { getWorkflowLogger } from '../../context'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore, TokenValidationStatus } from '@repo/eve-token-store'
import type { WorkflowContext } from '../../context'

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
	status?: TokenValidationStatus
}> {
	const logger = getWorkflowLogger(ctx, 'validate-character-token')
	const eveTokenStore = getStub<EveTokenStore>(ctx.env.EVE_TOKEN_STORE, 'default')
	const eveCharacterData = getStub<EveCharacterData>(ctx.env.EVE_CHARACTER_DATA, characterId)

	const existingCharacter = await ctx.db.query.userCharacters.findFirst({
		where: eq(userCharacters.characterId, characterId),
	})

	const { previousHasValidToken, nextHasValidToken, validation } =
		await validateAndSyncCharacterTokenValidity({
			db: ctx.db,
			tokenStore: eveTokenStore,
			characterId,
			previousHasValidToken: existingCharacter?.hasValidToken ?? null,
			touchLastCharacterRefresh: true,
			forceValidate: ctx.forceTokenValidation === true,
		})

	logger.info('[Workflow] Evaluated character token validity', {
		characterId,
		missingScopes: validation.missingScopes,
		previousHasValidToken,
		refreshAttempted: validation.refreshAttempted,
		refreshSucceeded: validation.refreshSucceeded,
		scopeCount: validation.scopes.length,
		status: validation.status,
	})

	// If token validation succeeded, refresh authenticated character data in EVE_CHARACTER_DATA.
	// This populates private fields (including wallet balance) used by character detail views.
	if (validation.isValid) {
		try {
			await eveCharacterData.fetchAuthenticatedData(characterId, true)
			logger.info('[Workflow] Refreshed authenticated character data', {
				characterId,
			})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error('[Workflow] Failed to refresh authenticated character data', {
				characterId,
				error: errorMessage,
				errorDetails: extractErrorDetails(error),
			})
			return {
				characterId,
				error: errorMessage,
				status: validation.status,
				success: false,
			}
		}
	}

	return {
		characterId: characterId,
		error: validation.error,
		status: validation.status,
		success: validation.isValid,
	}
}
