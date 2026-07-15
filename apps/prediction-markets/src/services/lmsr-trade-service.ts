/**
 * LMSR share trading (buy). Structurally mirrors the parimutuel `placeBet` write path — whole-method
 * try/catch, idempotency dedupe pre-check, rate limit, market row `FOR UPDATE`, idempotency-gate insert
 * before any money moves, then the money move — and REUSES the shared `creditWallet`/`debitWallet`
 * primitives and `consumeRateBudget`. The only LMSR-specific step is pricing the trade with the
 * fixed-point cost function; the money that moves is an integer point cost quantized in the maker's favor.
 */

import { eq, sql } from '@repo/db-utils'
import { captureException, logger } from '@repo/hono-helpers'
import { LMSR_HOUSE_WALLET_USER_ID } from '@repo/prediction-markets'

import { lmsrMarkets, lmsrOutcomes, lmsrPositions, lmsrTrades } from '../db/schema'
import { isExpectedError, PmError } from '../lib/errors'
import { buyCost } from '../lib/lmsr'
import { formatAmount, isPositiveIntegerString, parseAmount } from '../lib/money'
import { dbErrorCause } from './context'
import { lmsrLedgerMetadata, loadLmsrOutcomes, logLmsrHistory, toLmsrTradeResult } from './lmsr-shared'
import { consumeRateBudget, creditWallet, debitWallet } from './shared'

import type { BuyLmsrSharesInput, LmsrTradeResult } from '@repo/prediction-markets'
import type { PmDeps } from './context'

export async function buyShares(
	deps: PmDeps,
	input: BuyLmsrSharesInput
): Promise<LmsrTradeResult & { deduped: boolean }> {
	// The try spans the WHOLE method — the dedupe SELECT and the rate-limit upsert run before the txn
	// and can also fail (missing table before migration, Neon outage); wrapping everything ensures those
	// infra errors are logged with their driver cause and paged, not surfaced as a bare failure.
	try {
		if (!isPositiveIntegerString(input.shares)) throw new PmError('LMSR_INVALID_SHARES')
		const delta = parseAmount(input.shares)
		const maxCost = input.maxCost != null ? parseAmount(input.maxCost) : null

		// Dedupe pre-check (outside the txn): a duplicate delivery (same interaction id) returns the prior
		// trade WITHOUT consuming rate budget. The in-txn onConflictDoNothing is the race backstop.
		const [prior] = await deps.db
			.select()
			.from(lmsrTrades)
			.where(eq(lmsrTrades.idempotencyKey, input.idempotencyKey))
			.limit(1)
		if (prior) return { ...toLmsrTradeResult(prior), deduped: true }

		const rate = await consumeRateBudget(deps.db, input.userId, 'lmsr_trade')
		if (!rate.allowed) throw new PmError('RATE_LIMITED', { detail: rate.retryAfterMs })

		return await deps.db.transaction(async (tx) => {
			// Lock the market row: serializes trade-vs-trade and trade-vs-resolve on this market so the
			// priced state (net_shares) read below is consistent with the write.
			const [market] = await tx
				.select()
				.from(lmsrMarkets)
				.where(eq(lmsrMarkets.id, input.marketId))
				.for('update')
			if (!market) throw new PmError('LMSR_MARKET_NOT_FOUND')
			if (market.status !== 'open') throw new PmError('LMSR_MARKET_NOT_OPEN')
			if (market.closesAt.getTime() <= Date.now()) throw new PmError('LMSR_MARKET_CLOSED')

			const outcomes = await loadLmsrOutcomes(tx, input.marketId)
			const k = outcomes.findIndex((o) => o.id === input.outcomeId)
			if (k < 0) throw new PmError('LMSR_OUTCOME_NOT_FOUND')

			const qs = outcomes.map((o) => parseAmount(o.netShares))
			const b = parseAmount(market.liquidityParam)
			// Directional-rounded over-estimate of the true cost, so the maker is never short.
			const cost = buyCost(qs, k, delta, b)
			if (maxCost != null && cost > maxCost) throw new PmError('LMSR_SLIPPAGE_EXCEEDED')

			// Idempotency gate BEFORE any money moves: a duplicate delivery hits the unique index and
			// returns the existing trade without debiting.
			const inserted = await tx
				.insert(lmsrTrades)
				.values({
					marketId: input.marketId,
					userId: input.userId,
					outcomeId: input.outcomeId,
					side: 'buy',
					shares: formatAmount(delta),
					costPoints: formatAmount(cost),
					idempotencyKey: input.idempotencyKey,
				})
				.onConflictDoNothing({ target: lmsrTrades.idempotencyKey })
				.returning()
			if (inserted.length === 0) {
				const [existing] = await tx
					.select()
					.from(lmsrTrades)
					.where(eq(lmsrTrades.idempotencyKey, input.idempotencyKey))
					.limit(1)
				return { ...toLmsrTradeResult(existing), deduped: true }
			}
			const trade = inserted[0]

			// Move money: debit the trader (member wallet locked FIRST), credit the LMSR house. Both book
			// as the shared `adjustment` type + metadata { source: 'lmsr' } (no ledger-enum widening; and
			// `adjustment` is excluded from the parimutuel leaderboard netProfit aggregate). The pm_ledger
			// idempotencyKey is left NULL — the exactly-once gate is the lmsr_trades unique index above,
			// and the pm_ledger idempotency index is a GLOBAL namespace shared with parimutuel grants.
			const debit = await debitWallet(tx, {
				userId: input.userId,
				amount: cost,
				type: 'adjustment',
				marketId: input.marketId,
				metadata: lmsrLedgerMetadata('buy', input.marketId, trade.id),
			})
			if (!debit) throw new PmError('INSUFFICIENT_FUNDS')

			await creditWallet(tx, {
				userId: LMSR_HOUSE_WALLET_USER_ID,
				amount: cost,
				type: 'adjustment',
				marketId: input.marketId,
				metadata: lmsrLedgerMetadata('buy', input.marketId, trade.id),
			})

			// Advance the priced state (q_k += delta) and the trader's position (upsert).
			await tx
				.update(lmsrOutcomes)
				.set({ netShares: sql`${lmsrOutcomes.netShares} + ${formatAmount(delta)}::numeric` })
				.where(eq(lmsrOutcomes.id, input.outcomeId))
			await tx
				.insert(lmsrPositions)
				.values({
					marketId: input.marketId,
					userId: input.userId,
					outcomeId: input.outcomeId,
					shares: formatAmount(delta),
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [lmsrPositions.marketId, lmsrPositions.userId, lmsrPositions.outcomeId],
					set: {
						shares: sql`${lmsrPositions.shares} + ${formatAmount(delta)}::numeric`,
						updatedAt: new Date(),
					},
				})
			await tx
				.update(lmsrMarkets)
				.set({ updatedAt: new Date() })
				.where(eq(lmsrMarkets.id, input.marketId))

			await logLmsrHistory(tx, {
				marketId: input.marketId,
				actorUserId: input.userId,
				action: 'lmsr_trade_buy',
				visibility: 'internal',
				metadata: {
					outcomeId: input.outcomeId,
					shares: formatAmount(delta),
					cost: formatAmount(cost),
				},
			})

			return { ...toLmsrTradeResult(trade), deduped: false }
		})
	} catch (error) {
		// Business rejections (insufficient funds, market closed/not-open, slippage, rate-limited, invalid
		// shares) are normal user-facing outcomes — don't log or page. Everything else is infra: log WITH
		// the driver cause and page, so a trade never dies as a silent "try again".
		if (!isExpectedError(error)) {
			const cause = dbErrorCause(error)
			logger.error('[PredictionMarkets] buyLmsrShares failed', {
				marketId: input.marketId,
				outcomeId: input.outcomeId,
				userId: input.userId,
				error: error instanceof Error ? error.message : String(error),
				cause,
			})
			captureException(error as Error, {
				tags: {
					durableObject: 'PredictionMarketsDO',
					method: 'buyLmsrShares',
					marketId: input.marketId,
					userId: input.userId,
				},
				extra: { cause, outcomeId: input.outcomeId },
			})
		}
		throw error
	}
}
