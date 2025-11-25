import { logger } from '@repo/hono-helpers'

import { getGlobalCorporationDataStub } from '../../utils/services'

import type { EveCorporationSyncDataType } from '@repo/eve-corporation-data'
import type { Env } from '../../../context'

/**
 * Send HR cleanup messages for departed members
 */
export async function sendHrDepartedMessages(
	env: Env,
	corporationId: string,
	departedMemberIds: string[]
): Promise<void> {
	if (!departedMemberIds.length) {
		return
	}

	const hrQueue = env['hr-member-departed']
	const batch = departedMemberIds.map((characterId) => ({
		body: { corporationId, characterId },
	}))

	await hrQueue.sendBatch(batch)

	logger.info('[CommonStep] HR messages sent', {
		corporationId,
		count: departedMemberIds.length,
	})
}

/**
 * Update per-type sync timestamps in the Durable Object
 */
export async function updateSyncTimestamps(
	env: Env,
	corporationId: string,
	syncedDataTypes: EveCorporationSyncDataType[]
): Promise<void> {
	const syncPropertyMap: Partial<Record<EveCorporationSyncDataType, string>> = {
		members: 'membersLastSync',
		'member-tracking': 'memberTrackingLastSync',
		wallets: 'walletsLastSync',
		'wallet-journal': 'walletJournalLastSync',
		'wallet-transactions': 'walletTransactionsLastSync',
		assets: 'assetsLastSync',
		structures: 'structuresLastSync',
		orders: 'ordersLastSync',
		contracts: 'contractsLastSync',
		'industry-jobs': 'industryJobsLastSync',
		killmails: 'killmailsLastSync',
	}

	const properties = syncedDataTypes
		.filter((type) => type !== 'public-info' && syncPropertyMap[type])
		.map((type) => syncPropertyMap[type]!)

	if (!properties.length) {
		logger.debug('[CommonStep] No sync timestamps to update', { corporationId })
		return
	}

	const stub = getGlobalCorporationDataStub(env)
	await stub.batchUpdateCorporationSyncTimestamps(corporationId, properties)

	logger.info('[CommonStep] Sync timestamps updated', {
		corporationId,
		properties,
	})
}

/**
 * Update the Core worker with the last sync timestamp
 */
export async function updateCoreLastSync(env: Env, corporationId: string): Promise<void> {
	await env.CORE.updateCorporationLastSync(corporationId)
}

