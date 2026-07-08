import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reconcileMarketPosts } from '../discord-market-reconcile.service'

import type { ReconcileEnv } from '../discord-market-reconcile.service'
import type { MarketDetail, MarketSettlement } from '@repo/prediction-markets'

const hoisted = vi.hoisted(() => ({
	predictionBinding: {} as DurableObjectNamespace,
	discordBinding: {} as DurableObjectNamespace,
	prediction: {
		closeDueMarkets: vi.fn(),
		listMarketsToRefresh: vi.fn(),
		getMarket: vi.fn(),
		listMarketsNeedingPost: vi.fn(),
		listMarketsNeedingSettlementNotice: vi.fn(),
		getMarketSettlement: vi.fn(),
		markSettlementAnnounced: vi.fn(),
	},
	post: {
		updateMarketPostFromDetail: vi.fn(),
		applyMarketPostStatus: vi.fn(),
		publishMarketPost: vi.fn(),
	},
	notify: {
		announceMarketClosed: vi.fn(),
		announceMarketResolved: vi.fn(),
		dmWagerResults: vi.fn(),
	},
}))

// getStub returns the PM stub for the PREDICTION_MARKETS binding; the Discord stub is an opaque
// object the (mocked) post-service functions ignore.
vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn((binding: DurableObjectNamespace) =>
		binding === hoisted.predictionBinding ? hoisted.prediction : {}
	),
}))

vi.mock('../discord-market-post.service', () => ({
	updateMarketPostFromDetail: hoisted.post.updateMarketPostFromDetail,
	applyMarketPostStatus: hoisted.post.applyMarketPostStatus,
	publishMarketPost: hoisted.post.publishMarketPost,
}))

vi.mock('../discord-market-notify.service', () => ({
	announceMarketClosed: hoisted.notify.announceMarketClosed,
	announceMarketResolved: hoisted.notify.announceMarketResolved,
	dmWagerResults: hoisted.notify.dmWagerResults,
}))

const db = {} as unknown as Parameters<typeof reconcileMarketPosts>[0]

function makeEnv(overrides?: Partial<ReconcileEnv>): ReconcileEnv {
	return {
		PREDICTION_MARKETS: hoisted.predictionBinding,
		DISCORD: hoisted.discordBinding,
		PM_FORUM_GUILD_ID: 'g1',
		PM_FORUM_CATEGORY_ID: 'c1',
		...overrides,
	} as ReconcileEnv
}

function market(id: string, status: MarketDetail['status'] = 'closed'): MarketDetail {
	return {
		id,
		question: 'Q',
		status,
		closesAt: '2020-01-01T00:00:00.000Z',
		totalPool: '0',
		outcomeCount: 2,
		createdAt: '2020-01-01T00:00:00.000Z',
		discordThreadId: 't',
		discordMessageId: 'm',
		description: null,
		createdBy: 'u',
		rakeBps: 0,
		minStake: '1',
		maxStake: null,
		perUserCap: null,
		twoOfN: false,
		resolvedOutcomeId: null,
		resolvedBy: null,
		resolvedAt: null,
		voidReason: null,
		designatedResolverIds: null,
		outcomes: [],
	}
}

function settlement(marketId: string): MarketSettlement {
	return {
		marketId,
		status: 'resolved',
		resolvedOutcomeId: 'o1',
		totalStaked: '100',
		totalPaidOut: '90',
		totalLost: '10',
		users: [{ userId: 'u1', staked: '10', returned: '18', net: '8' }],
	}
}

describe('reconcileMarketPosts', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		hoisted.prediction.closeDueMarkets.mockResolvedValue({ closedMarketIds: [] })
		hoisted.prediction.listMarketsToRefresh.mockResolvedValue([])
		hoisted.prediction.getMarket.mockImplementation((id: string) => Promise.resolve(market(id)))
		hoisted.prediction.listMarketsNeedingPost.mockResolvedValue([])
		hoisted.prediction.listMarketsNeedingSettlementNotice.mockResolvedValue([])
		hoisted.prediction.getMarketSettlement.mockImplementation((id: string) =>
			Promise.resolve(settlement(id))
		)
		hoisted.prediction.markSettlementAnnounced.mockResolvedValue(undefined)
		hoisted.post.updateMarketPostFromDetail.mockResolvedValue({ success: true })
		hoisted.post.applyMarketPostStatus.mockResolvedValue(undefined)
		hoisted.post.publishMarketPost.mockResolvedValue({ threadId: 't', messageId: 'm' })
		hoisted.notify.announceMarketClosed.mockResolvedValue(undefined)
		// announceMarketResolved returns whether the thread post landed; default = posted.
		hoisted.notify.announceMarketResolved.mockResolvedValue(true)
		hoisted.notify.dmWagerResults.mockResolvedValue(undefined)
	})

	it('no-ops when the forum guild/category is not configured', async () => {
		const res = await reconcileMarketPosts(db, makeEnv({ PM_FORUM_GUILD_ID: undefined }))
		expect(res).toEqual({ closed: 0, refreshed: 0, posted: 0, notified: 0, failed: 0, skipped: true })
		expect(hoisted.prediction.closeDueMarkets).not.toHaveBeenCalled()
		expect(hoisted.prediction.listMarketsToRefresh).not.toHaveBeenCalled()
		expect(hoisted.prediction.listMarketsNeedingPost).not.toHaveBeenCalled()
		expect(hoisted.prediction.listMarketsNeedingSettlementNotice).not.toHaveBeenCalled()
	})

	it('auto-closes markets and announces each close to its thread', async () => {
		hoisted.prediction.closeDueMarkets.mockResolvedValue({ closedMarketIds: ['a', 'b', 'c'] })
		const res = await reconcileMarketPosts(db, makeEnv())
		expect(res.closed).toBe(3)
		// Auto-close is bounded to keep the run inside the cron budget.
		expect(hoisted.prediction.closeDueMarkets).toHaveBeenCalledWith(expect.any(Number))
		// Each just-closed market gets a "betting closed" post (once per market).
		expect(hoisted.notify.announceMarketClosed).toHaveBeenCalledTimes(3)
	})

	it('refreshes each drifted post (embed + tag/lock) from the self-healing refresh list', async () => {
		hoisted.prediction.listMarketsToRefresh.mockResolvedValue(['a', 'b'])
		const res = await reconcileMarketPosts(db, makeEnv())
		expect(res.refreshed).toBe(2)
		expect(hoisted.post.updateMarketPostFromDetail).toHaveBeenCalledTimes(2)
		expect(hoisted.post.applyMarketPostStatus).toHaveBeenCalledTimes(2)
	})

	it('re-reads state and skips a market that went terminal mid-sweep (no clobber)', async () => {
		hoisted.prediction.listMarketsToRefresh.mockResolvedValue(['a'])
		// Snapshot said "changed recently", but it resolved before we got to it — leave it alone.
		hoisted.prediction.getMarket.mockResolvedValue(market('a', 'resolved'))
		const res = await reconcileMarketPosts(db, makeEnv())
		expect(res.refreshed).toBe(0)
		expect(res.failed).toBe(0)
		expect(hoisted.post.updateMarketPostFromDetail).not.toHaveBeenCalled()
	})

	it('counts a soft refresh failure and skips the tag/lock step (retried next tick)', async () => {
		hoisted.prediction.listMarketsToRefresh.mockResolvedValue(['a'])
		hoisted.post.updateMarketPostFromDetail.mockResolvedValue({ success: false, error: 'no post' })
		const res = await reconcileMarketPosts(db, makeEnv())
		expect(res.failed).toBe(1)
		expect(res.refreshed).toBe(0)
		expect(hoisted.post.applyMarketPostStatus).not.toHaveBeenCalled()
	})

	it('isolates a throwing refresh and still processes the rest', async () => {
		hoisted.prediction.listMarketsToRefresh.mockResolvedValue(['a', 'b'])
		hoisted.post.updateMarketPostFromDetail
			.mockRejectedValueOnce(new Error('discord 500'))
			.mockResolvedValueOnce({ success: true })
		const res = await reconcileMarketPosts(db, makeEnv())
		expect(res.failed).toBe(1)
		expect(res.refreshed).toBe(1)
	})

	it('backfills posts for non-terminal markets missing one', async () => {
		hoisted.prediction.listMarketsNeedingPost.mockResolvedValue([market('x'), market('y')])
		const res = await reconcileMarketPosts(db, makeEnv())
		expect(res.posted).toBe(2)
		expect(hoisted.post.publishMarketPost).toHaveBeenCalledTimes(2)
	})

	it('isolates a failing backfill and still processes the rest', async () => {
		hoisted.prediction.listMarketsNeedingPost.mockResolvedValue([market('x'), market('y')])
		hoisted.post.publishMarketPost
			.mockRejectedValueOnce(new Error('discord 500'))
			.mockResolvedValueOnce({ threadId: 't', messageId: 'm' })
		const res = await reconcileMarketPosts(db, makeEnv())
		expect(res.failed).toBe(1)
		expect(res.posted).toBe(1)
		expect(hoisted.post.publishMarketPost).toHaveBeenCalledTimes(2)
	})

	it('re-sends the settlement notification for terminal markets that never completed it', async () => {
		hoisted.prediction.listMarketsNeedingSettlementNotice.mockResolvedValue([
			market('a', 'resolved'),
			market('b', 'voided'),
		])
		const res = await reconcileMarketPosts(db, makeEnv())
		expect(res.notified).toBe(2)
		// grace + max-age window is passed through to the work-list query.
		expect(hoisted.prediction.listMarketsNeedingSettlementNotice).toHaveBeenCalledWith(
			expect.any(Number),
			expect.any(Number),
			expect.any(Number)
		)
		expect(hoisted.notify.announceMarketResolved).toHaveBeenCalledTimes(2)
		expect(hoisted.notify.dmWagerResults).toHaveBeenCalledTimes(2)
		// Only marked announced AFTER the post + DM fan-out both ran.
		expect(hoisted.prediction.markSettlementAnnounced).toHaveBeenCalledTimes(2)
	})

	it('marks a terminal market announced without sending when its settlement data is missing', async () => {
		hoisted.prediction.listMarketsNeedingSettlementNotice.mockResolvedValue([
			market('a', 'resolved'),
		])
		hoisted.prediction.getMarketSettlement.mockResolvedValue(null)
		const res = await reconcileMarketPosts(db, makeEnv())
		expect(res.notified).toBe(0)
		expect(hoisted.notify.announceMarketResolved).not.toHaveBeenCalled()
		expect(hoisted.notify.dmWagerResults).not.toHaveBeenCalled()
		// Still flagged so the work-list stops re-selecting it every tick.
		expect(hoisted.prediction.markSettlementAnnounced).toHaveBeenCalledWith('a')
	})

	it('leaves the market un-announced and skips DMs when the thread post soft-fails (retried next tick)', async () => {
		hoisted.prediction.listMarketsNeedingSettlementNotice.mockResolvedValue([market('a', 'resolved')])
		hoisted.notify.announceMarketResolved.mockResolvedValue(false)
		const res = await reconcileMarketPosts(db, makeEnv())
		expect(res.notified).toBe(0)
		expect(res.failed).toBe(1)
		// Not marked → a later tick retries (at-least-once). No DM spam against a market whose post failed.
		expect(hoisted.prediction.markSettlementAnnounced).not.toHaveBeenCalled()
		expect(hoisted.notify.dmWagerResults).not.toHaveBeenCalled()
	})

	it('marks BEFORE the DM fan-out and only after the post lands', async () => {
		const calls: string[] = []
		hoisted.prediction.listMarketsNeedingSettlementNotice.mockResolvedValue([market('a', 'resolved')])
		hoisted.notify.announceMarketResolved.mockImplementation(async () => {
			calls.push('post')
			return true
		})
		hoisted.prediction.markSettlementAnnounced.mockImplementation(async () => {
			calls.push('mark')
		})
		hoisted.notify.dmWagerResults.mockImplementation(async () => {
			calls.push('dm')
		})
		const res = await reconcileMarketPosts(db, makeEnv())
		expect(res.notified).toBe(1)
		// Post delivered → mark the flag → THEN best-effort DMs (so a DM failure can't un-mark/re-post).
		expect(calls).toEqual(['post', 'mark', 'dm'])
	})

	it('isolates a throwing settlement self-heal and does not mark that market announced', async () => {
		hoisted.prediction.listMarketsNeedingSettlementNotice.mockResolvedValue([
			market('a', 'resolved'),
			market('b', 'voided'),
		])
		// A thrown post (e.g. Discord DO unreachable) on the first market must isolate it, leave it NULL
		// for retry, and not block the second.
		hoisted.notify.announceMarketResolved
			.mockRejectedValueOnce(new Error('discord 500'))
			.mockResolvedValueOnce(true)
		const res = await reconcileMarketPosts(db, makeEnv())
		expect(res.failed).toBe(1)
		expect(res.notified).toBe(1)
		// The failed market is NOT marked, so a later tick retries it (self-heal).
		expect(hoisted.prediction.markSettlementAnnounced).toHaveBeenCalledTimes(1)
		expect(hoisted.prediction.markSettlementAnnounced).toHaveBeenCalledWith('b')
	})
})
