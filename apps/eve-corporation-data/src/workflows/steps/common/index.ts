import { logger } from '@repo/hono-helpers'

import { getCorporationTaxStub, getGlobalCorporationDataStub } from '../../utils/services'

import type {
	TriggerTaxProjectionRefreshInput,
	TriggerTaxProjectionRefreshResult,
} from '@repo/corporation-tax'
import type { EveCorporationSyncDataType } from '@repo/eve-corporation-data'
import type { Env } from '../../../context'

const TAX_PROJECTION_RETRY_KEY_PREFIX = 'tax-projection-retry-intent:'
const TAX_PROJECTION_RETRY_TTL_SECONDS = 7 * 24 * 60 * 60

type TaxProjectionRetryIntent = {
	corporationId: string
	actorUserId: string
	input: SerializedTaxProjectionRefreshInput
	lastError: string
	recordedAt: string
	retryCount: number
}

type SerializedTaxWalletSourceWatermark = {
	maxId: string | null
	maxDate: string | null
	fetchedCount: number
}

type SerializedTaxProjectionRefreshInput = Omit<
	TriggerTaxProjectionRefreshInput,
	'triggeredAt' | 'walletJournal' | 'walletTransactions'
> & {
	triggeredAt: string
	walletJournal?: SerializedTaxWalletSourceWatermark | null
	walletTransactions?: SerializedTaxWalletSourceWatermark | null
}

function toIsoDateString(value: Date | string | null | undefined): string | null {
	if (value === null || value === undefined) {
		return null
	}
	const parsed = value instanceof Date ? value : new Date(value)
	return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function toDate(value: Date | string | null | undefined): Date | null {
	if (value === null || value === undefined) {
		return null
	}
	const parsed = value instanceof Date ? value : new Date(value)
	return Number.isNaN(parsed.getTime()) ? null : parsed
}

function serializeTaxProjectionRefreshInput(
	input: TriggerTaxProjectionRefreshInput
): SerializedTaxProjectionRefreshInput {
	const triggeredAt = toIsoDateString(input.triggeredAt)
	if (!triggeredAt) {
		throw new Error('Invalid tax projection retry input: triggeredAt is not a valid date')
	}

	return {
		corporationId: input.corporationId,
		upstreamRunId: input.upstreamRunId,
		triggeredAt,
		walletJournal: input.walletJournal
			? {
					fetchedCount: input.walletJournal.fetchedCount,
					maxId: input.walletJournal.maxId,
					maxDate: toIsoDateString(input.walletJournal.maxDate),
				}
			: (input.walletJournal ?? null),
		walletTransactions: input.walletTransactions
			? {
					fetchedCount: input.walletTransactions.fetchedCount,
					maxId: input.walletTransactions.maxId,
					maxDate: toIsoDateString(input.walletTransactions.maxDate),
				}
			: (input.walletTransactions ?? null),
		includeCharacterWallets: input.includeCharacterWallets,
	}
}

function hydrateTaxProjectionRefreshInput(
	input: SerializedTaxProjectionRefreshInput
): TriggerTaxProjectionRefreshInput {
	const triggeredAt = toDate(input.triggeredAt)
	if (!triggeredAt) {
		throw new Error('Invalid tax projection retry input: triggeredAt is not a valid date')
	}

	return {
		corporationId: input.corporationId,
		upstreamRunId: input.upstreamRunId,
		triggeredAt,
		walletJournal: input.walletJournal
			? {
					fetchedCount: input.walletJournal.fetchedCount,
					maxId: input.walletJournal.maxId,
					maxDate: toDate(input.walletJournal.maxDate),
				}
			: (input.walletJournal ?? null),
		walletTransactions: input.walletTransactions
			? {
					fetchedCount: input.walletTransactions.fetchedCount,
					maxId: input.walletTransactions.maxId,
					maxDate: toDate(input.walletTransactions.maxDate),
				}
			: (input.walletTransactions ?? null),
		includeCharacterWallets: input.includeCharacterWallets,
	}
}

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

/**
 * Trigger tax projection refresh based on upstream wallet-sync watermarks.
 */
export async function triggerTaxProjectionRefresh(
	env: Env,
	actorUserId: string,
	input: TriggerTaxProjectionRefreshInput
): Promise<TriggerTaxProjectionRefreshResult> {
	const taxStub = getCorporationTaxStub(env)
	const result = await taxStub.triggerProjectionRefreshFromWalletSync(actorUserId, input)

	logger.info('[CommonStep] Triggered tax projection refresh from wallet sync', {
		corporationId: input.corporationId,
		upstreamRunId: input.upstreamRunId,
		triggered: result.triggered,
		reason: result.reason,
	})

	return result
}

function getTaxProjectionRetryKey(corporationId: string): string {
	return `${TAX_PROJECTION_RETRY_KEY_PREFIX}${corporationId}`
}

export async function recordTaxProjectionRetryIntent(
	env: Env,
	corporationId: string,
	actorUserId: string,
	input: TriggerTaxProjectionRefreshInput,
	errorMessage: string
): Promise<void> {
	const key = getTaxProjectionRetryKey(corporationId)
	const existingRaw = await env.CACHE.get(key)
	const existing = existingRaw ? (JSON.parse(existingRaw) as TaxProjectionRetryIntent) : null
	const retryCount = existing ? existing.retryCount + 1 : 1

	const payload: TaxProjectionRetryIntent = {
		corporationId,
		actorUserId,
		input: serializeTaxProjectionRefreshInput(input),
		lastError: errorMessage,
		recordedAt: new Date().toISOString(),
		retryCount,
	}

	await env.CACHE.put(key, JSON.stringify(payload), {
		expirationTtl: TAX_PROJECTION_RETRY_TTL_SECONDS,
	})

	logger.warn('[CommonStep] Recorded tax projection retry intent', {
		corporationId,
		retryCount,
	})
}

export async function clearTaxProjectionRetryIntent(
	env: Env,
	corporationId: string
): Promise<void> {
	await env.CACHE.delete(getTaxProjectionRetryKey(corporationId))
}

export async function replayTaxProjectionRetryIntent(
	env: Env,
	corporationId: string
): Promise<{
	replayed: boolean
	succeeded: boolean
	retryCount: number
	reason: string
}> {
	const key = getTaxProjectionRetryKey(corporationId)
	const raw = await env.CACHE.get(key)
	if (!raw) {
		return { replayed: false, succeeded: false, retryCount: 0, reason: 'none' }
	}

	const intent = JSON.parse(raw) as TaxProjectionRetryIntent
	const hydratedInput = hydrateTaxProjectionRefreshInput(intent.input)
	try {
		const result = await triggerTaxProjectionRefresh(env, intent.actorUserId, hydratedInput)
		await clearTaxProjectionRetryIntent(env, corporationId)
		return {
			replayed: true,
			succeeded: true,
			retryCount: intent.retryCount,
			reason: result.reason,
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		await recordTaxProjectionRetryIntent(
			env,
			corporationId,
			intent.actorUserId,
			hydratedInput,
			message
		)
		return {
			replayed: true,
			succeeded: false,
			retryCount: intent.retryCount + 1,
			reason: message,
		}
	}
}
