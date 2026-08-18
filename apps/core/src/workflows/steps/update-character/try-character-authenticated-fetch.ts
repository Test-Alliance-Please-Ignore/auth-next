/**
 * Validate authenticated character access for refresh-sensitive workflows.
 */

import { and, eq } from 'drizzle-orm'

import { getStub } from '@repo/do-utils'

import { managedCorporations, userCharacters } from '../../../db/schema'
import {
	didTokenTransitionFromValidToInvalid,
	queueTokenInvalidationAlertsForUser,
} from '../../../lib/token-invalid-alerts'
import {
	markCharacterTokenInvalidFromAuthFailure,
	validateAndSyncCharacterTokenValidity,
} from '../../../lib/token-validity'
import { getWorkflowLogger } from '../../context'

import type { Core as CoreRpc } from '@repo/core'
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
	tokenInvalidated?: boolean
}> {
	const logger = getWorkflowLogger(ctx, 'validate-character-token')
	const eveTokenStore = getStub<EveTokenStore>(ctx.env.EVE_TOKEN_STORE, 'default')
	const eveCharacterData = getStub<EveCharacterData>(ctx.env.EVE_CHARACTER_DATA, 'default')

	const existingCharacter = await ctx.db.query.userCharacters.findFirst({
		where: eq(userCharacters.characterId, characterId),
		columns: { corporationId: true, hasValidToken: true },
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

	const tokenInvalidated = didTokenTransitionFromValidToInvalid(
		previousHasValidToken,
		nextHasValidToken
	)

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
			const downgradedToken = await markCharacterTokenInvalidFromAuthFailure({
				db: ctx.db,
				characterId,
				error,
				touchLastCharacterRefresh: true,
			})
			logger.error('[Workflow] Failed to refresh authenticated character data', {
				characterId,
				downgradedToken,
				error: errorMessage,
				errorDetails: extractErrorDetails(error),
			})
			if (downgradedToken && didTokenTransitionFromValidToInvalid(previousHasValidToken, false)) {
				try {
					const coreStub = getStub<CoreRpc>(ctx.env.CORE, 'default')
					const queueResult = await queueTokenInvalidationAlertsForUser(coreStub, {
						userId: ctx.userId,
						characterIds: [characterId],
						source: 'character-refresh-token-invalidated',
					})
					logger.info('[Workflow] Queued token invalidation alert', {
						characterId,
						userId: ctx.userId,
						queueResult,
					})
				} catch (queueError) {
					logger.warn('[Workflow] Failed to queue token invalidation alert; continuing', {
						characterId,
						userId: ctx.userId,
						error: queueError instanceof Error ? queueError.message : String(queueError),
					})
				}
			}
			return {
				characterId,
				error: errorMessage,
				status: downgradedToken ? 'invalid_token' : validation.status,
				success: false,
				tokenInvalidated: downgradedToken && previousHasValidToken === true,
			}
		}

		if (ctx.includeWalletJournal) {
			try {
				const memberCorporation = existingCharacter?.corporationId
					? await ctx.db.query.managedCorporations.findFirst({
							where: and(
								eq(managedCorporations.corporationId, existingCharacter.corporationId),
								eq(managedCorporations.isMemberCorporation, true)
							),
							columns: { corporationId: true },
						})
					: null

				if (memberCorporation) {
					await eveCharacterData.fetchWalletJournal(characterId, true)
					logger.info('[Workflow] Refreshed character wallet journal', {
						characterId,
						corporationId: memberCorporation.corporationId,
					})
				} else {
					logger.info('[Workflow] Skipped character wallet journal for non-member corporation', {
						characterId,
						corporationId: existingCharacter?.corporationId ?? null,
					})
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				logger.error('[Workflow] Failed to refresh character wallet journal', {
					characterId,
					error: errorMessage,
					errorDetails: extractErrorDetails(error),
				})
				return {
					characterId,
					error: errorMessage,
					status: validation.status,
					success: false,
					tokenInvalidated: false,
				}
			}
		}
	}

	if (tokenInvalidated) {
		try {
			const coreStub = getStub<CoreRpc>(ctx.env.CORE, 'default')
			const queueResult = await queueTokenInvalidationAlertsForUser(coreStub, {
				userId: ctx.userId,
				characterIds: [characterId],
				source: 'character-refresh-token-invalidated',
			})
			logger.info('[Workflow] Queued token invalidation alert', {
				characterId,
				userId: ctx.userId,
				queueResult,
			})
		} catch (error) {
			logger.warn('[Workflow] Failed to queue token invalidation alert; continuing', {
				characterId,
				userId: ctx.userId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	return {
		characterId: characterId,
		error: validation.error,
		status: validation.status,
		success: validation.isValid,
		tokenInvalidated:
			previousHasValidToken === true &&
			(nextHasValidToken === false ||
				(validation.isValid === false && validation.status !== 'transient_error')),
	}
}
