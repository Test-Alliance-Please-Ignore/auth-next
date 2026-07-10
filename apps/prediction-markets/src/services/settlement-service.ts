import { and, desc, eq, ne, sql } from '@repo/db-utils'
import { captureException } from '@repo/hono-helpers'
import { SYSTEM_WALLET_USER_ID } from '@repo/prediction-markets'

import { pmBets, pmConfig, pmMarketOutcomes, pmMarkets, pmResolutionProposals } from '../db/schema'
import { canResolveDesignated, isDesignatedOverride } from '../lib/designated-resolvers'
import { isExpectedError, PmError } from '../lib/errors'
import { formatAmount, parseAmount } from '../lib/money'
import { computeResolution, pickCreatorRewardBps, splitCreatorReward } from '../lib/payout'
import { assertTransition, isTerminal } from '../lib/state-machine'
import { creditWallet, hasPosition, logHistory, requiresTwoOfN, sumStakes } from './shared'

import type { MarketStatus, PendingProposalView, ResolveResult } from '@repo/prediction-markets'
import type { PmMarket } from '../db/schema'
import type { PmDeps, PmTransaction } from './context'

export async function proposeResolution(
	deps: PmDeps,
	input: {
		resolverId: string
		marketId: string
		outcomeId: string
		bypassDesignated?: boolean
		adminOverride?: boolean
	}
): Promise<ResolveResult> {
	try {
		return await deps.db.transaction(async (tx) => {
			const [market] = await tx
				.select()
				.from(pmMarkets)
				.where(eq(pmMarkets.id, input.marketId))
				.for('update')
			if (!market) throw new PmError('MARKET_NOT_FOUND')
			if (market.status !== 'closed') throw new PmError('MARKET_NOT_CLOSED')

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

			// A site admin (adminOverride) may resolve ANY market unconditionally: skip every
			// conflict-of-interest guard (creator ≠ resolver, no-position, designated membership) AND
			// collapse the two-of-N second-signer requirement, so a lone admin settles in one step. This
			// mirrors voidMarket's admin escape hatch, but demands sharper trust: unlike a void (which only
			// refunds at stake), picking a winning outcome PAYS positions on it, so an admin who holds a
			// stake could self-deal — the override is recorded in the resolution's audit history for
			// accountability. adminOverride is is_admin-only, a trusted, DO-unverifiable capability Core
			// derives solely from is_admin (never a client literal). Every non-admin actor stays fully
			// bound by the guards below.
			const adminOverride = input.adminOverride ?? false
			const bypass = input.bypassDesignated ?? false
			if (!adminOverride) {
				if (market.createdBy === input.resolverId) throw new PmError('CREATOR_CANNOT_RESOLVE')
				if (await hasPosition(tx, input.marketId, input.resolverId)) {
					throw new PmError('RESOLVER_HAS_POSITION')
				}
				if (!canResolveDesignated(market.designatedResolvers, input.resolverId, bypass)) {
					throw new PmError('NOT_DESIGNATED_RESOLVER')
				}
			}
			const viaOverride = isDesignatedOverride(market.designatedResolvers, input.resolverId, bypass)

			if (adminOverride || !(await requiresTwoOfN(tx, market))) {
				const finalStatus = await executeResolution(
					tx,
					market,
					input.outcomeId,
					input.resolverId,
					viaOverride,
					adminOverride
				)
				return {
					marketId: market.id,
					status: finalStatus,
					resolvedOutcomeId: finalStatus === 'resolved' ? input.outcomeId : null,
				}
			}

			assertTransition(market.status, 'resolving')
			await tx
				.update(pmMarkets)
				.set({ status: 'resolving', updatedAt: new Date() })
				.where(eq(pmMarkets.id, market.id))
			const [proposal] = await tx
				.insert(pmResolutionProposals)
				.values({
					marketId: market.id,
					outcomeId: input.outcomeId,
					proposedBy: input.resolverId,
					status: 'pending',
				})
				.returning()
			await logHistory(tx, {
				marketId: market.id,
				actorUserId: input.resolverId,
				action: 'resolution_proposed',
				previousStatus: 'closed',
				newStatus: 'resolving',
				metadata: {
					outcomeId: input.outcomeId,
					proposalId: proposal.id,
					...(viaOverride ? { viaOverride: true } : {}),
				},
			})
			return {
				marketId: market.id,
				status: 'resolving',
				proposalId: proposal.id,
				resolvedOutcomeId: null,
			}
		})
	} catch (error) {
		if (!isExpectedError(error)) {
			captureException(error as Error, {
				tags: { durableObject: 'PredictionMarketsDO', method: 'proposeResolution' },
			})
		}
		throw error
	}
}

export async function approveResolution(
	deps: PmDeps,
	input: {
		resolverId: string
		marketId: string
		proposalId: string
		bypassDesignated?: boolean
		adminOverride?: boolean
	}
): Promise<ResolveResult> {
	try {
		return await deps.db.transaction(async (tx) => {
			const [market] = await tx
				.select()
				.from(pmMarkets)
				.where(eq(pmMarkets.id, input.marketId))
				.for('update')
			if (!market) throw new PmError('MARKET_NOT_FOUND')
			if (market.status !== 'resolving') throw new PmError('MARKET_NOT_RESOLVING')

			const [proposal] = await tx
				.select()
				.from(pmResolutionProposals)
				.where(eq(pmResolutionProposals.id, input.proposalId))
				.limit(1)
			if (!proposal || proposal.marketId !== input.marketId) {
				throw new PmError('PROPOSAL_NOT_FOUND')
			}
			if (proposal.status !== 'pending') throw new PmError('PROPOSAL_NOT_PENDING')

			// A site admin (adminOverride) may finalize ANY pending proposal unconditionally — the same
			// escape hatch, trust model, and self-dealing caveat as proposeResolution above (an admin can
			// even single-sign a two-of-N proposal). For every non-admin approver the two-of-N contract
			// holds: two distinct resolvers, neither the creator, neither holding a position, and — when
			// the market is designated — both the proposer (checked in proposeResolution) and this
			// approver must be designated members (or hold the admin/manager designated bypass).
			const adminOverride = input.adminOverride ?? false
			const bypass = input.bypassDesignated ?? false
			if (!adminOverride) {
				if (proposal.proposedBy === input.resolverId) throw new PmError('APPROVER_MUST_DIFFER')
				if (market.createdBy === input.resolverId) throw new PmError('CREATOR_CANNOT_RESOLVE')
				if (await hasPosition(tx, input.marketId, input.resolverId)) {
					throw new PmError('RESOLVER_HAS_POSITION')
				}
				if (!canResolveDesignated(market.designatedResolvers, input.resolverId, bypass)) {
					throw new PmError('NOT_DESIGNATED_RESOLVER')
				}
			}
			const viaOverride = isDesignatedOverride(market.designatedResolvers, input.resolverId, bypass)

			let finalStatus: MarketStatus
			let resolvedOutcomeId: string | null = null
			if (!proposal.outcomeId) {
				await executeVoidRefund(
					tx,
					market,
					input.resolverId,
					'resolution voided by approval',
					viaOverride,
					adminOverride
				)
				finalStatus = 'voided'
			} else {
				finalStatus = await executeResolution(
					tx,
					market,
					proposal.outcomeId,
					input.resolverId,
					viaOverride,
					adminOverride
				)
				resolvedOutcomeId = finalStatus === 'resolved' ? proposal.outcomeId : null
			}

			await tx
				.update(pmResolutionProposals)
				.set({ status: 'approved', approvedBy: input.resolverId, resolvedAt: new Date() })
				.where(eq(pmResolutionProposals.id, proposal.id))
			await logHistory(tx, {
				marketId: market.id,
				actorUserId: input.resolverId,
				action: 'resolution_approved',
				metadata: { proposalId: proposal.id },
			})
			return { marketId: market.id, status: finalStatus, resolvedOutcomeId }
		})
	} catch (error) {
		if (!isExpectedError(error)) {
			captureException(error as Error, {
				tags: { durableObject: 'PredictionMarketsDO', method: 'approveResolution' },
			})
		}
		throw error
	}
}

export async function voidMarket(
	deps: PmDeps,
	input: {
		actorUserId: string
		marketId: string
		reason: string
		approverId?: string
		bypassDesignated?: boolean
		adminOverride?: boolean
	}
): Promise<void> {
	if (!input.reason.trim()) throw new PmError('VOID_REASON_REQUIRED')
	try {
		await deps.db.transaction(async (tx) => {
			const [market] = await tx
				.select()
				.from(pmMarkets)
				.where(eq(pmMarkets.id, input.marketId))
				.for('update')
			if (!market) throw new PmError('MARKET_NOT_FOUND')
			if (isTerminal(market.status)) throw new PmError('MARKET_TERMINAL')

			const bypass = input.bypassDesignated ?? false
			// A site admin (adminOverride) may void ANY market unconditionally. A void refunds every
			// active bet at its exact stake, so — unlike resolve/approve, where picking an outcome can
			// enrich a position — voiding carries no self-dealing risk, and an admin is the trust root
			// for settlement. So the admin path skips every conflict-of-interest guard below (creator,
			// position, designated membership, and the contested second-approver rule). adminOverride
			// is a trusted, DO-unverifiable capability: Core derives it solely from is_admin, never a
			// client literal. Every non-admin actor stays fully bound by these guards.
			const adminOverride = input.adminOverride ?? false
			if (!adminOverride) {
				// Voiding is a terminal settlement, so it carries the same conflict-of-interest guards as
				// resolve/approve: a creator can't void their own market, and a resolver holding a
				// position can't void one they have a stake in.
				if (market.createdBy === input.actorUserId) throw new PmError('CREATOR_CANNOT_RESOLVE')
				if (await hasPosition(tx, input.marketId, input.actorUserId)) {
					throw new PmError('RESOLVER_HAS_POSITION')
				}
				if (!canResolveDesignated(market.designatedResolvers, input.actorUserId, bypass)) {
					throw new PmError('NOT_DESIGNATED_RESOLVER')
				}

				// Contested markets (bets on 2+ outcomes) require a distinct second approver.
				const [distinctRow] = await tx
					.select({ n: sql<number>`count(distinct ${pmBets.outcomeId})::int` })
					.from(pmBets)
					.where(and(eq(pmBets.marketId, input.marketId), eq(pmBets.status, 'active')))
				const contested = (distinctRow?.n ?? 0) >= 2
				if (contested && (!input.approverId || input.approverId === input.actorUserId)) {
					throw new PmError('CONTESTED_VOID_REQUIRES_APPROVER')
				}
				// On a designated market, the contested-void second approver must ALSO be a designated
				// member (unless overriding). NOTE: the DO cannot verify approverId's resolver TIER —
				// Core authenticates only the initiating actor. The Discord path never supplies
				// approverId, so this seat is currently unreachable; any future admin contested-void
				// route MUST Core-side tier-validate approverId before calling, exactly as it does for
				// the initiating actor.
				if (contested && input.approverId && !bypass) {
					if (!canResolveDesignated(market.designatedResolvers, input.approverId, false)) {
						throw new PmError('NOT_DESIGNATED_RESOLVER')
					}
				}
			}

			const viaOverride = isDesignatedOverride(
				market.designatedResolvers,
				input.actorUserId,
				bypass
			)
			await executeVoidRefund(
				tx,
				market,
				input.actorUserId,
				input.reason.trim(),
				viaOverride,
				adminOverride
			)
		})
	} catch (error) {
		if (!isExpectedError(error)) {
			captureException(error as Error, {
				tags: { durableObject: 'PredictionMarketsDO', method: 'voidMarket' },
			})
		}
		throw error
	}
}

/** The single pending resolution proposal for a market (two-of-N approve), or null. */
export async function getPendingProposal(
	deps: PmDeps,
	marketId: string
): Promise<PendingProposalView | null> {
	const [p] = await deps.db
		.select()
		.from(pmResolutionProposals)
		.where(
			and(eq(pmResolutionProposals.marketId, marketId), eq(pmResolutionProposals.status, 'pending'))
		)
		.limit(1)
	if (!p) return null
	return {
		id: p.id,
		outcomeId: p.outcomeId,
		proposedBy: p.proposedBy,
		createdAt: p.createdAt.toISOString(),
	}
}

/**
 * Distribute a resolved market's pool to winners (principal + raked net winnings) and
 * burn the remainder. Payout basis (totalPool, poolW) is the authoritative SUM over
 * active bets, not cached columns. If nobody bet the winning outcome, void & refund.
 */
export async function executeResolution(
	tx: PmTransaction,
	market: PmMarket,
	winningOutcomeId: string,
	resolverId: string,
	viaOverride = false,
	adminOverride = false
): Promise<MarketStatus> {
	const totalPool = await sumStakes(tx, market.id)
	const poolW = await sumStakes(tx, market.id, winningOutcomeId)

	if (poolW === 0n) {
		await executeVoidRefund(tx, market, resolverId, 'no winning bets', viaOverride, adminOverride)
		return 'voided'
	}

	const winners = await tx
		.select()
		.from(pmBets)
		.where(
			and(
				eq(pmBets.marketId, market.id),
				eq(pmBets.outcomeId, winningOutcomeId),
				eq(pmBets.status, 'active')
			)
		)
		.orderBy(pmBets.userId, pmBets.id)

	const { payouts, rake, dust } = computeResolution(
		winners.map((w) => ({ betId: w.id, userId: w.userId, stake: parseAmount(w.amount) })),
		totalPool,
		poolW,
		BigInt(market.rakeBps)
	)

	// Creator rake-reward: on a successful resolution the market's creator earns a random slice of
	// the rake (band configured on pm_config.creator_reward_{min,max}_bps; both 0 disables it). Read
	// the band under this same tx snapshot, draw the share, and split — creatorReward + houseRake ==
	// rake, so pool conservation is unchanged and only how the rake is *attributed* moves. A fresh
	// draw per attempt is safe: the whole resolution is one atomic, status-guarded transaction, so
	// only the committing attempt's draw ever persists.
	const [rewardCfg] = await tx
		.select({
			minBps: pmConfig.creatorRewardMinBps,
			maxBps: pmConfig.creatorRewardMaxBps,
		})
		.from(pmConfig)
		.where(eq(pmConfig.isActive, true))
		.orderBy(desc(pmConfig.effectiveFrom))
		.limit(1)
	const creatorShareBps = pickCreatorRewardBps(
		rewardCfg?.minBps ?? 0,
		rewardCfg?.maxBps ?? 0,
		Math.random()
	)
	const { creatorReward, houseRake } = splitCreatorReward(rake, creatorShareBps)

	// Credit winners in deterministic user order (multi-wallet deadlock-safe).
	for (const p of payouts) {
		const updated = await tx
			.update(pmBets)
			.set({ status: 'won', payoutAmount: formatAmount(p.payout) })
			.where(and(eq(pmBets.id, p.betId), eq(pmBets.status, 'active')))
			.returning({ id: pmBets.id })
		if (updated.length === 0) continue // already credited on a retry

		// Winner already has a wallet (they bet), so skip the lazy upsert.
		await creditWallet(tx, {
			userId: p.userId,
			amount: p.payout,
			type: 'payout',
			marketId: market.id,
			betId: p.betId,
			ensureWallet: false,
		})
	}

	await tx
		.update(pmBets)
		.set({ status: 'lost' })
		.where(
			and(
				eq(pmBets.marketId, market.id),
				ne(pmBets.outcomeId, winningOutcomeId),
				eq(pmBets.status, 'active')
			)
		)

	// Creator rake-reward: pay the market's creator their drawn slice of the rake. The creator is a
	// real user (never the system wallet; by CREATOR_CANNOT_RESOLVE never the resolver) but may have
	// no wallet yet if they never bet, so lazily create it. Booked as its own attributed line whose
	// metadata records the draw for audit; the remaining houseRake still books as 'rake' below.
	if (creatorReward > 0n) {
		// The creator may have no wallet yet (never bet), so lazily create it.
		await creditWallet(tx, {
			userId: market.createdBy,
			amount: creatorReward,
			type: 'creator_reward',
			marketId: market.id,
			metadata: { shareBps: creatorShareBps, rakeBase: formatAmount(rake) },
		})
	}

	// House cut (net rake, after any creator reward) and rounding dust (burn) accumulate in the
	// system wallet rather than leaving circulation via a null-user sink — the points stay conserved
	// and recoverable. Each is a distinct, attributed ledger line carrying the running balanceAfter.
	// creditWallet lazily upserts the system wallet, so each credit is self-contained.
	if (houseRake > 0n) {
		await creditWallet(tx, {
			userId: SYSTEM_WALLET_USER_ID,
			amount: houseRake,
			type: 'rake',
			marketId: market.id,
		})
	}
	if (dust > 0n) {
		await creditWallet(tx, {
			userId: SYSTEM_WALLET_USER_ID,
			amount: dust,
			type: 'burn',
			marketId: market.id,
		})
	}

	assertTransition(market.status, 'resolved')
	await tx
		.update(pmMarkets)
		.set({
			status: 'resolved',
			resolvedOutcomeId: winningOutcomeId,
			resolvedBy: resolverId,
			resolvedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(pmMarkets.id, market.id))
	await logHistory(tx, {
		marketId: market.id,
		actorUserId: resolverId,
		action: 'resolved',
		previousStatus: market.status,
		newStatus: 'resolved',
		visibility: 'public',
		metadata: {
			winningOutcomeId,
			totalPool: formatAmount(totalPool),
			poolW: formatAmount(poolW),
			rake: formatAmount(rake),
			creatorReward: formatAmount(creatorReward),
			creatorRewardBps: creatorShareBps,
			houseRake: formatAmount(houseRake),
			dust: formatAmount(dust),
			...(viaOverride ? { viaOverride: true } : {}),
			...(adminOverride ? { adminOverride: true } : {}),
		},
	})
	return 'resolved'
}

/** Refund every active bet at full stake and mark the market voided. */
export async function executeVoidRefund(
	tx: PmTransaction,
	market: PmMarket,
	actorUserId: string,
	reason: string,
	viaOverride = false,
	adminOverride = false
): Promise<void> {
	const bets = await tx
		.select()
		.from(pmBets)
		.where(and(eq(pmBets.marketId, market.id), eq(pmBets.status, 'active')))
		.orderBy(pmBets.userId, pmBets.id)

	for (const bet of bets) {
		const updated = await tx
			.update(pmBets)
			.set({ status: 'refunded', payoutAmount: null })
			.where(and(eq(pmBets.id, bet.id), eq(pmBets.status, 'active')))
			.returning({ id: pmBets.id })
		if (updated.length === 0) continue

		// The bettor already has a wallet (they bet), so skip the lazy upsert.
		await creditWallet(tx, {
			userId: bet.userId,
			amount: parseAmount(bet.amount),
			type: 'refund',
			marketId: market.id,
			betId: bet.id,
			ensureWallet: false,
		})
	}

	assertTransition(market.status, 'voided')
	await tx
		.update(pmMarkets)
		.set({ status: 'voided', voidReason: reason, updatedAt: new Date() })
		.where(eq(pmMarkets.id, market.id))
	await logHistory(tx, {
		marketId: market.id,
		actorUserId,
		action: 'voided',
		previousStatus: market.status,
		newStatus: 'voided',
		visibility: 'public',
		metadata: {
			reason,
			...(viaOverride ? { viaOverride: true } : {}),
			...(adminOverride ? { adminOverride: true } : {}),
		},
	})
}
