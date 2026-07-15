/**
 * LMSR money-flow INTEGRATION tests.
 *
 * Drives the real LMSR service functions against a real Postgres (the same ephemeral Neon branch
 * harness as money-flow.int.test.ts), covering what the pure fixed-point unit suite cannot:
 *   A) create → buy: the trader pays a quantized cost to the dedicated LMSR house, shares are minted,
 *      prices move, and the SHARED-currency conservation invariant still holds across pm + lmsr.
 *   B) buy idempotency (no double-debit on a re-delivered interaction).
 *   C) insufficient funds / slippage / house-underfunded rejections leave no state behind.
 *   D) isolation: the dedicated LMSR house wallet is excluded from every parimutuel-facing read
 *      (leaderboard, wallet grid, random-bonus recipient) — the Increment-3 exclusion edits.
 *
 * REQUIRES migration 0009 (the lmsr_* tables) to be applied to the shared test parent branch — the
 * schema-only ephemeral branch runs no migrations. Skips cleanly when no Neon creds (TEST_DATABASE_URL).
 */

import { neonConfig, Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { sql } from '@repo/db-utils'
import { LMSR_HOUSE_WALLET_USER_ID } from '@repo/prediction-markets'

import { schema } from '../../db'
import { pmLedger, pmWallets } from '../../db/schema'
import * as lmsrMarket from '../../services/lmsr-market-service'
import * as lmsrReads from '../../services/lmsr-read-service'
import * as lmsrTrade from '../../services/lmsr-trade-service'
import * as reads from '../../services/read-service'
import * as wallet from '../../services/wallet-service'

import type { PmDeps } from '../../services/context'

neonConfig.webSocketConstructor = WebSocket as unknown as typeof neonConfig.webSocketConstructor

const HAS_DB = Boolean(process.env.TEST_DATABASE_URL)
const suite = HAS_DB ? describe : describe.skip

const ADMIN = '00000000-0000-0000-0000-0000000000aa' // grant actor (never a participant)
const HOUSE = LMSR_HOUSE_WALLET_USER_ID
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

// Isolate every test: wipe the lmsr_* tables plus the SHARED money tables LMSR writes.
beforeEach(async () => {
	if (!HAS_DB) return
	await deps.db.execute(sql`
		truncate lmsr_trades, lmsr_positions, lmsr_outcomes, lmsr_market_history, lmsr_markets,
		         pm_ledger, pm_wallets, pm_rate_limits restart identity cascade
	`)
})

// --- helpers ---------------------------------------------------------------
const balance = async (userId: string) => (await reads.getWalletBalance(deps, userId)).balance

const grant = (userId: string, amount: string) =>
	wallet.grantPoints(deps, {
		actorUserId: ADMIN,
		targetUserId: userId,
		amount,
		reason: 'test seed',
		idempotencyKey: `seed:${userId}:${amount}`,
	})

/** A default b=1000, 2-outcome market created by an admin (uncapped duration). */
const createMarket = () =>
	lmsrMarket.createLmsrMarket(deps, {
		createdBy: uuid(1),
		question: 'A or B?',
		outcomes: ['A', 'B'],
		closesAt: hoursFromNow(1),
		resolvesOn: hoursFromNow(2),
		liquidityParam: '1000',
		createdByAdmin: true,
	})

const sumText = (col: typeof pmLedger.amount | typeof pmWallets.balance) =>
	sql<string>`coalesce(sum(${col}), 0)::text`

/** Global invariant: signed ledger sum == Σ wallet balances == total granted supply — across BOTH
 * mechanisms, since LMSR shares pm_wallets/pm_ledger. An LMSR bug that mints/burns points fails here. */
async function assertConservation(expectedTotal: bigint) {
	const [{ v: ledger }] = await deps.db.select({ v: sumText(pmLedger.amount) }).from(pmLedger)
	const [{ v: wallets }] = await deps.db.select({ v: sumText(pmWallets.balance) }).from(pmWallets)
	expect(BigInt(ledger)).toBe(expectedTotal)
	expect(BigInt(wallets)).toBe(expectedTotal)
}

// ---------------------------------------------------------------------------
// A) create → buy
// ---------------------------------------------------------------------------
suite('create + buy', () => {
	it('moves the trader cost to the LMSR house, mints shares, shifts prices, and conserves supply', async () => {
		await grant(HOUSE, '100000')
		await grant(uuid(3), '1000')
		const total = 101_000n
		await assertConservation(total)

		const m = await createMarket()
		expect(m.status).toBe('open')
		expect(m.outcomes).toHaveLength(2)
		// Uniform start ⇒ both outcomes ≈ 5000 bps.
		expect(m.outcomes[0].priceBps).toBeGreaterThanOrEqual(4990)
		expect(m.outcomes[0].priceBps).toBeLessThanOrEqual(5010)
		await assertConservation(total) // create moves no money (subsidy is a reservation, not a debit)

		const A = m.outcomes[0].id
		const trade = await lmsrTrade.buyShares(deps, {
			userId: uuid(3),
			marketId: m.id,
			outcomeId: A,
			shares: '100',
			idempotencyKey: 'buy-1',
		})
		expect(trade.deduped).toBe(false)
		const cost = BigInt(trade.costPoints)
		expect(cost).toBeGreaterThan(0n)

		expect(BigInt(await balance(uuid(3)))).toBe(1000n - cost) // trader paid the cost
		expect(BigInt(await balance(HOUSE))).toBe(100_000n + cost) // LMSR house received it
		await assertConservation(total) // still exactly conserved

		// Price of A rose above B; net_shares and the user's position reflect the buy.
		const after = await lmsrReads.getLmsrMarket(deps, m.id)
		const outA = after!.outcomes.find((o) => o.id === A)!
		const outB = after!.outcomes.find((o) => o.id !== A)!
		expect(outA.priceBps).toBeGreaterThan(outB.priceBps)
		expect(outA.netShares).toBe('100')
		const positions = await lmsrReads.getUserLmsrPositions(deps, uuid(3))
		expect(positions).toEqual([
			{ marketId: m.id, outcomeId: A, outcomeLabel: 'A', shares: '100' },
		])
	})

	it('a re-delivered buy (same idempotencyKey) returns the prior trade and debits once', async () => {
		await grant(HOUSE, '100000')
		await grant(uuid(3), '1000')
		const m = await createMarket()
		const A = m.outcomes[0].id
		const trade = { userId: uuid(3), marketId: m.id, outcomeId: A, shares: '50', idempotencyKey: 'dup' }
		const first = await lmsrTrade.buyShares(deps, trade)
		const second = await lmsrTrade.buyShares(deps, trade)
		expect(second.deduped).toBe(true)
		expect(second.id).toBe(first.id)
		expect(BigInt(await balance(uuid(3)))).toBe(1000n - BigInt(first.costPoints)) // once, not twice
	})
})

// ---------------------------------------------------------------------------
// B) rejections leave no state behind
// ---------------------------------------------------------------------------
suite('rejections', () => {
	it('rejects a buy the trader cannot afford and moves no money', async () => {
		await grant(HOUSE, '100000')
		await grant(uuid(3), '1') // only 1 point — nowhere near the cost of 100 shares
		const m = await createMarket()
		const A = m.outcomes[0].id
		await expect(
			lmsrTrade.buyShares(deps, {
				userId: uuid(3),
				marketId: m.id,
				outcomeId: A,
				shares: '100',
				idempotencyKey: 'broke',
			})
		).rejects.toThrow('INSUFFICIENT_FUNDS')
		expect(await balance(uuid(3))).toBe('1') // rolled back
		expect(await balance(HOUSE)).toBe('100000')
	})

	it('rejects market creation when the house cannot cover the subsidy reservation', async () => {
		await grant(HOUSE, '10') // ceil(1000·ln2) ≈ 694 » 10
		await expect(createMarket()).rejects.toThrow('LMSR_HOUSE_UNDERFUNDED')
	})

	it('reserves subsidy cumulatively across live markets', async () => {
		await grant(HOUSE, '1000') // covers one market (~694) but not two (~1388)
		await createMarket()
		await expect(createMarket()).rejects.toThrow('LMSR_HOUSE_UNDERFUNDED')
	})

	it('rejects a buy whose quoted cost exceeds maxCost, then succeeds at the quote', async () => {
		await grant(HOUSE, '100000')
		await grant(uuid(3), '1000')
		const m = await createMarket()
		const A = m.outcomes[0].id
		const quote = await lmsrReads.previewLmsrCost(deps, { marketId: m.id, outcomeId: A, shares: '100' })
		const cost = BigInt(quote!.cost)
		await expect(
			lmsrTrade.buyShares(deps, {
				userId: uuid(3),
				marketId: m.id,
				outcomeId: A,
				shares: '100',
				idempotencyKey: 'slip',
				maxCost: (cost - 1n).toString(),
			})
		).rejects.toThrow('LMSR_SLIPPAGE_EXCEEDED')
		// The rejected attempt changed nothing, so executing at the quoted cost succeeds and matches it.
		const ok = await lmsrTrade.buyShares(deps, {
			userId: uuid(3),
			marketId: m.id,
			outcomeId: A,
			shares: '100',
			idempotencyKey: 'slip-ok',
			maxCost: cost.toString(),
		})
		expect(BigInt(ok.costPoints)).toBe(cost)
	})
})

// ---------------------------------------------------------------------------
// C) isolation — the LMSR house wallet is invisible to parimutuel-facing reads
// ---------------------------------------------------------------------------
suite('isolation: LMSR house excluded from parimutuel reads', () => {
	it('awardRandomBonus never selects the LMSR house (excluded like SYSTEM)', async () => {
		await grant(HOUSE, '100000') // the ONLY wallet — if it were eligible it would be drawn
		const result = await wallet.awardRandomBonus(deps, { amount: '5', reason: 'x' })
		expect(result).toEqual({ awarded: false, reason: 'NO_ELIGIBLE_WALLETS' })
	})

	it('excludes the LMSR house from the leaderboard and the admin wallet grid', async () => {
		await grant(HOUSE, '100000') // a huge balance that would top the board if not excluded
		await grant(uuid(3), '10')
		const board = await reads.getLeaderboard(deps, {})
		expect(board.map((r) => r.userId)).not.toContain(HOUSE)
		expect(board.map((r) => r.userId)).toContain(uuid(3))
		const grid = await reads.listWallets(deps, {})
		expect(grid.rows.map((r) => r.userId)).not.toContain(HOUSE)
	})
})
