import { logger } from '@repo/hono-helpers'

import type { Env } from '../../context'

export interface RefreshAssetsResult {
	success: boolean
	stub: true
}

/**
 * Refresh character assets (stub implementation)
 * Creates its own Durable Object stubs to avoid sharing invalidated stubs
 * This is a stub that will be implemented in a separate plan
 */
export async function refreshAssets(
	_env: Env,
	characterId: string
): Promise<RefreshAssetsResult> {
	logger.info('[refreshAssets] Assets refresh not yet implemented (stub)', {
		characterId,
	})

	// Stub implementation - return success but do nothing
	return {
		success: true,
		stub: true,
	}
}

