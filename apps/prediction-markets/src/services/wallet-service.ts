import { eq } from '@repo/db-utils'
import { captureException } from '@repo/hono-helpers'
import { SYSTEM_WALLET_USER_ID } from '@repo/prediction-markets'

import { pmLedger, pmWallets } from '../db/schema'
import { isExpectedError, PmError } from '../lib/errors'
import { isPositiveIntegerString, parseAmount } from '../lib/money'
import { ONBOARDING_GRANT, ONBOARDING_REASON, SYSTEM_ACTOR } from './context'
import { getWalletBalance } from './read-service'
import { creditWallet } from './shared'

import type { GrantPointsInput } from '@repo/prediction-markets'
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
