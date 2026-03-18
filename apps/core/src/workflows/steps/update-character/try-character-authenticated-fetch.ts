/**
 * Validate authenticated character access for refresh-sensitive workflows.
 */

import { eq } from 'drizzle-orm'

import { getStub } from '@repo/do-utils'

import { userCharacters } from '../../../db/schema'
import { getWorkflowLogger } from '../../context'

import type { EveTokenStore, TokenValidationStatus } from '@repo/eve-token-store'
import type { WorkflowContext } from '../../context'

const NON_DEGRADING_TOKEN_STATUSES: TokenValidationStatus[] = ['transient_error']

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
	const logger = getWorkflowLogger(ctx, 'try-character-authenticated-fetch')
	const eveTokenStore = getStub<EveTokenStore>(ctx.env.EVE_TOKEN_STORE, 'default')

	const existingCharacter = await ctx.db.query.userCharacters.findFirst({
		where: eq(userCharacters.characterId, characterId),
	})

	const previousHasValidToken = existingCharacter?.hasValidToken ?? null
	const validation = await eveTokenStore.validateToken(characterId)

	const shouldPreservePreviousState = NON_DEGRADING_TOKEN_STATUSES.includes(validation.status)
	const nextHasValidToken = shouldPreservePreviousState ? previousHasValidToken : validation.isValid

	logger.info('[Workflow] Evaluated character token validity', {
		characterId,
		missingScopes: validation.missingScopes,
		previousHasValidToken,
		refreshAttempted: validation.refreshAttempted,
		refreshSucceeded: validation.refreshSucceeded,
		scopeCount: validation.scopes.length,
		status: validation.status,
	})

	await ctx.db
		.update(userCharacters)
		.set({
			lastCharacterRefresh: new Date(),
			updatedAt: new Date(),
			hasValidToken: nextHasValidToken,
		})
		.where(eq(userCharacters.characterId, characterId))

	return {
		characterId: characterId,
		error: validation.error,
		status: validation.status,
		success: validation.isValid,
	}
}
