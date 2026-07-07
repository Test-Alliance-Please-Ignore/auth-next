import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
	announceMarketClosed,
	announceMarketResolved,
	dmWagerResults,
} from '../discord-market-notify.service'

import type { Discord } from '@repo/discord'
import type { MarketDetail, MarketSettlement } from '@repo/prediction-markets'

const sendMessage = vi.fn()
const sendDirectMessage = vi.fn()
const discord = { sendMessage, sendDirectMessage } as unknown as Discord

function market(overrides: Partial<MarketDetail> = {}): MarketDetail {
	return {
		id: 'm1',
		question: 'Will it rain?',
		status: 'resolved',
		closesAt: '2030-01-01T00:00:00.000Z',
		totalPool: '0',
		outcomeCount: 2,
		createdAt: '2026-01-01T00:00:00.000Z',
		discordThreadId: 'thread1',
		discordMessageId: 'msg1',
		description: null,
		createdBy: 'creator',
		rakeBps: 0,
		minStake: '1',
		maxStake: null,
		perUserCap: null,
		twoOfN: false,
		resolvedOutcomeId: 'o1',
		resolvedBy: 'r',
		resolvedAt: '2026-01-02T00:00:00.000Z',
		voidReason: null,
		outcomes: [
			{ id: 'o1', label: 'Yes', poolAmount: '0', sortOrder: 0, impliedOddsBps: null },
			{ id: 'o2', label: 'No', poolAmount: '0', sortOrder: 1, impliedOddsBps: null },
		],
		...overrides,
	}
}

function settlement(overrides: Partial<MarketSettlement> = {}): MarketSettlement {
	return {
		marketId: 'm1',
		status: 'resolved',
		resolvedOutcomeId: 'o1',
		totalStaked: '3000',
		totalPaidOut: '1800',
		totalLost: '1000',
		users: [
			{ userId: 'winner', staked: '1000', returned: '1800', net: '800' },
			{ userId: 'loser', staked: '1000', returned: '0', net: '-1000' },
		],
		...overrides,
	}
}

describe('announceMarketClosed', () => {
	beforeEach(() => vi.clearAllMocks())

	it('posts the close notice to the thread', async () => {
		sendMessage.mockResolvedValue({ success: true })
		await announceMarketClosed(discord, 'g1', market({ status: 'closed' }))
		expect(sendMessage).toHaveBeenCalledTimes(1)
		const [, channelId, message] = sendMessage.mock.calls[0]
		expect(channelId).toBe('thread1')
		expect(message.content.toLowerCase()).toContain('closed')
	})

	it('no-ops when the market has no forum post', async () => {
		await announceMarketClosed(discord, 'g1', market({ discordThreadId: null }))
		expect(sendMessage).not.toHaveBeenCalled()
	})
})

describe('announceMarketResolved (thread post — aggregate only)', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		sendMessage.mockResolvedValue({ success: true })
	})

	it('posts the winning outcome + aggregate totals, and never DMs', async () => {
		await announceMarketResolved(discord, 'g1', market(), settlement())
		expect(sendMessage).toHaveBeenCalledTimes(1)
		const threadContent = sendMessage.mock.calls[0][2].content
		expect(threadContent).toContain('Yes')
		expect(threadContent).toContain('1,800 points')
		expect(threadContent).toContain('1,000 points')
		// Per-user results are private — the thread post must not fan out DMs.
		expect(sendDirectMessage).not.toHaveBeenCalled()
	})

	it('posts a void notice when the market voided', async () => {
		await announceMarketResolved(
			discord,
			'g1',
			market({ status: 'voided', resolvedOutcomeId: null }),
			settlement({ status: 'voided', resolvedOutcomeId: null, totalPaidOut: '3000', totalLost: '0' })
		)
		expect(sendMessage.mock.calls[0][2].content.toLowerCase()).toContain('voided')
	})

	it('no-ops when the market has no forum post', async () => {
		await announceMarketResolved(discord, 'g1', market({ discordThreadId: null }), settlement())
		expect(sendMessage).not.toHaveBeenCalled()
	})
})

describe('dmWagerResults (per-user private DMs)', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		sendDirectMessage.mockResolvedValue({ success: true })
	})

	it('DMs each participant their signed net result, by core user id', async () => {
		await dmWagerResults(discord, market(), settlement())
		expect(sendDirectMessage).toHaveBeenCalledTimes(2)
		expect(sendDirectMessage.mock.calls.map((c) => c[0])).toEqual(['winner', 'loser'])
		const winnerDm = sendDirectMessage.mock.calls.find((c) => c[0] === 'winner')?.[1].content
		expect(winnerDm).toContain('+800 points')
	})

	it('DMs everyone even if one DM fails (best-effort, isolated)', async () => {
		sendDirectMessage.mockRejectedValueOnce(new Error('user has DMs closed'))
		await dmWagerResults(discord, market(), settlement())
		expect(sendDirectMessage).toHaveBeenCalledTimes(2)
	})

	it('sends refund DMs on a void', async () => {
		await dmWagerResults(
			discord,
			market({ status: 'voided', resolvedOutcomeId: null }),
			settlement({
				status: 'voided',
				resolvedOutcomeId: null,
				users: [{ userId: 'u1', staked: '500', returned: '500', net: '0' }],
			})
		)
		expect(sendDirectMessage.mock.calls[0][1].content.toLowerCase()).toContain('voided')
	})
})
