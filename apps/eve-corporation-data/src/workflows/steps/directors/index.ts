import { logger } from '@repo/hono-helpers'

import { createDirectorManager } from '../../utils/services'

import type { Env } from '../../../context'
import type { DirectorInfo } from '../../types'
import type { CorporationRole } from '@repo/eve-corporation-data'

/**
 * Select a healthy director for the corporation
 */
export async function selectDirector(
	env: Env,
	corporationId: string,
	options?: { requiredRoleSets?: CorporationRole[][] }
): Promise<DirectorInfo | null> {
	try {
		const directorManager = createDirectorManager(env, corporationId)
		const selected = await directorManager.selectDirector(options)

		if (!selected) {
			logger.error('[DirectorStep] No healthy directors available', { corporationId })
			return null
		}

		logger.info('[DirectorStep] Director selected', {
			corporationId,
			characterId: selected.characterId,
			characterName: selected.characterName,
		})

		return selected
	} catch (error) {
		logger.error(
			'[DirectorStep] Director selection failed; continuing without authenticated steps',
			{
				corporationId,
				error: error instanceof Error ? error.message : String(error),
			}
		)
		return null
	}
}

/**
 * Record success for the director once workflow completes
 */
export async function recordDirectorSuccess(
	env: Env,
	corporationId: string,
	directorId: string
): Promise<void> {
	const directorManager = createDirectorManager(env, corporationId)
	await directorManager.recordSuccess(directorId)
}

export async function recordDirectorFailure(
	env: Env,
	corporationId: string,
	directorId: string,
	reason: string,
	options?: { forceUnhealthy?: boolean }
): Promise<void> {
	const directorManager = createDirectorManager(env, corporationId)
	await directorManager.recordFailure(directorId, reason, options)
}

export async function verifyAllDirectorsHealth(
	env: Env,
	corporationId: string
): Promise<{ verified: number; failed: number }> {
	const directorManager = createDirectorManager(env, corporationId)
	return await directorManager.verifyAllDirectorsHealth()
}
