import { sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { createDb } from './db'

import type { Features } from '@repo/features'
import type { Markets } from '@repo/markets'
import type { Env } from './context'

const PRICING_INGEST_FLAG_KEY = 'markets.pricing.ingest.enabled'

async function isPricingIngestEnabled(env: Env): Promise<boolean> {
	if (!env.FEATURES) return false
	try {
		const stub = getStub<Features>(env.FEATURES, 'default')
		const value = await stub.checkFlag(PRICING_INGEST_FLAG_KEY)
		return value === null ? false : value === true
	} catch {
		return false
	}
}

/**
 * Scheduled handler — runs hourly via cron trigger.
 *
 * Each run upserts today's snapshot row in market_daily_prices / insurance_daily_prices
 * so price data stays current throughout the day. The last run of the day wins.
 *
 * 1. Disables lingering order-book snapshot alarms (idempotent, one-time migration)
 * 2. Dispatches a DailyPriceBatchWorkflow instance for the current UTC date
 * 3. Trims market_daily_prices rows older than MAX_DAILY_PRICE_HISTORY_DAYS
 *
 * Skipped entirely when the `markets.pricing.ingest.enabled` feature flag is false.
 */
export async function scheduledHandler(_event: ScheduledEvent, env: Env): Promise<void> {
	if (!(await isPricingIngestEnabled(env))) {
		console.log('[scheduledHandler] Pricing ingest disabled by feature flag — skipping')
		return
	}

	// Stop lingering order-book alarm on the Jita region DO (idempotent)
	try {
		const jitaStub = getStub<Markets>(env.MARKETS, 'region-10000002')
		await jitaStub.stopHourlySnapshots('10000002')
	} catch {
		// Never started or already stopped — safe to ignore
	}

	const now = new Date()
	const targetDate = now.toISOString().slice(0, 10) // today's UTC date: 'YYYY-MM-DD'
	const hour = now.getUTCHours().toString().padStart(2, '0')

	console.log(`[scheduledHandler] Dispatching price snapshot for ${targetDate} hour ${hour}`)

	await env.DAILY_PRICE_BATCH_WORKFLOW.create({
		id: `price-snapshot-${targetDate}-${hour}`,
		params: { targetDate },
	})

	// Trim daily price rows beyond retention window
	const maxDays = env.MAX_DAILY_PRICE_HISTORY_DAYS ?? 60
	const db = createDb(env.DATABASE_URL)
	await db.execute(sql`
		DELETE FROM market_daily_prices
		WHERE price_date < (CURRENT_DATE - (${maxDays} || ' days')::interval)::date
	`)
	console.log(`[scheduledHandler] Trimmed prices older than ${maxDays} days`)
}
