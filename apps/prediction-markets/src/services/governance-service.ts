import { desc, eq, inArray, sql } from '@repo/db-utils'
import { captureException, logger } from '@repo/hono-helpers'

import { pmConfig, pmMarkets } from '../db/schema'
import { isExpectedError, PmError } from '../lib/errors'
import { isPositiveIntegerString, parseAmount } from '../lib/money'
import { bucketThresholdImpact, thresholdEqual } from '../lib/threshold-impact'
import { readActiveConfig, toConfigView } from './shared'

import type { PmConfigView, ThresholdImpact, UpdateConfigInput } from '@repo/prediction-markets'
import type { PmDeps } from './context'

/**
 * The active config defaults. With no active row, returns the RUNTIME-EFFECTIVE fallbacks the readers
 * actually use (rake 0 — createMarket's `?? 0`, minStake '1', threshold null) with configured:false —
 * NOT the column defaults (100/'1') — so the admin UI reports what markets truly get today.
 */
export async function getConfig(deps: PmDeps): Promise<PmConfigView> {
	const cfg = await readActiveConfig(deps.db)
	if (!cfg) {
		return {
			defaultRakeBps: 0,
			defaultMinStake: '1',
			twoOfNThreshold: null,
			creatorRewardMinBps: 0,
			creatorRewardMaxBps: 0,
			effectiveFrom: null,
			actorUserId: null,
			changeNote: null,
			configured: false,
		}
	}
	return toConfigView(cfg)
}

/**
 * Read-only retroactive impact of setting twoOfNThreshold to `candidate` (null = disable). Excludes
 * 'resolving' markets (a threshold change is inert once committed to the two-signer flow) and
 * terminal markets. Delegates the pure bucketing to lib/threshold-impact.
 */
export async function computeThresholdImpact(
	deps: PmDeps,
	candidate: string | null
): Promise<ThresholdImpact> {
	if (candidate !== null && !isPositiveIntegerString(candidate))
		throw new PmError('INVALID_THRESHOLD')
	const cfg = await readActiveConfig(deps.db)
	const rows = await deps.db
		.select({
			id: pmMarkets.id,
			question: pmMarkets.question,
			status: pmMarkets.status,
			totalPool: pmMarkets.totalPool,
			twoOfN: pmMarkets.twoOfN,
			designatedResolvers: pmMarkets.designatedResolvers,
		})
		.from(pmMarkets)
		.where(inArray(pmMarkets.status, ['open', 'closed']))
	return bucketThresholdImpact(rows, cfg?.twoOfNThreshold ?? null, candidate)
}

export async function previewTwoOfNThreshold(
	deps: PmDeps,
	candidateThreshold: string | null
): Promise<ThresholdImpact> {
	return computeThresholdImpact(deps, candidateThreshold)
}

/**
 * Replace the active config via temporal supersession (close current active row + insert a fresh
 * one), recording the acting admin (durable WHO audit). Input validation runs OUTSIDE the tx (no
 * Sentry page); the stranding hard-block runs INSIDE the tx under the advisory lock (authoritative —
 * a concurrent config write can't leave it stale) and throws the expected THRESHOLD_WOULD_STRAND
 * which the catch surfaces without paging. A no-op (all values AND the note equal the active row,
 * compared by numeric VALUE not raw string) writes no new generation.
 */
export async function updateConfig(deps: PmDeps, input: UpdateConfigInput): Promise<PmConfigView> {
	if (
		!Number.isInteger(input.defaultRakeBps) ||
		input.defaultRakeBps < 0 ||
		input.defaultRakeBps > 2000
	) {
		throw new PmError('INVALID_RAKE')
	}
	if (!isPositiveIntegerString(input.defaultMinStake)) throw new PmError('INVALID_MIN_STAKE')
	if (input.twoOfNThreshold !== null && !isPositiveIntegerString(input.twoOfNThreshold)) {
		throw new PmError('INVALID_THRESHOLD')
	}
	// Creator rake-reward band: both bounds whole bps in [0, 10000] (fraction of the rake) and
	// min ≤ max. Both 0 disables the feature. Enforced here (route also validates) so the stored
	// invariant the settlement draw relies on can never be violated.
	if (
		!Number.isInteger(input.creatorRewardMinBps) ||
		!Number.isInteger(input.creatorRewardMaxBps) ||
		input.creatorRewardMinBps < 0 ||
		input.creatorRewardMaxBps < 0 ||
		input.creatorRewardMinBps > 10_000 ||
		input.creatorRewardMaxBps > 10_000 ||
		input.creatorRewardMinBps > input.creatorRewardMaxBps
	) {
		throw new PmError('INVALID_CREATOR_REWARD')
	}
	// DO owns the invariant (the route caps at 500 too). Bound the free-text note defensively.
	if (input.changeNote != null && input.changeNote.length > 500) {
		throw new PmError('INVALID_CHANGE_NOTE')
	}

	try {
		const view = await deps.db.transaction(async (tx) => {
			// Serialize concurrent config writes so supersession can't leave two active rows.
			await tx.execute(sql`select pg_advisory_xact_lock(hashtext('pm_config'))`)
			const [cur] = await tx
				.select()
				.from(pmConfig)
				.where(eq(pmConfig.isActive, true))
				.orderBy(desc(pmConfig.effectiveFrom))
				.limit(1)
			const curThreshold = cur?.twoOfNThreshold ?? null
			if (
				cur &&
				cur.defaultRakeBps === input.defaultRakeBps &&
				parseAmount(cur.defaultMinStake) === parseAmount(input.defaultMinStake) &&
				thresholdEqual(curThreshold, input.twoOfNThreshold) &&
				cur.creatorRewardMinBps === input.creatorRewardMinBps &&
				cur.creatorRewardMaxBps === input.creatorRewardMaxBps &&
				(cur.changeNote ?? null) === (input.changeNote ?? null)
			) {
				return toConfigView(cur) // no-op: skip a value-identical generation
			}
			// Authoritative stranding hard-block: re-evaluated UNDER the lock against the CURRENT
			// active threshold, so a concurrent config write can't move `current` out from under the
			// pre-lock UI check. Only runs when the threshold actually moves.
			if (!thresholdEqual(curThreshold, input.twoOfNThreshold)) {
				const marketRows = await tx
					.select({
						id: pmMarkets.id,
						question: pmMarkets.question,
						status: pmMarkets.status,
						totalPool: pmMarkets.totalPool,
						twoOfN: pmMarkets.twoOfN,
						designatedResolvers: pmMarkets.designatedResolvers,
					})
					.from(pmMarkets)
					.where(inArray(pmMarkets.status, ['open', 'closed']))
				const impact = bucketThresholdImpact(marketRows, curThreshold, input.twoOfNThreshold)
				if (impact.strandedCandidates.length > 0) throw new PmError('THRESHOLD_WOULD_STRAND')
			}
			await tx
				.update(pmConfig)
				.set({ isActive: false, effectiveTo: sql`now()` })
				.where(eq(pmConfig.isActive, true))
			const [row] = await tx
				.insert(pmConfig)
				.values({
					defaultRakeBps: input.defaultRakeBps,
					defaultMinStake: input.defaultMinStake,
					twoOfNThreshold: input.twoOfNThreshold,
					creatorRewardMinBps: input.creatorRewardMinBps,
					creatorRewardMaxBps: input.creatorRewardMaxBps,
					actorUserId: input.actorUserId,
					changeNote: input.changeNote ?? null,
				})
				.returning()
			return toConfigView(row)
		})
		logger.info('[PredictionMarkets] config updated', {
			actorUserId: input.actorUserId,
			defaultRakeBps: input.defaultRakeBps,
			defaultMinStake: input.defaultMinStake,
			twoOfNThreshold: input.twoOfNThreshold,
		})
		return view
	} catch (error) {
		// THRESHOLD_WOULD_STRAND is an expected governance rejection (thrown in-tx) — surface it
		// without paging; everything else is an infra failure worth capturing.
		if (!isExpectedError(error)) {
			captureException(error as Error, {
				tags: { durableObject: 'PredictionMarketsDO', method: 'updateConfig' },
			})
		}
		throw error
	}
}
