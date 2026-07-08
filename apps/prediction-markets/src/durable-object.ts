import { DurableObject } from 'cloudflare:workers'

import { createDb } from './db'
import * as betting from './services/betting-service'
import * as governance from './services/governance-service'
import * as market from './services/market-service'
import * as reads from './services/read-service'
import * as settlement from './services/settlement-service'
import * as wallet from './services/wallet-service'

import type {
	BetResult,
	BetView,
	CreateMarketInput,
	DetailedBetView,
	GlobalLedgerOpts,
	GlobalLedgerRow,
	GrantPointsInput,
	LeaderboardRow,
	LedgerRow,
	ListMarketsFilter,
	ListWalletsOpts,
	MarketDetail,
	MarketHistoryOpts,
	MarketHistoryRow,
	MarketSettlement,
	MarketSummary,
	MarketUpdateResult,
	Paged,
	PendingProposalView,
	PlaceBetInput,
	PmConfigView,
	PredictionMarkets,
	ResolveResult,
	ThresholdImpact,
	UpdateConfigInput,
	UpdateMarketInput,
	WalletRow,
} from '@repo/prediction-markets'
import type { Env } from './context'
import type { PmDeps } from './services/context'

/**
 * Prediction Markets Durable Object.
 *
 * A single ('default') instance holds the Neon WebSocket pool (built once in the
 * constructor) and serves all reads + writes. Postgres row locks (`FOR UPDATE`) and
 * atomic guarded updates provide correctness; the DO's single-threaded execution is a
 * backstop. Money is `numeric` in the DB (strings in JS) and computed with BigInt.
 *
 * Per CLAUDE.md: this DO never derives entity ids from `state.id` — every method takes
 * ids as parameters and every query is WHERE-filtered by them.
 *
 * This class is a thin facade: every RPC method delegates to a standalone service
 * function (in `./services/*`), passing the shared `PmDeps` (the Neon/Drizzle client).
 */
export class PredictionMarketsDO extends DurableObject<Env> implements PredictionMarkets {
	private deps: PmDeps

	constructor(state: DurableObjectState, env: Env) {
		super(state, env)
		this.deps = { db: createDb(env.DATABASE_URL) }
	}

	// =====================================================================
	// Reads
	// =====================================================================

	async getWalletBalance(userId: string): Promise<{ balance: string }> {
		return reads.getWalletBalance(this.deps, userId)
	}

	async listMarkets(filter?: ListMarketsFilter): Promise<MarketSummary[]> {
		return reads.listMarkets(this.deps, filter)
	}

	async getMarket(marketId: string): Promise<MarketDetail | null> {
		return reads.getMarket(this.deps, marketId)
	}

	async getUserBets(
		userId: string,
		opts?: { marketId?: string; activeOnly?: boolean }
	): Promise<BetView[]> {
		return reads.getUserBets(this.deps, userId, opts)
	}

	async getUserBetsDetailed(
		userId: string,
		opts?: { activeOnly?: boolean }
	): Promise<DetailedBetView[]> {
		return reads.getUserBetsDetailed(this.deps, userId, opts)
	}

	async getMarketSettlement(marketId: string): Promise<MarketSettlement | null> {
		return reads.getMarketSettlement(this.deps, marketId)
	}

	async getLeaderboard(opts?: {
		window?: 'all' | '30d'
		limit?: number
	}): Promise<LeaderboardRow[]> {
		return reads.getLeaderboard(this.deps, opts)
	}

	async getLedger(
		userId: string,
		opts?: { limit?: number; cursor?: string }
	): Promise<LedgerRow[]> {
		return reads.getLedger(this.deps, userId, opts)
	}

	async listWallets(opts?: ListWalletsOpts): Promise<Paged<WalletRow>> {
		return reads.listWallets(this.deps, opts)
	}

	async getGlobalLedger(opts?: GlobalLedgerOpts): Promise<Paged<GlobalLedgerRow>> {
		return reads.getGlobalLedger(this.deps, opts)
	}

	async getGlobalMarketHistory(opts?: MarketHistoryOpts): Promise<Paged<MarketHistoryRow>> {
		return reads.getGlobalMarketHistory(this.deps, opts)
	}

	async getMarketHistory(
		marketId: string,
		opts?: { includeInternal?: boolean; limit?: number; offset?: number }
	): Promise<Paged<MarketHistoryRow>> {
		return reads.getMarketHistory(this.deps, marketId, opts)
	}

	// =====================================================================
	// Writes
	// =====================================================================

	async grantPoints(input: GrantPointsInput): Promise<{ balance: string; deduped: boolean }> {
		return wallet.grantPoints(this.deps, input)
	}

	async onboardUser(
		userId: string
	): Promise<{ balance: string; granted: string; alreadyOnboarded: boolean }> {
		return wallet.onboardUser(this.deps, userId)
	}

	async createMarket(input: CreateMarketInput): Promise<MarketDetail> {
		return market.createMarket(this.deps, input)
	}

	async updateMarket(
		marketId: string,
		actorUserId: string,
		updates: UpdateMarketInput
	): Promise<MarketUpdateResult> {
		return market.updateMarket(this.deps, marketId, actorUserId, updates)
	}

	async attachDiscordPost(input: {
		marketId: string
		threadId: string
		messageId: string
	}): Promise<void> {
		return market.attachDiscordPost(this.deps, input)
	}

	async placeBet(input: PlaceBetInput): Promise<BetResult & { deduped: boolean }> {
		return betting.placeBet(this.deps, input)
	}

	async closeMarket(input: { actorUserId: string; marketId: string }): Promise<void> {
		return market.closeMarket(this.deps, input)
	}

	async closeDueMarkets(limit = 25): Promise<{ closedMarketIds: string[] }> {
		return market.closeDueMarkets(this.deps, limit)
	}

	async listMarketsNeedingPost(limit = 25, minAgeMinutes = 2): Promise<MarketDetail[]> {
		return market.listMarketsNeedingPost(this.deps, limit, minAgeMinutes)
	}

	async listMarketsToRefresh(sinceMinutes = 15, limit = 25): Promise<string[]> {
		return market.listMarketsToRefresh(this.deps, sinceMinutes, limit)
	}

	async listMarketsNeedingSettlementNotice(
		limit = 25,
		minAgeMinutes = 15,
		maxAgeMinutes = 360
	): Promise<MarketDetail[]> {
		return market.listMarketsNeedingSettlementNotice(this.deps, limit, minAgeMinutes, maxAgeMinutes)
	}

	async markSettlementAnnounced(marketId: string): Promise<void> {
		return market.markSettlementAnnounced(this.deps, marketId)
	}

	async proposeResolution(input: {
		resolverId: string
		marketId: string
		outcomeId: string
		bypassDesignated?: boolean
	}): Promise<ResolveResult> {
		return settlement.proposeResolution(this.deps, input)
	}

	async approveResolution(input: {
		resolverId: string
		marketId: string
		proposalId: string
		bypassDesignated?: boolean
	}): Promise<ResolveResult> {
		return settlement.approveResolution(this.deps, input)
	}

	async voidMarket(input: {
		actorUserId: string
		marketId: string
		reason: string
		approverId?: string
		bypassDesignated?: boolean
		adminOverride?: boolean
	}): Promise<void> {
		return settlement.voidMarket(this.deps, input)
	}

	async getPendingProposal(marketId: string): Promise<PendingProposalView | null> {
		return settlement.getPendingProposal(this.deps, marketId)
	}

	async getConfig(): Promise<PmConfigView> {
		return governance.getConfig(this.deps)
	}

	async previewTwoOfNThreshold(candidateThreshold: string | null): Promise<ThresholdImpact> {
		return governance.previewTwoOfNThreshold(this.deps, candidateThreshold)
	}

	async updateConfig(input: UpdateConfigInput): Promise<PmConfigView> {
		return governance.updateConfig(this.deps, input)
	}
}
