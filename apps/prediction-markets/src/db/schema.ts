import { sql } from 'drizzle-orm'
import {
	boolean,
	index,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const pmMarketStatus = pgEnum('pm_market_status', [
	'draft',
	'open',
	'closed',
	'resolving',
	'resolved',
	'voided',
])

export const pmBetStatus = pgEnum('pm_bet_status', ['active', 'won', 'lost', 'refunded'])

export const pmLedgerType = pgEnum('pm_ledger_type', [
	'grant',
	'wager',
	'refund',
	'payout',
	'rake',
	'burn',
	'adjustment',
])

export const pmProposalStatus = pgEnum('pm_proposal_status', [
	'pending',
	'approved',
	'rejected',
	'superseded',
])

export const pmVisibility = pgEnum('pm_visibility', ['public', 'internal'])

// ---------------------------------------------------------------------------
// Tables
//
// All monetary columns are `numeric` (returned as strings by Drizzle) so we can
// perform atomic SQL arithmetic (e.g. balance guards) without JS BigInt
// serialization hazards. References to users.id are app-level (no hard FK) to
// avoid cross-app cascade coupling.
// ---------------------------------------------------------------------------

/** Per-user cached balance. A row is created lazily on first grant. */
export const pmWallets = pgTable('pm_wallets', {
	userId: uuid('user_id').primaryKey(),
	balance: numeric('balance').notNull().default('0'),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Append-only ledger. Never UPDATE or DELETE — only INSERT. */
export const pmLedger = pgTable(
	'pm_ledger',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id'),
		/** Signed: positive for credits, negative for debits. */
		amount: numeric('amount').notNull(),
		type: pmLedgerType('type').notNull(),
		marketId: uuid('market_id'),
		betId: uuid('bet_id'),
		balanceAfter: numeric('balance_after'),
		idempotencyKey: text('idempotency_key'),
		metadata: jsonb('metadata'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		// One wager/payout/refund per bet (NULL bet_id rows — grants/burns — are unconstrained).
		uniqueIndex('pm_ledger_bet_type_uq').on(t.betId, t.type),
		uniqueIndex('pm_ledger_idempotency_key_uq')
			.on(t.idempotencyKey)
			.where(sql`${t.idempotencyKey} is not null`),
		index('pm_ledger_user_created_idx').on(t.userId, t.createdAt),
		index('pm_ledger_market_idx').on(t.marketId),
		// Global admin ledger/audit feed: ORDER BY created_at DESC, id DESC (scanned backward).
		index('pm_ledger_created_id_idx').on(t.createdAt, t.id),
	]
)

export const pmMarkets = pgTable(
	'pm_markets',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		question: text('question').notNull(),
		description: text('description'),
		status: pmMarketStatus('status').notNull().default('draft'),
		createdBy: uuid('created_by').notNull(),
		closesAt: timestamp('closes_at', { withTimezone: true }).notNull(),
		resolvedOutcomeId: uuid('resolved_outcome_id'),
		resolvedBy: uuid('resolved_by'),
		resolvedAt: timestamp('resolved_at', { withTimezone: true }),
		voidReason: text('void_reason'),
		totalPool: numeric('total_pool').notNull().default('0'),
		rakeBps: integer('rake_bps').notNull().default(0),
		minStake: numeric('min_stake').notNull().default('1'),
		maxStake: numeric('max_stake'),
		perUserCap: numeric('per_user_cap'),
		twoOfN: boolean('two_of_n').notNull().default(false),
		/**
		 * Optional set of core user ids the market maker designated as this market's resolver(s). NULL
		 * (or empty) means NO designation — settlement falls back to the global `urn:markets:resolver`
		 * authority, exactly as before this feature (so every legacy / in-flight market keeps working
		 * with no backfill). A non-empty set NARROWS settlement to these ids (plus admin/manager
		 * override). Each id is validated to hold the resolver tier at create time; stored lowercased.
		 */
		designatedResolvers: uuid('designated_resolvers').array(),
		/** Discord forum thread id for this market's post (null until the post is created). */
		discordThreadId: text('discord_thread_id'),
		/** Discord starter-message id of the forum post (equals the thread id for forum posts). */
		discordMessageId: text('discord_message_id'),
		/**
		 * When the terminal (resolved/voided) settlement notification — the thread result post +
		 * per-participant result DMs — finished. NULL until then. The live resolve/void path sets it
		 * after its `waitUntil` fan-out completes; the reconcile sweep re-sends any terminal market
		 * still NULL past a grace window (cross-eviction self-heal: Core dying mid-notify drops the
		 * best-effort `waitUntil` work with no other trace).
		 */
		settlementAnnouncedAt: timestamp('settlement_announced_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index('pm_markets_status_closes_idx').on(t.status, t.closesAt),
		// One market per forum thread. NULLs are distinct in Postgres b-tree, so many
		// pre-post markets can coexist.
		uniqueIndex('pm_markets_thread_uq').on(t.discordThreadId),
		// Partial index over the settlement self-heal work-list: only terminal markets whose
		// notification never completed. Keeps the reconcile scan O(pending failures), not
		// O(all resolved markets ever) as terminal markets accumulate.
		index('pm_markets_settle_unannounced_idx')
			.on(t.updatedAt)
			.where(sql`${t.settlementAnnouncedAt} is null and ${t.status} in ('resolved', 'voided')`),
	]
)

export const pmMarketOutcomes = pgTable(
	'pm_market_outcomes',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		marketId: uuid('market_id').notNull(),
		label: text('label').notNull(),
		poolAmount: numeric('pool_amount').notNull().default('0'),
		sortOrder: integer('sort_order').notNull().default(0),
	},
	(t) => [
		uniqueIndex('pm_market_outcomes_market_label_uq').on(t.marketId, t.label),
		index('pm_market_outcomes_market_idx').on(t.marketId),
	]
)

/**
 * Per-user fixed-window rate limit counters (one row per user+command). Written by an
 * atomic committed upsert inside the money DO — the single Postgres row serializes
 * concurrent bets by the same user (DO input gates open across Neon awaits, so a DO-storage
 * counter would race). A rejected bet still consumes budget (anti-spam).
 */
export const pmRateLimits = pgTable(
	'pm_rate_limits',
	{
		userId: uuid('user_id').notNull(),
		command: text('command').notNull(),
		windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
		count: integer('count').notNull().default(0),
	},
	(t) => [primaryKey({ columns: [t.userId, t.command] })]
)

export const pmBets = pgTable(
	'pm_bets',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		marketId: uuid('market_id').notNull(),
		outcomeId: uuid('outcome_id').notNull(),
		userId: uuid('user_id').notNull(),
		amount: numeric('amount').notNull(),
		status: pmBetStatus('status').notNull().default('active'),
		payoutAmount: numeric('payout_amount'),
		/** Idempotency key (Discord interaction id for bot bets). */
		idempotencyKey: text('idempotency_key').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex('pm_bets_idempotency_key_uq').on(t.idempotencyKey),
		index('pm_bets_market_user_idx').on(t.marketId, t.userId),
		index('pm_bets_user_created_idx').on(t.userId, t.createdAt),
		index('pm_bets_market_outcome_idx').on(t.marketId, t.outcomeId),
	]
)

export const pmResolutionProposals = pgTable(
	'pm_resolution_proposals',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		marketId: uuid('market_id').notNull(),
		/** Proposed winning outcome, or NULL for a proposed void. */
		outcomeId: uuid('outcome_id'),
		proposedBy: uuid('proposed_by').notNull(),
		approvedBy: uuid('approved_by'),
		status: pmProposalStatus('status').notNull().default('pending'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		resolvedAt: timestamp('resolved_at', { withTimezone: true }),
	},
	(t) => [index('pm_resolution_proposals_market_status_idx').on(t.marketId, t.status)]
)

/** Immutable audit trail. Every market mutation writes exactly one row here. */
export const pmMarketHistory = pgTable(
	'pm_market_history',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		marketId: uuid('market_id').notNull(),
		actorUserId: uuid('actor_user_id'),
		action: text('action').notNull(),
		previousStatus: pmMarketStatus('previous_status'),
		newStatus: pmMarketStatus('new_status'),
		visibility: pmVisibility('visibility').notNull().default('public'),
		metadata: jsonb('metadata'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index('pm_market_history_market_created_idx').on(t.marketId, t.createdAt),
		// Global admin market-lifecycle audit feed: ORDER BY created_at DESC, id DESC.
		index('pm_market_history_created_id_idx').on(t.createdAt, t.id),
	]
)

/** Single-active-config for defaults. */
export const pmConfig = pgTable('pm_config', {
	id: uuid('id').primaryKey().defaultRandom(),
	isActive: boolean('is_active').notNull().default(true),
	defaultRakeBps: integer('default_rake_bps').notNull().default(100),
	defaultMinStake: numeric('default_min_stake').notNull().default('1'),
	/** Markets with total_pool ≥ this require two-of-N settlement. NULL disables. */
	twoOfNThreshold: numeric('two_of_n_threshold'),
	effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
	effectiveTo: timestamp('effective_to', { withTimezone: true }),
})

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type PmWallet = typeof pmWallets.$inferSelect
export type PmLedgerRow = typeof pmLedger.$inferSelect
export type NewPmLedgerRow = typeof pmLedger.$inferInsert
export type PmMarket = typeof pmMarkets.$inferSelect
export type PmMarketOutcome = typeof pmMarketOutcomes.$inferSelect
export type PmBet = typeof pmBets.$inferSelect
export type PmResolutionProposal = typeof pmResolutionProposals.$inferSelect
export type PmMarketHistoryRow = typeof pmMarketHistory.$inferSelect
export type PmConfig = typeof pmConfig.$inferSelect
