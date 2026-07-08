import { beforeEach, describe, expect, it, vi } from 'vitest'

import { updateAndAnnounceMarket } from '../market-update.service'

import type { UpdateMarketEnv } from '../market-update.service'
import type { MarketDetail } from '@repo/prediction-markets'

const hoisted = vi.hoisted(() => ({
	predictionBinding: {} as DurableObjectNamespace,
	discordBinding: {} as DurableObjectNamespace,
	prediction: { updateMarket: vi.fn() },
	post: { updateMarketPostFromDetail: vi.fn() },
	notify: { announceMarketUpdated: vi.fn() },
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn((binding: DurableObjectNamespace) =>
		binding === hoisted.predictionBinding ? hoisted.prediction : {}
	),
}))
vi.mock('../discord-market-post.service', () => ({
	updateMarketPostFromDetail: hoisted.post.updateMarketPostFromDetail,
}))
vi.mock('../discord-market-notify.service', () => ({
	announceMarketUpdated: hoisted.notify.announceMarketUpdated,
}))

const db = {} as unknown as Parameters<typeof updateAndAnnounceMarket>[0]
const env = {
	PREDICTION_MARKETS: hoisted.predictionBinding,
	DISCORD: hoisted.discordBinding,
	PM_FORUM_GUILD_ID: 'g1',
} as unknown as UpdateMarketEnv

function market(overrides: Partial<MarketDetail> = {}): MarketDetail {
	return {
		id: 'm1',
		question: 'Q1',
		status: 'open',
		closesAt: '2030-01-01T00:00:00.000Z',
		totalPool: '0',
		outcomeCount: 2,
		createdAt: '2026-01-01T00:00:00.000Z',
		discordThreadId: 'thread1',
		discordMessageId: 'msg1',
		description: 'D',
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
		outcomes: [],
		...overrides,
	}
}

const NO_CHANGE = { closesAt: false, question: false, description: false }

describe('updateAndAnnounceMarket', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		hoisted.post.updateMarketPostFromDetail.mockResolvedValue({ success: true })
		hoisted.notify.announceMarketUpdated.mockResolvedValue(undefined)
	})

	it('passes the actor to updateMarket and refreshes + announces the changed fields', async () => {
		hoisted.prediction.updateMarket.mockResolvedValue({
			market: market({ closesAt: '2031-01-01T00:00:00.000Z' }),
			changed: { ...NO_CHANGE, closesAt: true },
		})

		const res = await updateAndAnnounceMarket(db, env, 'admin-1', 'm1', {
			closesAt: '2031-01-01T00:00:00.000Z',
		})

		expect(hoisted.prediction.updateMarket).toHaveBeenCalledWith('m1', 'admin-1', {
			closesAt: '2031-01-01T00:00:00.000Z',
		})
		expect(res.market.closesAt).toBe('2031-01-01T00:00:00.000Z')
		expect(hoisted.post.updateMarketPostFromDetail).toHaveBeenCalledTimes(1)
		expect(hoisted.notify.announceMarketUpdated).toHaveBeenCalledWith(expect.anything(), 'g1', expect.anything(), {
			closesAt: '2031-01-01T00:00:00.000Z',
			question: false,
			description: false,
		})
	})

	it('announces question + description (not closesAt) when only those changed', async () => {
		hoisted.prediction.updateMarket.mockResolvedValue({
			market: market({ question: 'Q2', description: null }),
			changed: { closesAt: false, question: true, description: true },
		})

		await updateAndAnnounceMarket(db, env, 'admin-1', 'm1', { question: 'Q2', description: null })

		expect(hoisted.notify.announceMarketUpdated).toHaveBeenCalledWith(expect.anything(), 'g1', expect.anything(), {
			closesAt: undefined,
			question: true,
			description: true,
		})
	})

	it('propagates MARKET_NOT_FOUND from updateMarket', async () => {
		hoisted.prediction.updateMarket.mockRejectedValue(new Error('MARKET_NOT_FOUND'))
		await expect(
			updateAndAnnounceMarket(db, env, 'admin-1', 'x', { question: 'new' })
		).rejects.toThrow('MARKET_NOT_FOUND')
	})

	it('does not fail the edit when the Discord side effects throw', async () => {
		hoisted.prediction.updateMarket.mockResolvedValue({
			market: market({ question: 'Q2' }),
			changed: { ...NO_CHANGE, question: true },
		})
		hoisted.post.updateMarketPostFromDetail.mockRejectedValue(new Error('discord down'))

		const res = await updateAndAnnounceMarket(db, env, 'admin-1', 'm1', { question: 'Q2' })
		expect(res.market.question).toBe('Q2') // the committed edit is still returned
	})
})
