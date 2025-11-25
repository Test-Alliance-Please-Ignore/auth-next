import { logger } from '@repo/hono-helpers'

import * as esiFetch from '../../../services/esi-fetch'
import { createTokenStore, getCorporationDataStub } from '../../utils/services'

import type { Env } from '../../../context'

export type KillmailsData = Awaited<ReturnType<typeof esiFetch.fetchKillmails>>

export async function fetchKillmails(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<KillmailsData> {
	const tokenStore = createTokenStore(env)
	const killmails = await esiFetch.fetchKillmails(tokenStore, corporationId, directorCharacterId)

	logger.debug('[KillmailsStep] Fetched killmails', {
		corporationId,
		count: killmails.length,
	})

	return killmails
}

export async function storeKillmails(
	env: Env,
	corporationId: string,
	killmails: KillmailsData
): Promise<void> {
	const corpData = getCorporationDataStub(env, corporationId)
	await corpData.storeKillmails(corporationId, killmails)

	logger.info('[KillmailsStep] Stored killmails', {
		corporationId,
		count: killmails.length,
	})
}

