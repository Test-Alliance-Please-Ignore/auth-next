import { and, eq, sql } from '@repo/db-utils'

import { pmLedger, pmWallets } from '../db/schema'
import { PmError } from '../lib/errors'
import { formatAmount } from '../lib/money'

import type { NewPmLedgerRow } from '../db/schema'
import type { PmExecutor } from './context'

/**
 * The prediction-markets money engine.
 *
 * This module is the SINGLE owner of every mutation to `pm_wallets` and every write to `pm_ledger`.
 * No other service touches those two tables directly — they compose the primitives below inside their
 * own FOR UPDATE transactions. That keeps the two money invariants in exactly one place:
 *   1. credit-then-record / debit-then-record: a balance change and its matching ledger line are
 *      written together, and the ledger line always carries the running `balanceAfter`.
 *   2. append-only ledger: `pm_ledger` is only ever INSERTed, and amounts are signed (credits > 0,
 *      debits < 0).
 *
 * Every primitive takes a `PmExecutor` (`tx`) rather than opening its own transaction: the engine owns
 * WHAT a money move is, not WHEN it happens. Callers still hold the row locks and idempotency gates.
 *
 * `amount` is always a NON-NEGATIVE points bigint (the magnitude of the move). Credits add it, debits
 * subtract it and stamp the ledger line negative. Monetary values cross the DB boundary as decimal
 * strings (Postgres `numeric`) and are computed as BigInt in between.
 */

/** Fields every wallet move records on its `pm_ledger` line. */
interface LedgerAttrs {
	type: NewPmLedgerRow['type']
	marketId?: string
	betId?: string
	idempotencyKey?: string
	metadata?: unknown
}

/**
 * The single `pm_ledger` INSERT. `signedAmount` is already signed (positive for a credit, negative
 * for a debit) and `balanceAfter` is the running balance snapshot after the wallet mutation. Private
 * to this module so the ledger is written in exactly one statement.
 */
async function insertLedgerEntry(
	tx: PmExecutor,
	args: LedgerAttrs & { userId: string; signedAmount: string; balanceAfter: string | null }
): Promise<void> {
	await tx.insert(pmLedger).values({
		userId: args.userId,
		amount: args.signedAmount,
		type: args.type,
		marketId: args.marketId ?? null,
		betId: args.betId ?? null,
		balanceAfter: args.balanceAfter,
		idempotencyKey: args.idempotencyKey ?? null,
		metadata: args.metadata ?? null,
	})
}

/** Lazily create the wallet row (`INSERT ... ON CONFLICT DO NOTHING`). Idempotent. */
export async function ensureWallet(tx: PmExecutor, userId: string): Promise<void> {
	await tx.insert(pmWallets).values({ userId, balance: '0' }).onConflictDoNothing()
}

/**
 * Ensure the wallet row exists, then lock it `FOR UPDATE` and return its current balance. Locking the
 * row up front serializes concurrent money moves against the same wallet, so callers can read-check
 * (e.g. an idempotency pre-check) without racing past into a unique-violation. Returns '0' as a
 * defensive fallback if the row vanished between the upsert and the lock (should not happen).
 */
export async function lockWallet(tx: PmExecutor, userId: string): Promise<{ balance: string }> {
	await ensureWallet(tx, userId)
	const [locked] = await tx
		.select({ balance: pmWallets.balance })
		.from(pmWallets)
		.where(eq(pmWallets.userId, userId))
		.for('update')
		.limit(1)
	return { balance: locked?.balance ?? '0' }
}

/**
 * The single audited money-credit primitive. Optionally lazily creates the wallet row, applies one
 * atomic balance increment, and appends the matching `pm_ledger` line carrying the running
 * `balanceAfter`. Every credit (payout / refund / creator_reward / rake / burn / grant) routes through
 * here so the credit-then-record invariant — and the balanceAfter snapshot — lives in exactly one
 * place rather than being hand-rolled per call site.
 *
 * `amount` is a non-negative points bigint. Because every caller has already ensured (or is about to
 * ensure) the wallet exists, `credited` is always present; the `?? null` fallbacks are defensive.
 * Returns the post-credit balance string (null only if the wallet row vanished mid-transaction).
 */
export async function creditWallet(
	tx: PmExecutor,
	args: LedgerAttrs & {
		userId: string
		amount: bigint
		/** Lazily `INSERT ... ON CONFLICT DO NOTHING` the wallet row first (default true). Pass false
		 * when the caller has already created/locked the wallet in this transaction. */
		ensureWallet?: boolean
	}
): Promise<{ balanceAfter: string | null }> {
	const { userId, amount, ensureWallet: shouldEnsure = true, ...ledger } = args
	if (shouldEnsure) {
		await ensureWallet(tx, userId)
	}
	const formatted = formatAmount(amount)
	const [credited] = await tx
		.update(pmWallets)
		.set({ balance: sql`${pmWallets.balance} + ${formatted}::numeric`, updatedAt: new Date() })
		.where(eq(pmWallets.userId, userId))
		.returning({ balance: pmWallets.balance })
	await insertLedgerEntry(tx, {
		...ledger,
		userId,
		signedAmount: formatted,
		balanceAfter: credited?.balance ?? null,
	})
	return { balanceAfter: credited?.balance ?? null }
}

/**
 * The single audited money-debit primitive — the mirror of `creditWallet`. Applies one atomic,
 * overdraft-safe balance decrement (the `balance >= amount` guard means a 0-row result IS insufficient
 * funds, never a partial debit) and appends the matching NEGATIVE `pm_ledger` line with the running
 * `balanceAfter`. Every debit (currently the wager) routes through here so the debit-then-record
 * invariant is enforced identically to a credit rather than re-derived by hand.
 *
 * `amount` is a non-negative points bigint. Never lazily creates the wallet: you cannot debit a wallet
 * that does not exist — that surfaces as INSUFFICIENT_FUNDS, which is correct. Throws
 * `PmError('INSUFFICIENT_FUNDS')` when the balance is too low (or the wallet is missing).
 */
export async function debitWallet(
	tx: PmExecutor,
	args: LedgerAttrs & { userId: string; amount: bigint }
): Promise<{ balanceAfter: string }> {
	const { userId, amount, ...ledger } = args
	const formatted = formatAmount(amount)
	const debited = await tx
		.update(pmWallets)
		.set({ balance: sql`${pmWallets.balance} - ${formatted}::numeric`, updatedAt: new Date() })
		.where(and(eq(pmWallets.userId, userId), sql`${pmWallets.balance} >= ${formatted}::numeric`))
		.returning({ balance: pmWallets.balance })
	if (debited.length === 0) throw new PmError('INSUFFICIENT_FUNDS')
	const balanceAfter = debited[0].balance
	await insertLedgerEntry(tx, {
		...ledger,
		userId,
		signedAmount: formatAmount(-amount),
		balanceAfter,
	})
	return { balanceAfter }
}

/**
 * Atomically move `amount` from one wallet to another: an overdraft-safe debit of `fromUserId` and a
 * credit of `toUserId`, each booked as its own attributed ledger line. This is the single audited
 * pathway for wallet-to-wallet moves (e.g. system → member bonuses, manual adjustments), so no caller
 * hand-pairs a debit and a credit and risks moving only one leg. Both legs share the transaction, so
 * either both commit or neither does. Throws `PmError('INSUFFICIENT_FUNDS')` if the source can't cover
 * the move (the credit never runs). The destination wallet is lazily created unless `ensureTo: false`.
 */
export async function transfer(
	tx: PmExecutor,
	args: {
		fromUserId: string
		toUserId: string
		amount: bigint
		debit: LedgerAttrs
		credit: LedgerAttrs
		/** Lazily create the destination wallet before crediting (default true). */
		ensureTo?: boolean
	}
): Promise<{ fromBalanceAfter: string; toBalanceAfter: string | null }> {
	const { fromUserId, toUserId, amount, debit, credit, ensureTo = true } = args
	const { balanceAfter: fromBalanceAfter } = await debitWallet(tx, {
		...debit,
		userId: fromUserId,
		amount,
	})
	const { balanceAfter: toBalanceAfter } = await creditWallet(tx, {
		...credit,
		userId: toUserId,
		amount,
		ensureWallet: ensureTo,
	})
	return { fromBalanceAfter, toBalanceAfter }
}
