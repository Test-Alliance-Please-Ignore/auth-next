import { logger } from '@repo/hono-helpers'

import type { Env } from '../../context'

export interface RefreshMiningLedgerResult {
	success: boolean
	stub: true
}

/**
 * Refresh character mining ledger (stub implementation)
 * Creates its own Durable Object stubs to avoid sharing invalidated stubs
 * This is a stub that will be implemented in the future
 */
export async function refreshMiningLedger(
	_env: Env,
	characterId: string
): Promise<RefreshMiningLedgerResult> {
	logger.info('[refreshMiningLedger] Mining ledger refresh not yet implemented (stub)', {
		characterId,
	})

	// Stub implementation - return success but do nothing
	return {
		success: true,
		stub: true,
	}
}

