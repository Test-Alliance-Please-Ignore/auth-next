import { eq } from 'drizzle-orm'

import { userCharacters } from '../../../db/schema'
import { getWorkflowLogger } from '../../context'

import type { WorkflowContext } from '../../context'

/**
 * Handle character deleted
 *
 * @param ctx - Workflow context
 */
export async function handleCharacterDeleted(
	ctx: WorkflowContext,
	characterId: string
): Promise<void> {
	const logger = getWorkflowLogger(ctx, 'handle-character-deleted')
	await ctx.db
		.update(userCharacters)
		.set({
			isDeleted: true,
			updatedAt: new Date(),
		})
		.where(eq(userCharacters.characterId, characterId))

	logger.info('[Workflow] Character marked as deleted', {
		characterId,
	})
}
