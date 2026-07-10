import { and, eq, sql } from '@repo/db-utils'
import { captureException, logger } from '@repo/hono-helpers'

import { pmBets, pmMarketOutcomes, pmMarkets } from '../db/schema'
import { isDesignatedResolver } from '../lib/designated-resolvers'
import { isExpectedError, PmError } from '../lib/errors'
import { isPositiveIntegerString, parseAmount } from '../lib/money'
import { dbErrorCause } from './context'
import { consumeRateBudget, logHistory, toBetResult } from './shared'
import { debitWallet } from './transaction-service'

import type { BetResult, PlaceBetInput } from '@repo/prediction-markets'
import type { PmDeps } from './context'

export async function placeBet(
	deps: PmDeps,
	input: PlaceBetInput
): Promise<BetResult & { deduped: boolean }> {
	// The try spans the WHOLE method — the dedupe SELECT and the rate-limit upsert run before
	// the txn and can also fail (e.g. a missing table/migration or a Neon outage). They used to
	// throw outside any catch, so those infra errors were never logged or paged and surfaced to
	// the member as a bare "Could not place your bet". Wrapping everything closes that gap.
	try {
		if (!isPositiveIntegerString(input.amount)) throw new PmError('INVALID_AMOUNT')
		const amount = parseAmount(input.amount)

		// Dedupe pre-check (outside the txn): a duplicate delivery (same interaction id) returns
		// the prior bet WITHOUT consuming rate budget. The in-txn onConflictDoNothing below is the
		// race backstop for two identical deliveries that both pass this check.
		const [priorBet] = await deps.db
			.select()
			.from(pmBets)
			.where(eq(pmBets.idempotencyKey, input.idempotencyKey))
			.limit(1)
		if (priorBet) return { ...toBetResult(priorBet), deduped: true }

		// Rate limit (committed atomic upsert, before the bet txn): a rejected bet still consumes
		// budget (anti-spam); idempotent retries never reach here (handled above).
		const rate = await consumeRateBudget(deps.db, input.userId, 'bet')
		if (!rate.allowed) throw new PmError('RATE_LIMITED', { detail: rate.retryAfterMs })

		return await deps.db.transaction(async (tx) => {
			// Lock the market row: serializes bet-vs-bet and bet-vs-resolve on this market.
			const [market] = await tx
				.select()
				.from(pmMarkets)
				.where(eq(pmMarkets.id, input.marketId))
				.for('update')
			if (!market) throw new PmError('MARKET_NOT_FOUND')
			if (market.status !== 'open') throw new PmError('MARKET_NOT_OPEN')
			if (market.closesAt.getTime() <= Date.now()) throw new PmError('MARKET_CLOSED')
			// A creator MAY bet on their own market — they just can't resolve it (enforced by the
			// CREATOR_CANNOT_RESOLVE / RESOLVER_HAS_POSITION guards), so they hold no power over the
			// outcome and can't self-deal. A DESIGNATED resolver, however, holds settlement power over
			// this market, so they must stay position-free: block their bet up front (otherwise the
			// RESOLVER_HAS_POSITION guard would later strand a small/size-1 designated set).
			if (isDesignatedResolver(market.designatedResolvers, input.userId)) {
				throw new PmError('DESIGNATED_RESOLVER_CANNOT_BET')
			}

			const [outcome] = await tx
				.select({ id: pmMarketOutcomes.id })
				.from(pmMarketOutcomes)
				.where(
					and(
						eq(pmMarketOutcomes.id, input.outcomeId),
						eq(pmMarketOutcomes.marketId, input.marketId)
					)
				)
				.limit(1)
			if (!outcome) throw new PmError('OUTCOME_NOT_FOUND')

			if (amount < parseAmount(market.minStake)) throw new PmError('STAKE_BELOW_MIN')
			if (market.maxStake != null && amount > parseAmount(market.maxStake)) {
				throw new PmError('STAKE_ABOVE_MAX')
			}
			if (market.perUserCap != null) {
				const [capRow] = await tx
					.select({ total: sql<string>`coalesce(sum(${pmBets.amount}), 0)` })
					.from(pmBets)
					.where(
						and(
							eq(pmBets.marketId, input.marketId),
							eq(pmBets.userId, input.userId),
							eq(pmBets.status, 'active')
						)
					)
				if (parseAmount(capRow.total) + amount > parseAmount(market.perUserCap)) {
					throw new PmError('PER_USER_CAP_EXCEEDED')
				}
			}

			// Insert the bet as the idempotency gate BEFORE any money moves. A duplicate
			// delivery (same interaction id) hits the unique index and returns the existing
			// bet without debiting.
			const inserted = await tx
				.insert(pmBets)
				.values({
					marketId: input.marketId,
					outcomeId: input.outcomeId,
					userId: input.userId,
					amount: input.amount,
					status: 'active',
					idempotencyKey: input.idempotencyKey,
				})
				.onConflictDoNothing({ target: pmBets.idempotencyKey })
				.returning()

			if (inserted.length === 0) {
				const [existing] = await tx
					.select()
					.from(pmBets)
					.where(eq(pmBets.idempotencyKey, input.idempotencyKey))
					.limit(1)
				return { ...toBetResult(existing), deduped: true }
			}
			const bet = inserted[0]

			// Atomic overdraft-safe debit (throws INSUFFICIENT_FUNDS on too-low balance, rolling back
			// the bet). The wager ledger line — negative amount, running balanceAfter — is written by
			// debitWallet, the mirror of the credit path every payout/refund/rake routes through.
			await debitWallet(tx, {
				userId: input.userId,
				amount,
				type: 'wager',
				marketId: input.marketId,
				betId: bet.id,
			})

			await tx
				.update(pmMarketOutcomes)
				.set({ poolAmount: sql`${pmMarketOutcomes.poolAmount} + ${input.amount}::numeric` })
				.where(eq(pmMarketOutcomes.id, input.outcomeId))
			await tx
				.update(pmMarkets)
				.set({
					totalPool: sql`${pmMarkets.totalPool} + ${input.amount}::numeric`,
					updatedAt: new Date(),
				})
				.where(eq(pmMarkets.id, input.marketId))

			await logHistory(tx, {
				marketId: input.marketId,
				actorUserId: input.userId,
				action: 'bet_placed',
				visibility: 'internal',
				metadata: { outcomeId: input.outcomeId, amount: input.amount },
			})

			return { ...toBetResult(bet), deduped: false }
		})
	} catch (error) {
		// Business rejections (insufficient funds, market closed, rate-limited, invalid amount)
		// are normal user-facing outcomes — don't log or page on them. Everything else (a failed
		// query, a missing table/migration, a Neon outage) is an infra failure: log it WITH the
		// underlying driver cause and page Sentry, so a bet never dies as a silent "try again".
		if (!isExpectedError(error)) {
			const cause = dbErrorCause(error)
			logger.error('[PredictionMarkets] placeBet failed', {
				marketId: input.marketId,
				outcomeId: input.outcomeId,
				userId: input.userId,
				error: error instanceof Error ? error.message : String(error),
				cause,
			})
			captureException(error as Error, {
				tags: {
					durableObject: 'PredictionMarketsDO',
					method: 'placeBet',
					marketId: input.marketId,
					userId: input.userId,
				},
				extra: { cause, outcomeId: input.outcomeId },
			})
		}
		throw error
	}
}
