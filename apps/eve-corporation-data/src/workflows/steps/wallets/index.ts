import { logger } from '@repo/hono-helpers'

import * as esiFetch from '../../../services/esi-fetch'
import { getCorporationDataStub, getCorporationEsi } from '../../utils/services'

import type { Env } from '../../../context'

export type WalletsData = Awaited<ReturnType<typeof esiFetch.fetchWallets>>

export async function fetchWallets(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<WalletsData> {
	const wallets = await esiFetch.fetchWallets(
		getCorporationEsi(env, corporationId),
		corporationId,
		directorCharacterId
	)

	logger.debug('[WalletsStep] Fetched wallets', {
		corporationId,
		count: wallets.length,
	})

	return wallets
}

export async function storeWallets(
	env: Env,
	corporationId: string,
	wallets: WalletsData
): Promise<void> {
	const corpData = getCorporationDataStub(env, corporationId)
	await corpData.storeWallets(corporationId, wallets)

	logger.info('[WalletsStep] Stored wallets', { corporationId, count: wallets.length })
}
