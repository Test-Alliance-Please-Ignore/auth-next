import { and, eq, ne, sql } from '@repo/db-utils'
import { captureException } from '@repo/hono-helpers'
import { SYSTEM_WALLET_USER_ID } from '@repo/prediction-markets'

import { pmLedger, pmWallets } from '../db/schema'
import { isExpectedError, PmError } from '../lib/errors'
import { formatAmount, isPositiveIntegerString, parseAmount } from '../lib/money'
import { ONBOARDING_GRANT, ONBOARDING_REASON, SYSTEM_ACTOR } from './context'
import { getWalletBalance } from './read-service'
import { creditWallet } from './shared'

import type { AwardBonusInput, AwardBonusResult, GrantPointsInput } from '@repo/prediction-markets'
import type { PmDeps } from './context'

export async function grantPoints(
	deps: PmDeps,
	input: GrantPointsInput
): Promise<{ balance: string; deduped: boolean }> {
	if (!isPositiveIntegerString(input.amount)) {
		throw new PmError('INVALID_AMOUNT')
	}
	if (!input.reason?.trim()) {
		throw new PmError('REASON_REQUIRED')
	}
	// Defense-in-depth: the route also blocks this, but never let an admin fund their own wallet.
	if (input.actorUserId === input.targetUserId) {
		throw new PmError('SELF_TARGET_FORBIDDEN')
	}
	// The house/system wallet is an accumulator for rake + dust; keep its balance meaningful by
	// forbidding manual deposits into it (so house balance == Σ collected rake/dust).
	if (input.targetUserId === SYSTEM_WALLET_USER_ID) {
		throw new PmError('SYSTEM_TARGET_FORBIDDEN')
	}
	try {
		return await deps.db.transaction(async (tx) => {
			// Ensure the wallet row exists, then lock it FOR UPDATE. Locking BEFORE the idempotency
			// pre-check serializes concurrent grants to the same user, so a losing race sees the
			// winner's committed ledger row here and dedupes gracefully — rather than racing past
			// the pre-check into a ledger unique-violation (money was always safe, but the raw
			// 23505 pages Sentry and surfaces a spurious failure to an already-granted user).
			await tx
				.insert(pmWallets)
				.values({ userId: input.targetUserId, balance: '0' })
				.onConflictDoNothing()
			const [locked] = await tx
				.select({ balance: pmWallets.balance })
				.from(pmWallets)
				.where(eq(pmWallets.userId, input.targetUserId))
				.for('update')
				.limit(1)

			// Idempotent grant: a repeated key must match the original (user, amount, type),
			// otherwise a reused/forged key would silently drop a real deposit.
			if (input.idempotencyKey) {
				const [existing] = await tx
					.select()
					.from(pmLedger)
					.where(eq(pmLedger.idempotencyKey, input.idempotencyKey))
					.limit(1)
				if (existing) {
					const same =
						existing.type === 'grant' &&
						existing.userId === input.targetUserId &&
						parseAmount(existing.amount) === parseAmount(input.amount)
					if (!same) {
						throw new PmError('IDEMPOTENCY_KEY_CONFLICT')
					}
					return { balance: locked?.balance ?? '0', deduped: true }
				}
			}

			// Wallet already exists and is locked FOR UPDATE above, so skip the lazy upsert.
			const { balanceAfter } = await creditWallet(tx, {
				userId: input.targetUserId,
				amount: parseAmount(input.amount),
				type: 'grant',
				idempotencyKey: input.idempotencyKey,
				metadata: { actorUserId: input.actorUserId, reason: input.reason },
				ensureWallet: false,
			})

			return { balance: balanceAfter ?? locked?.balance ?? '0', deduped: false }
		})
	} catch (error) {
		// A mismatched idempotency key is a caller-side outcome (the admin route maps it to 409;
		// onboardUser handles it), not an infra failure — don't page on it.
		if (!isExpectedError(error)) {
			captureException(error as Error, {
				tags: { durableObject: 'PredictionMarketsDO', method: 'grantPoints' },
			})
		}
		throw error
	}
}

/**
 * Onboard a member: ensure their wallet exists and deposit the one-time ONBOARDING_GRANT.
 * Built on grantPoints as a system-actor grant keyed on `onboard:{userId}`, so it inherits
 * wallet creation, the atomic credit, and idempotency — and is once-per-user: a repeat call
 * (`deduped`) grants nothing and reports `alreadyOnboarded: true`.
 *
 * If a member already onboarded when ONBOARDING_GRANT was a DIFFERENT size, the repeat grant
 * collides on the key at a mismatched amount (IDEMPOTENCY_KEY_CONFLICT). Once-per-user still
 * holds — treat it as already onboarded rather than erroring or topping up.
 */
export async function onboardUser(
	deps: PmDeps,
	userId: string
): Promise<{ balance: string; granted: string; alreadyOnboarded: boolean }> {
	try {
		const { balance, deduped } = await grantPoints(deps, {
			actorUserId: SYSTEM_ACTOR,
			targetUserId: userId,
			amount: ONBOARDING_GRANT,
			reason: ONBOARDING_REASON,
			idempotencyKey: `onboard:${userId}`,
		})
		return { balance, granted: deduped ? '0' : ONBOARDING_GRANT, alreadyOnboarded: deduped }
	} catch (error) {
		if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_CONFLICT') {
			const { balance } = await getWalletBalance(deps, userId)
			return { balance, granted: '0', alreadyOnboarded: true }
		}
		throw error
	}
}

/**
 * Award a small bonus to a random existing (non-system) wallet, paid FROM the house/system wallet.
 *
 * A pure, points-conserving transfer done atomically in one transaction: pick a random real wallet,
 * debit the house wallet overdraft-safe, then credit the winner — booked as two `adjustment` ledger
 * lines tagged `source: 'bonus'` (the recipient credit routes through the shared `creditWallet`
 * primitive; the house debit is its signed mirror). Reusing `adjustment` (rather than a new ledger
 * enum value) keeps this migration-free — it is the type reserved for exactly these out-of-band
 * balance movements, and it already renders/filters in the admin audit UI.
 *
 * Best-effort by contract: it no-ops (`{ awarded: false }`) when there is no eligible wallet or the
 * house lacks the funds, so a caller (e.g. the mailroom Easter-egg) can fire it without special-
 * casing an empty house. It throws only on a genuinely invalid request or an infra failure.
 */
export async function awardRandomBonus(
	deps: PmDeps,
	input: AwardBonusInput
): Promise<AwardBonusResult> {
	if (!isPositiveIntegerString(input.amount)) {
		throw new PmError('INVALID_AMOUNT')
	}
	if (!input.reason?.trim()) {
		throw new PmError('REASON_REQUIRED')
	}
	const amount = parseAmount(input.amount)
	const formatted = formatAmount(amount)
	try {
		return await deps.db.transaction(async (tx) => {
			// Pick a random real recipient and lock its wallet row. The house/system wallet is an
			// internal accumulator, never a prize target, so exclude it. `FOR UPDATE` here is NOT for
			// credit correctness (the credit below is an atomic increment) — it enforces a consistent
			// lock ORDER: every money op must take member-wallet locks BEFORE the SYSTEM-wallet lock.
			// executeResolution locks winners then SYSTEM (rake/dust); locking the winner here first
			// keeps this in the same order and avoids a deadlock cycle with a concurrent resolution.
			const [winner] = await tx
				.select({ userId: pmWallets.userId })
				.from(pmWallets)
				.where(ne(pmWallets.userId, SYSTEM_WALLET_USER_ID))
				.orderBy(sql`random()`)
				.limit(1)
				.for('update')
			if (!winner) return { awarded: false, reason: 'NO_ELIGIBLE_WALLETS' }

			// Debit the house wallet, overdraft-safe (mirrors placeBet's guarded debit): the balance
			// guard makes 0 affected rows mean "house can't fund this" — skip without moving money. This
			// also handles a house wallet that has never been created (no row ⇒ 0 rows ⇒ skip).
			const debited = await tx
				.update(pmWallets)
				.set({
					balance: sql`${pmWallets.balance} - ${formatted}::numeric`,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(pmWallets.userId, SYSTEM_WALLET_USER_ID),
						sql`${pmWallets.balance} >= ${formatted}::numeric`
					)
				)
				.returning({ balance: pmWallets.balance })
			if (debited.length === 0) {
				return { awarded: false, reason: 'INSUFFICIENT_HOUSE_FUNDS' }
			}

			// Record the house debit as a signed (negative) adjustment line carrying its running balance.
			await tx.insert(pmLedger).values({
				userId: SYSTEM_WALLET_USER_ID,
				amount: formatAmount(-amount),
				type: 'adjustment',
				balanceAfter: debited[0].balance,
				metadata: { source: 'bonus', reason: input.reason, counterpartyUserId: winner.userId },
			})

			// Credit the winner. Their wallet exists (we just selected it), so skip the lazy upsert.
			const { balanceAfter } = await creditWallet(tx, {
				userId: winner.userId,
				amount,
				type: 'adjustment',
				metadata: { source: 'bonus', reason: input.reason },
				ensureWallet: false,
			})

			return {
				awarded: true,
				userId: winner.userId,
				amount: formatted,
				balanceAfter: balanceAfter ?? '0',
			}
		})
	} catch (error) {
		if (!isExpectedError(error)) {
			captureException(error as Error, {
				tags: { durableObject: 'PredictionMarketsDO', method: 'awardRandomBonus' },
			})
		}
		throw error
	}
}
