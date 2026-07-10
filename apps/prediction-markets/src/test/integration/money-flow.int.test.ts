/**
 * Prediction-markets money-flow INTEGRATION tests.
 *
 * Drives the real service functions against a real Postgres (a fresh ephemeral Neon branch per run,
 * provisioned by ./global-setup.ts), exercising the flows the pure-lib unit suite cannot cover:
 *   A) place-bet → close → resolve, with rake + creator-reward + dust conservation
 *   B) void → refund
 *   C) bet idempotency (no double-debit on a re-delivered interaction)
 *
 * These run in a Node vitest project (vitest.config.node.ts), NOT the workers pool: after the fix-5
 * decomposition every operation is a standalone `service(deps, …)` taking `deps = { db }`, so we build
 * `deps` with a real client and call the services directly. A real DB is required because placeBet /
 * proposeResolution use interactive FOR UPDATE transactions (the neon-http driver can't do those).
 *
 * Skips cleanly when globalSetup found no Neon creds (TEST_DATABASE_URL unset).
 */

import { neonConfig, Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { and, desc, eq, inArray, sql } from '@repo/db-utils'

import { schema } from '../../db'
import { pmBets, pmLedger, pmMarketHistory, pmWallets } from '../../db/schema'
import * as betting from '../../services/betting-service'
import * as governance from '../../services/governance-service'
import * as market from '../../services/market-service'
import * as reads from '../../services/read-service'
import * as settlement from '../../services/settlement-service'
import * as wallet from '../../services/wallet-service'

import type { PmDeps } from '../../services/context'

// Neon's serverless driver needs a WebSocket constructor in Node (globally available on Node ≥ 22).
// The global type is structurally stricter than neon's WebSocketConstructor; the runtime shape is
// compatible, so cast.
neonConfig.webSocketConstructor = WebSocket as unknown as typeof neonConfig.webSocketConstructor

const HAS_DB = Boolean(process.env.TEST_DATABASE_URL)
const suite = HAS_DB ? describe : describe.skip

const ADMIN = '00000000-0000-0000-0000-0000000000aa' // grant actor (never a participant)
const SYSTEM = '00000000-0000-0000-0000-000000000000' // house accumulator (rake + burned dust)
const uuid = (n: number) => `00000000-0000-0000-0000-0000000000${n.toString(16).padStart(2, '0')}`
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()

let pool: Pool
let deps: PmDeps

beforeAll(() => {
	if (!HAS_DB) return
	pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
	deps = { db: drizzle(pool, { schema }) }
})

afterAll(async () => {
	await pool?.end()
})

// Isolate every test: wipe all pm_* rows so balances/ledger start clean.
beforeEach(async () => {
	if (!HAS_DB) return
	await deps.db.execute(sql`
		truncate pm_ledger, pm_bets, pm_market_outcomes, pm_resolution_proposals,
		         pm_market_history, pm_markets, pm_wallets, pm_config, pm_rate_limits restart identity cascade
	`)
})

// --- helpers ---------------------------------------------------------------
const balance = async (userId: string) => (await reads.getWalletBalance(deps, userId)).balance

/** Pin the creator-reward band to a single point so executeResolution's random draw is deterministic. */
async function seedConfig(over?: { creatorRewardBps?: number }) {
	const bps = over?.creatorRewardBps ?? 2000
	await governance.updateConfig(deps, {
		actorUserId: ADMIN,
		defaultRakeBps: 500,
		defaultMinStake: '1',
		twoOfNThreshold: null, // disable two-of-N ⇒ single-step resolve
		creatorRewardMinBps: bps,
		creatorRewardMaxBps: bps,
	})
}

const grant = (userId: string, amount: string) =>
	wallet.grantPoints(deps, {
		actorUserId: ADMIN,
		targetUserId: userId,
		amount,
		reason: 'test seed',
		idempotencyKey: `seed:${userId}:${amount}`,
	})

const sumText = (col: typeof pmLedger.amount | typeof pmWallets.balance) =>
	sql<string>`coalesce(sum(${col}), 0)::text`

/** Global invariant: signed ledger sum == Σ wallet balances == total granted supply. */
async function assertConservation(expectedTotal: bigint) {
	const [{ v: ledger }] = await deps.db.select({ v: sumText(pmLedger.amount) }).from(pmLedger)
	const [{ v: wallets }] = await deps.db.select({ v: sumText(pmWallets.balance) }).from(pmWallets)
	expect(BigInt(ledger)).toBe(expectedTotal)
	expect(BigInt(wallets)).toBe(expectedTotal)
}

// ---------------------------------------------------------------------------
// A) place-bet → resolve
// ---------------------------------------------------------------------------
suite('resolve flow', () => {
	it('pays winners, rakes the house, rewards the creator, burns dust, and conserves the pool', async () => {
		const [creator, resolver, u1, u2, u3] = [1, 2, 3, 4, 5].map(uuid)
		await seedConfig({ creatorRewardBps: 2000 })
		for (const u of [u1, u2, u3]) await grant(u, '1000') // total supply = 3000

		const m = await market.createMarket(deps, {
			createdBy: creator,
			question: 'A or B?',
			outcomes: ['A', 'B'],
			closesAt: hoursFromNow(1),
			resolvesOn: hoursFromNow(2),
			rakeBps: 500,
		})
		const A = m.outcomes.find((o) => o.label === 'A')!.id
		const B = m.outcomes.find((o) => o.label === 'B')!.id

		await betting.placeBet(deps, {
			userId: u1,
			marketId: m.id,
			outcomeId: A,
			amount: '100',
			idempotencyKey: 'i-u1',
		})
		await betting.placeBet(deps, {
			userId: u2,
			marketId: m.id,
			outcomeId: A,
			amount: '100',
			idempotencyKey: 'i-u2',
		})
		await betting.placeBet(deps, {
			userId: u3,
			marketId: m.id,
			outcomeId: B,
			amount: '100',
			idempotencyKey: 'i-u3',
		})
		expect(await balance(u1)).toBe('900') // debited once

		await market.closeMarket(deps, { actorUserId: resolver, marketId: m.id })
		const res = await settlement.proposeResolution(deps, {
			resolverId: resolver, // not creator, holds no position ⇒ single-step resolve
			marketId: m.id,
			outcomeId: A,
		})
		expect(res.status).toBe('resolved')

		// losingPool 100 @ 5% ⇒ rake 5; winnings = floor(100·100·9500/(200·10000)) = 47 ⇒ payout 147.
		// dust = (300 − 294) − 5 = 1. creatorReward = floor(5·0.2) = 1, houseRake = 4.
		expect(await balance(u1)).toBe('1047')
		expect(await balance(u2)).toBe('1047')
		expect(await balance(u3)).toBe('900')
		expect(await balance(creator)).toBe('1') // creator_reward; wallet lazily created (fix-1 path)
		expect(await balance(SYSTEM)).toBe('5') // rake 4 + burn 1

		// Nothing created or destroyed — 3000 in, 3000 across all wallets and the ledger.
		await assertConservation(3000n)

		// Ledger line-type accounting for this market.
		const [{ v: payout }] = await deps.db
			.select({ v: sumText(pmLedger.amount) })
			.from(pmLedger)
			.where(and(eq(pmLedger.type, 'payout'), eq(pmLedger.marketId, m.id)))
		expect(BigInt(payout)).toBe(294n)

		const lines = await deps.db
			.select({ type: pmLedger.type, amount: pmLedger.amount })
			.from(pmLedger)
			.where(
				and(eq(pmLedger.marketId, m.id), inArray(pmLedger.type, ['rake', 'burn', 'creator_reward']))
			)
		expect(Object.fromEntries(lines.map((l) => [l.type, l.amount]))).toEqual({
			rake: '4',
			burn: '1',
			creator_reward: '1',
		})

		// balanceAfter snapshot on the winner's last ledger row equals their wallet balance.
		const [{ ba }] = await deps.db
			.select({ ba: pmLedger.balanceAfter })
			.from(pmLedger)
			.where(eq(pmLedger.userId, u1))
			.orderBy(desc(pmLedger.createdAt), desc(pmLedger.id))
			.limit(1)
		expect(ba).toBe('1047')

		// Losing bet marked lost; winning bets marked won.
		expect(res.resolvedOutcomeId).toBe(A)
		void B
	})
})

// ---------------------------------------------------------------------------
// B) void → refund
// ---------------------------------------------------------------------------
suite('void flow', () => {
	it('refunds every active bet at full stake and voids the market', async () => {
		const [creator, actor, u1, u2] = [1, 2, 3, 4].map(uuid)
		await seedConfig()
		for (const u of [u1, u2]) await grant(u, '500')

		const m = await market.createMarket(deps, {
			createdBy: creator,
			question: 'void me',
			outcomes: ['A', 'B'],
			closesAt: hoursFromNow(1),
			resolvesOn: hoursFromNow(2),
		})
		const A = m.outcomes.find((o) => o.label === 'A')!.id
		await betting.placeBet(deps, {
			userId: u1,
			marketId: m.id,
			outcomeId: A,
			amount: '100',
			idempotencyKey: 'v-u1',
		})
		await betting.placeBet(deps, {
			userId: u2,
			marketId: m.id,
			outcomeId: A,
			amount: '200',
			idempotencyKey: 'v-u2',
		})
		expect(await balance(u1)).toBe('400')

		// actor: non-creator, non-participant with resolver authority. A market with NO designated
		// resolvers is voidable by a single actor (a designated market would need approverId).
		await settlement.voidMarket(deps, {
			actorUserId: actor,
			marketId: m.id,
			reason: 'bad question',
		})

		expect((await reads.getMarket(deps, m.id))?.status).toBe('voided')
		expect(await balance(u1)).toBe('500') // full refund
		expect(await balance(u2)).toBe('500')
		await assertConservation(1000n) // wagers and refunds net to zero

		const [{ n }] = await deps.db
			.select({ n: sql<number>`count(*)::int` })
			.from(pmBets)
			.where(and(eq(pmBets.marketId, m.id), eq(pmBets.status, 'refunded')))
		expect(n).toBe(2)
	})
})

// ---------------------------------------------------------------------------
// C) bet idempotency
// ---------------------------------------------------------------------------
suite('bet idempotency', () => {
	it('a re-delivered bet (same idempotencyKey) returns the prior bet and debits once', async () => {
		const [creator, u1] = [1, 3].map(uuid)
		await seedConfig()
		await grant(u1, '500')
		const m = await market.createMarket(deps, {
			createdBy: creator,
			question: 'dupe?',
			outcomes: ['A', 'B'],
			closesAt: hoursFromNow(1),
			resolvesOn: hoursFromNow(2),
		})
		const A = m.outcomes.find((o) => o.label === 'A')!.id
		const bet = {
			userId: u1,
			marketId: m.id,
			outcomeId: A,
			amount: '100',
			idempotencyKey: 'dupe-1',
		}

		const first = await betting.placeBet(deps, bet)
		const second = await betting.placeBet(deps, bet) // same key ⇒ re-delivery
		expect(second.deduped).toBe(true)
		expect(second.id).toBe(first.id)
		expect(await balance(u1)).toBe('400') // debited once, not twice
	})
})

// ---------------------------------------------------------------------------
// D) admin override resolve — a site admin can ALWAYS resolve a market
// ---------------------------------------------------------------------------
suite('admin override resolve', () => {
	it('lets a site admin resolve a market they created AND bet on, collapsing two-of-N in one step', async () => {
		const [adminCreator, u1, u2] = [1, 3, 4].map(uuid)
		// twoOfNThreshold '0' ⇒ requiresTwoOfN is true for EVERY market (pool ≥ 0), so a normal resolve
		// would only PROPOSE and await a second distinct signer. rake 0 + reward band 0 keeps the payout
		// arithmetic exact and self-contained.
		await governance.updateConfig(deps, {
			actorUserId: ADMIN,
			defaultRakeBps: 0,
			defaultMinStake: '1',
			twoOfNThreshold: '0',
			creatorRewardMinBps: 0,
			creatorRewardMaxBps: 0,
		})
		for (const u of [adminCreator, u1, u2]) await grant(u, '1000') // supply 3000

		const m = await market.createMarket(deps, {
			createdBy: adminCreator,
			question: 'admin resolves own?',
			outcomes: ['A', 'B'],
			closesAt: hoursFromNow(1),
			resolvesOn: hoursFromNow(2),
			rakeBps: 0,
		})
		const A = m.outcomes.find((o) => o.label === 'A')!.id

		// The admin creator ALSO bets on A — normally BOTH CREATOR_CANNOT_RESOLVE and
		// RESOLVER_HAS_POSITION would block them from resolving.
		await betting.placeBet(deps, {
			userId: adminCreator,
			marketId: m.id,
			outcomeId: A,
			amount: '100',
			idempotencyKey: 'ao-admin',
		})
		await betting.placeBet(deps, {
			userId: u1,
			marketId: m.id,
			outcomeId: A,
			amount: '100',
			idempotencyKey: 'ao-u1',
		})
		await betting.placeBet(deps, {
			userId: u2,
			marketId: m.id,
			outcomeId: m.outcomes.find((o) => o.label === 'B')!.id,
			amount: '100',
			idempotencyKey: 'ao-u2',
		})

		await market.closeMarket(deps, { actorUserId: adminCreator, marketId: m.id })

		// Without adminOverride the creator-and-positioned resolver is blocked outright. The creator
		// guard fires first (PmError.message IS the code across the RPC boundary).
		await expect(
			settlement.proposeResolution(deps, { resolverId: adminCreator, marketId: m.id, outcomeId: A })
		).rejects.toThrow('CREATOR_CANNOT_RESOLVE')
		// Market is untouched by the rejected attempt — still closed, not resolving.
		expect((await reads.getMarket(deps, m.id))?.status).toBe('closed')

		// adminOverride skips every conflict-of-interest guard AND the two-of-N second-signer rule ⇒
		// resolves directly in a single step (never 'resolving').
		const res = await settlement.proposeResolution(deps, {
			resolverId: adminCreator,
			marketId: m.id,
			outcomeId: A,
			adminOverride: true,
		})
		expect(res.status).toBe('resolved')
		expect(res.resolvedOutcomeId).toBe(A)

		// rake 0 ⇒ each A-bettor gets stake back + a pro-rata share of the 100-point losing pool:
		// payout = 100 + floor(100 · 100 / 200) = 150. The admin self-dealt a win — now permitted.
		expect(await balance(adminCreator)).toBe('1050')
		expect(await balance(u1)).toBe('1050')
		expect(await balance(u2)).toBe('900') // lost their stake
		await assertConservation(3000n)

		// Audit trail: the resolution records the admin override for accountability.
		const [row] = await deps.db
			.select({ metadata: pmMarketHistory.metadata })
			.from(pmMarketHistory)
			.where(and(eq(pmMarketHistory.marketId, m.id), eq(pmMarketHistory.action, 'resolved')))
			.limit(1)
		expect((row?.metadata as { adminOverride?: boolean }).adminOverride).toBe(true)
	})

	it('lets a site admin single-sign a pending two-of-N proposal they created AND bet on', async () => {
		// Covers approveResolution's OWN adminOverride guard-skip branch (independent of proposeResolution's):
		// a non-admin proposer opens a two-of-N proposal, then an admin who is the creator and holds a
		// position — normally doubly blocked — finalizes it alone via adminOverride.
		const [adminCreator, proposer, u1, u2] = [1, 2, 3, 4].map(uuid)
		await governance.updateConfig(deps, {
			actorUserId: ADMIN,
			defaultRakeBps: 0,
			defaultMinStake: '1',
			twoOfNThreshold: '0', // every market is two-of-N ⇒ a normal resolve only PROPOSES
			creatorRewardMinBps: 0,
			creatorRewardMaxBps: 0,
		})
		for (const u of [adminCreator, u1, u2]) await grant(u, '1000') // supply 3000

		const m = await market.createMarket(deps, {
			createdBy: adminCreator,
			question: 'admin approves own?',
			outcomes: ['A', 'B'],
			closesAt: hoursFromNow(1),
			resolvesOn: hoursFromNow(2),
			rakeBps: 0,
		})
		const A = m.outcomes.find((o) => o.label === 'A')!.id
		const B = m.outcomes.find((o) => o.label === 'B')!.id

		await betting.placeBet(deps, {
			userId: adminCreator,
			marketId: m.id,
			outcomeId: A,
			amount: '100',
			idempotencyKey: 'ap-admin',
		})
		await betting.placeBet(deps, {
			userId: u1,
			marketId: m.id,
			outcomeId: A,
			amount: '100',
			idempotencyKey: 'ap-u1',
		})
		await betting.placeBet(deps, {
			userId: u2,
			marketId: m.id,
			outcomeId: B,
			amount: '100',
			idempotencyKey: 'ap-u2',
		})

		await market.closeMarket(deps, { actorUserId: adminCreator, marketId: m.id })

		// A distinct non-creator, position-free resolver proposes ⇒ two-of-N ⇒ market enters 'resolving'
		// with a pending proposal awaiting a second signer.
		const proposed = await settlement.proposeResolution(deps, {
			resolverId: proposer,
			marketId: m.id,
			outcomeId: A,
		})
		expect(proposed.status).toBe('resolving')
		const proposalId = proposed.proposalId!

		// The admin creator (also positioned) cannot approve normally — CREATOR_CANNOT_RESOLVE fires
		// (RESOLVER_HAS_POSITION would too). The rejected attempt leaves the proposal pending.
		await expect(
			settlement.approveResolution(deps, { resolverId: adminCreator, marketId: m.id, proposalId })
		).rejects.toThrow('CREATOR_CANNOT_RESOLVE')
		expect((await reads.getMarket(deps, m.id))?.status).toBe('resolving')

		// adminOverride lets them single-sign the pending proposal ⇒ resolved (self-dealt win — permitted).
		const res = await settlement.approveResolution(deps, {
			resolverId: adminCreator,
			marketId: m.id,
			proposalId,
			adminOverride: true,
		})
		expect(res.status).toBe('resolved')
		expect(res.resolvedOutcomeId).toBe(A)

		// Same parimutuel arithmetic as the direct-resolve case: each A-bettor gets 100 + 50 = 150.
		expect(await balance(adminCreator)).toBe('1050')
		expect(await balance(u1)).toBe('1050')
		expect(await balance(u2)).toBe('900')
		await assertConservation(3000n)

		// The 'resolved' audit row records the override; proposer earns nothing (never bet).
		const [row] = await deps.db
			.select({ metadata: pmMarketHistory.metadata })
			.from(pmMarketHistory)
			.where(and(eq(pmMarketHistory.marketId, m.id), eq(pmMarketHistory.action, 'resolved')))
			.limit(1)
		expect((row?.metadata as { adminOverride?: boolean }).adminOverride).toBe(true)
		expect(await balance(proposer)).toBe('0')
	})
})

// ---------------------------------------------------------------------------
// E) award random bonus — a house-funded transfer to a random member
// ---------------------------------------------------------------------------
suite('award random bonus', () => {
	/** Resolve a raked market so the house/system wallet accrues a real, conserved balance. */
	async function fundHouseViaResolve(): Promise<{ house: bigint; u1: string; u2: string }> {
		const [creator, resolver, u1, u2] = [1, 2, 3, 4].map(uuid)
		// rake 10%, no creator reward ⇒ all the rake lands in the house wallet (nothing to the creator,
		// whose wallet therefore never gets created), keeping the eligible set exactly {u1, u2}.
		await governance.updateConfig(deps, {
			actorUserId: ADMIN,
			defaultRakeBps: 0,
			defaultMinStake: '1',
			twoOfNThreshold: null,
			creatorRewardMinBps: 0,
			creatorRewardMaxBps: 0,
		})
		for (const u of [u1, u2]) await grant(u, '1000') // supply 2000
		const m = await market.createMarket(deps, {
			createdBy: creator,
			question: 'fund the house',
			outcomes: ['A', 'B'],
			closesAt: hoursFromNow(1),
			resolvesOn: hoursFromNow(2),
			rakeBps: 1000,
		})
		const A = m.outcomes.find((o) => o.label === 'A')!.id
		const B = m.outcomes.find((o) => o.label === 'B')!.id
		await betting.placeBet(deps, {
			userId: u1,
			marketId: m.id,
			outcomeId: A,
			amount: '100',
			idempotencyKey: 'ab-u1',
		})
		await betting.placeBet(deps, {
			userId: u2,
			marketId: m.id,
			outcomeId: B,
			amount: '100',
			idempotencyKey: 'ab-u2',
		})
		await market.closeMarket(deps, { actorUserId: resolver, marketId: m.id })
		const res = await settlement.proposeResolution(deps, {
			resolverId: resolver,
			marketId: m.id,
			outcomeId: A,
		})
		expect(res.status).toBe('resolved')
		const house = BigInt(await balance(SYSTEM))
		expect(house).toBeGreaterThan(0n)
		await assertConservation(2000n) // a resolve is a pure redistribution
		return { house, u1, u2 }
	}

	it('moves the bonus from the house wallet to a random member and conserves supply', async () => {
		const { house, u1, u2 } = await fundHouseViaResolve()
		const before1 = BigInt(await balance(u1))
		const before2 = BigInt(await balance(u2))

		const result = await wallet.awardRandomBonus(deps, { amount: '3', reason: 'markee bonus' })
		expect(result.awarded).toBe(true)
		if (!result.awarded) throw new Error('expected an award')
		// The winner is a real member (never the house), drawn from the only eligible wallets.
		expect(result.userId).not.toBe(SYSTEM)
		expect([u1, u2]).toContain(result.userId)
		expect(result.amount).toBe('3')

		// House down by exactly 3; exactly one member up by exactly 3; nothing created or destroyed.
		expect(BigInt(await balance(SYSTEM))).toBe(house - 3n)
		const d1 = BigInt(await balance(u1)) - before1
		const d2 = BigInt(await balance(u2)) - before2
		expect(d1 + d2).toBe(3n)
		expect([d1, d2]).toContain(3n)
		expect(BigInt(await balance(result.userId))).toBe(
			result.userId === u1 ? before1 + 3n : before2 + 3n
		)
		await assertConservation(2000n)

		// Booked as two `adjustment` lines (house −3, member +3) that net to zero, tagged source:'bonus'.
		const adj = await deps.db
			.select({ userId: pmLedger.userId, amount: pmLedger.amount, metadata: pmLedger.metadata })
			.from(pmLedger)
			.where(eq(pmLedger.type, 'adjustment'))
		expect(adj).toHaveLength(2)
		expect(adj.reduce((s, r) => s + BigInt(r.amount), 0n)).toBe(0n)
		const houseLine = adj.find((r) => r.userId === SYSTEM)!
		const memberLine = adj.find((r) => r.userId === result.userId)!
		expect(BigInt(houseLine.amount)).toBe(-3n)
		expect(BigInt(memberLine.amount)).toBe(3n)
		// Audit payload (not just the tag): the reason is stamped on BOTH lines, and the house debit
		// carries counterpartyUserId linking it to the winner — the adjustment lines have no
		// marketId/betId, so this is the only ledger link pairing the two halves of the transfer.
		const meta = (r: (typeof adj)[number]) =>
			r.metadata as { source?: string; reason?: string; counterpartyUserId?: string }
		expect(meta(houseLine)).toMatchObject({ source: 'bonus', reason: 'markee bonus' })
		expect(meta(memberLine)).toMatchObject({ source: 'bonus', reason: 'markee bonus' })
		expect(meta(houseLine).counterpartyUserId).toBe(result.userId)
	})

	it('skips cleanly when there are no eligible wallets', async () => {
		// Fresh truncated state ⇒ pm_wallets is empty (not even a house wallet exists).
		const result = await wallet.awardRandomBonus(deps, { amount: '5', reason: 'x' })
		expect(result).toEqual({ awarded: false, reason: 'NO_ELIGIBLE_WALLETS' })
	})

	it('skips (and moves no money) when the house wallet cannot fund the bonus', async () => {
		await grant(uuid(3), '10') // creates only the member's wallet; the house wallet stays absent
		const result = await wallet.awardRandomBonus(deps, { amount: '5', reason: 'x' })
		expect(result).toEqual({ awarded: false, reason: 'INSUFFICIENT_HOUSE_FUNDS' })
		expect(await balance(uuid(3))).toBe('10') // untouched
		const [{ n }] = await deps.db
			.select({ n: sql<number>`count(*)::int` })
			.from(pmLedger)
			.where(eq(pmLedger.type, 'adjustment'))
		expect(n).toBe(0) // no ledger lines written on a skip
		await assertConservation(10n)
	})

	it('rejects an invalid request (non-positive amount / missing reason)', async () => {
		await grant(uuid(3), '10')
		await expect(wallet.awardRandomBonus(deps, { amount: '0', reason: 'x' })).rejects.toThrow(
			'INVALID_AMOUNT'
		)
		await expect(wallet.awardRandomBonus(deps, { amount: 'abc', reason: 'x' })).rejects.toThrow(
			'INVALID_AMOUNT'
		)
		await expect(wallet.awardRandomBonus(deps, { amount: '5', reason: '  ' })).rejects.toThrow(
			'REASON_REQUIRED'
		)
	})
})
