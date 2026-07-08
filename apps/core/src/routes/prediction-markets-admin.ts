/**
 * Prediction Markets — admin API
 *
 * Admin-only wallet management, deposits, and audit-log reads. Proxies to the
 * PredictionMarketsDO via RPC; enriches user ids with character names server-side.
 *
 * Scope (v1): deposits only (no debit/adjust), self-target deposits blocked.
 */

import { Hono } from 'hono'
import { z } from 'zod'

import { eq, ilike, inArray } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'
import { SYSTEM_WALLET_USER_ID } from '@repo/prediction-markets'

import { requireAdmin, requireAuth } from '../middleware/session'
import {
	CREATE_MARKET_BAD_REQUEST_CODES,
	createAndPublishMarket,
	createMarketSchema,
} from '../services/market-create.service'
import { userCharacters, users } from '../db/schema'

import type { createDb } from '../db'
import type { App } from '../context'
import type { Context } from 'hono'
import type { LedgerType, MarketStatus, PredictionMarkets } from '@repo/prediction-markets'

type CoreDb = ReturnType<typeof createDb>

const NULL_NAME = { userName: null as string | null, mainCharacterId: null as string | null }
/** Display label for the house/system wallet (nil-UUID owner, not a real user). */
const SYSTEM_NAME = { userName: 'System', mainCharacterId: null as string | null }

const app = new Hono<App>()

// [M1] Defense-in-depth: one guard for the whole router so a forgotten per-route
// gate can never expose wallets/ledger. `is_admin` is loaded every request
// (independent of the empty role cache under /api/admin/*).
app.use('*', requireAuth(), requireAdmin())

const stubOf = (c: Context<App>): PredictionMarkets =>
	getStub<PredictionMarkets>(c.env.PREDICTION_MARKETS, 'default')

function parsePage(
	limitRaw: string | undefined,
	offsetRaw: string | undefined,
	def: number,
	max: number
): { limit: number; offset: number } {
	const limit = Math.min(Math.max(parseInt(limitRaw || String(def), 10) || def, 1), max)
	const offset = Math.max(parseInt(offsetRaw || '0', 10) || 0, 0)
	return { limit, offset }
}

/** Resolve core user ids (uuid) → { userName, mainCharacterId } for display. */
async function enrichUserNames(
	db: CoreDb,
	ids: Array<string | null>
): Promise<Map<string, { userName: string | null; mainCharacterId: string | null }>> {
	const uniq = [...new Set(ids.filter((x): x is string => Boolean(x)))]
	if (uniq.length === 0) return new Map()
	const rows = await db
		.select({
			id: users.id,
			mainCharacterId: users.mainCharacterId,
			characterName: userCharacters.characterName,
		})
		.from(users)
		.leftJoin(userCharacters, eq(userCharacters.characterId, users.mainCharacterId))
		.where(inArray(users.id, uniq))
	return new Map(
		rows.map((r) => [
			r.id,
			{ userName: r.characterName ?? null, mainCharacterId: r.mainCharacterId ?? null },
		])
	)
}

function nameOf(
	names: Map<string, { userName: string | null; mainCharacterId: string | null }>,
	userId: string | null
): { userName: string | null; mainCharacterId: string | null } {
	if (userId === SYSTEM_WALLET_USER_ID) return SYSTEM_NAME
	return userId ? (names.get(userId) ?? NULL_NAME) : NULL_NAME
}

function fail(c: Context<App>, error: unknown, what: string) {
	if (error instanceof z.ZodError) {
		return c.json({ error: 'Validation failed', issues: error.issues }, 400)
	}
	const msg = error instanceof Error ? error.message : String(error)
	if (msg === 'SELF_TARGET_FORBIDDEN') {
		return c.json({ error: 'Cannot deposit to your own wallet' }, 400)
	}
	if (msg === 'SYSTEM_TARGET_FORBIDDEN') {
		return c.json({ error: 'Cannot deposit to the system wallet' }, 400)
	}
	if (msg === 'IDEMPOTENCY_KEY_CONFLICT') {
		return c.json({ error: 'Idempotency key already used with different parameters' }, 409)
	}
	// Client-input domain errors from the PM DO → 400 (would otherwise be a misleading 500).
	if (BAD_REQUEST_CODES.has(msg)) {
		return c.json({ error: msg }, 400)
	}
	logger.error(`[PMAdmin] ${what} failed`, { error: msg })
	return c.json({ error: msg }, 500)
}

/** PM DO error codes that are the caller's fault (bad input) rather than a server error. */
const BAD_REQUEST_CODES = new Set<string>([
	// deposit path (grantPoints)
	'INVALID_AMOUNT',
	'REASON_REQUIRED',
	// create path (shared with the member create route)
	...CREATE_MARKET_BAD_REQUEST_CODES,
])

// -------------------------------------------------------------------------
// Wallets
// -------------------------------------------------------------------------

// GET /wallets?search=&sort=&order=&limit=&offset=
app.get('/wallets', async (c) => {
	try {
		const db = c.get('db')
		if (!db) return c.json({ error: 'Database not initialized' }, 500)

		const { limit, offset } = parsePage(c.req.query('limit'), c.req.query('offset'), 25, 100)
		const sortRaw = c.req.query('sort')
		const sort = sortRaw === 'updatedAt' || sortRaw === 'userId' ? sortRaw : 'balance'
		const order = c.req.query('order') === 'asc' ? 'asc' : 'desc'
		const search = c.req.query('search')?.trim()

		let userIds: string[] | undefined
		if (search) {
			const matches = await db
				.selectDistinct({ userId: userCharacters.userId })
				.from(userCharacters)
				.where(ilike(userCharacters.characterName, `%${search}%`))
				.limit(500)
			userIds = matches.map((m) => m.userId)
			if (userIds.length === 0) return c.json({ rows: [], total: 0 })
		}

		const { rows, total } = await stubOf(c).listWallets({ userIds, sort, order, limit, offset })
		const names = await enrichUserNames(
			db,
			rows.map((r) => r.userId)
		)
		return c.json({
			rows: rows.map((r) => ({ ...r, ...nameOf(names, r.userId) })),
			total,
		})
	} catch (error) {
		return fail(c, error, 'list wallets')
	}
})

// GET /wallets/:userId
app.get('/wallets/:userId', async (c) => {
	try {
		const db = c.get('db')
		if (!db) return c.json({ error: 'Database not initialized' }, 500)
		const userId = c.req.param('userId')
		const { balance } = await stubOf(c).getWalletBalance(userId)
		const names = await enrichUserNames(db, [userId])
		return c.json({ userId, balance, ...nameOf(names, userId) })
	} catch (error) {
		return fail(c, error, 'get wallet')
	}
})

// GET /wallets/:userId/ledger?limit=&offset=
app.get('/wallets/:userId/ledger', async (c) => {
	try {
		const db = c.get('db')
		if (!db) return c.json({ error: 'Database not initialized' }, 500)
		const userId = c.req.param('userId')
		const { limit, offset } = parsePage(c.req.query('limit'), c.req.query('offset'), 50, 200)
		const { rows, total } = await stubOf(c).getGlobalLedger({ userId, limit, offset })
		const names = await enrichUserNames(
			db,
			rows.map((r) => r.userId)
		)
		return c.json({
			rows: rows.map((r) => ({ ...r, ...nameOf(names, r.userId) })),
			total,
		})
	} catch (error) {
		return fail(c, error, 'get user ledger')
	}
})

// -------------------------------------------------------------------------
// Deposits (credit only; self-target blocked)
// -------------------------------------------------------------------------

const depositSchema = z.object({
	targetUserId: z.string().uuid(),
	amount: z
		.string()
		.regex(/^\d+$/, 'amount must be a positive integer')
		.refine((v) => BigInt(v) > 0n, 'amount must be greater than 0'),
	reason: z.string().trim().min(3).max(500),
	idempotencyKey: z.string().min(8).max(200).optional(),
})

// POST /deposits
app.post('/deposits', async (c) => {
	try {
		const user = c.get('user')!
		const body = depositSchema.parse(await c.req.json())
		if (body.targetUserId === user.id) {
			return c.json({ error: 'Cannot deposit to your own wallet' }, 400)
		}
		const result = await stubOf(c).grantPoints({
			actorUserId: user.id,
			targetUserId: body.targetUserId,
			amount: body.amount,
			reason: body.reason,
			idempotencyKey: body.idempotencyKey,
		})
		logger.info('[PMAdmin] deposit', {
			actorId: user.id,
			targetUserId: body.targetUserId,
			amount: body.amount,
			deduped: result.deduped,
		})
		return c.json(result)
	} catch (error) {
		return fail(c, error, 'deposit')
	}
})

// -------------------------------------------------------------------------
// Markets (create → forum post)
// -------------------------------------------------------------------------

const MARKET_STATUSES: readonly MarketStatus[] = [
	'draft',
	'open',
	'closed',
	'resolving',
	'resolved',
	'voided',
]

// GET /markets?status=&limit= — recent markets + the configured guild id (for forum links).
app.get('/markets', async (c) => {
	try {
		const statusRaw = c.req.query('status')
		const status = MARKET_STATUSES.includes(statusRaw as MarketStatus)
			? (statusRaw as MarketStatus)
			: undefined
		const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 100)
		const markets = await stubOf(c).listMarkets({ status, limit })
		return c.json({ markets, guildId: c.env.PM_FORUM_GUILD_ID ?? null })
	} catch (error) {
		return fail(c, error, 'list markets')
	}
})

// POST /markets — create a market, then best-effort publish its forum post.
app.post('/markets', async (c) => {
	try {
		const db = c.get('db')
		if (!db) return c.json({ error: 'Database not initialized' }, 500)
		const user = c.get('user')!
		const body = createMarketSchema.parse(await c.req.json())
		const result = await createAndPublishMarket(db, c.env, user.id, body)
		logger.info('[PMAdmin] market created', {
			actorId: user.id,
			marketId: result.market.id,
			posted: Boolean(result.post),
		})
		return c.json(result, 201)
	} catch (error) {
		return fail(c, error, 'create market')
	}
})

// -------------------------------------------------------------------------
// Audit logs
// -------------------------------------------------------------------------

const LEDGER_TYPES: readonly LedgerType[] = [
	'grant',
	'wager',
	'refund',
	'payout',
	'rake',
	'burn',
	'adjustment',
]

// GET /audit/ledger?userId=&type=&marketId=&since=&until=&limit=&offset=
app.get('/audit/ledger', async (c) => {
	try {
		const db = c.get('db')
		if (!db) return c.json({ error: 'Database not initialized' }, 500)
		const { limit, offset } = parsePage(c.req.query('limit'), c.req.query('offset'), 50, 200)
		const typeRaw = c.req.query('type')
		const type = LEDGER_TYPES.includes(typeRaw as LedgerType) ? (typeRaw as LedgerType) : undefined
		const { rows, total } = await stubOf(c).getGlobalLedger({
			userId: c.req.query('userId') || undefined,
			type,
			marketId: c.req.query('marketId') || undefined,
			since: c.req.query('since') || undefined,
			until: c.req.query('until') || undefined,
			limit,
			offset,
		})
		const names = await enrichUserNames(
			db,
			rows.map((r) => r.userId)
		)
		return c.json({
			rows: rows.map((r) => ({ ...r, ...nameOf(names, r.userId) })),
			total,
		})
	} catch (error) {
		return fail(c, error, 'audit ledger')
	}
})

// GET /audit/market-history?marketId=&includeInternal=&since=&until=&limit=&offset=
app.get('/audit/market-history', async (c) => {
	try {
		const db = c.get('db')
		if (!db) return c.json({ error: 'Database not initialized' }, 500)
		const { limit, offset } = parsePage(c.req.query('limit'), c.req.query('offset'), 50, 200)
		const { rows, total } = await stubOf(c).getGlobalMarketHistory({
			marketId: c.req.query('marketId') || undefined,
			includeInternal: c.req.query('includeInternal') === 'true',
			since: c.req.query('since') || undefined,
			until: c.req.query('until') || undefined,
			limit,
			offset,
		})
		const names = await enrichUserNames(
			db,
			rows.map((r) => r.actorUserId)
		)
		return c.json({
			rows: rows.map((r) => ({ ...r, actor: r.actorUserId ? nameOf(names, r.actorUserId) : null })),
			total,
		})
	} catch (error) {
		return fail(c, error, 'audit market-history')
	}
})

export default app
