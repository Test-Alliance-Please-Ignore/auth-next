import { logger } from '@repo/hono-helpers'

import type { Env } from '../../context'

export interface RefreshFittingsResult {
	success: boolean
	stub: true
}

/**
 * Refresh character fittings (stub implementation)
 * Creates its own Durable Object stubs to avoid sharing invalidated stubs
 * This is a stub that will be implemented in the future
 */
export async function refreshFittings(
	_env: Env,
	characterId: string
): Promise<RefreshFittingsResult> {
	logger.info('[refreshFittings] Fittings refresh not yet implemented (stub)', {
		characterId,
	})

	// Stub implementation - return success but do nothing
	return {
		success: true,
		stub: true,
	}
}

