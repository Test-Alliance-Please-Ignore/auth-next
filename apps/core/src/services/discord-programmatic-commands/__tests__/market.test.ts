import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MARKET_PROGRAMMATIC_COMMAND } from '../market'

import type { ProgrammaticCommandContext, ProgrammaticCommandEnv } from '../types'

const hoisted = vi.hoisted(() => ({
	onboardUser: vi.fn(),
	getWalletBalance: vi.fn(),
	getUserBetsDetailed: vi.fn(),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(() => ({
		onboardUser: hoisted.onboardUser,
		getWalletBalance: hoisted.getWalletBalance,
		getUserBetsDetailed: hoisted.getUserBetsDetailed,
	})),
}))

const EPHEMERAL_FLAG = 1 << 6

function ctx(sub: string, coreUserId = 'u1'): ProgrammaticCommandContext {
	return {
		optionValues: {},
		coreUserId,
		isAdmin: false,
		env: { PREDICTION_MARKETS: {} } as unknown as ProgrammaticCommandEnv,
		input: { commandName: 'market', discordUserId: 'd1', options: [{ name: sub }] },
		interactionId: 'i1',
	}
}

describe('MARKET_PROGRAMMATIC_COMMAND', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('exposes the onboard subcommand and defers ephemerally', () => {
		expect(MARKET_PROGRAMMATIC_COMMAND.deferral).toBe('defer-ephemeral')
		const names = MARKET_PROGRAMMATIC_COMMAND.options?.map((o) => o.name)
		expect(names).toContain('onboard')
	})

	describe('onboard', () => {
		it('welcomes a fresh member with the deposited amount and new balance', async () => {
			hoisted.onboardUser.mockResolvedValue({
				balance: '50',
				granted: '50',
				alreadyOnboarded: false,
			})
			const res = await MARKET_PROGRAMMATIC_COMMAND.handler(ctx('onboard'))
			expect(hoisted.onboardUser).toHaveBeenCalledWith('u1')
			expect(res.data?.content).toContain('Welcome')
			expect(res.data?.content).toContain('50 points')
			// Self-only content must be ephemeral even on a sync fallback.
			expect(res.data?.flags).toBe(EPHEMERAL_FLAG)
		})

		it('tells an already-onboarded member their balance without re-granting', async () => {
			hoisted.onboardUser.mockResolvedValue({
				balance: '3',
				granted: '0',
				alreadyOnboarded: true,
			})
			const res = await MARKET_PROGRAMMATIC_COMMAND.handler(ctx('onboard'))
			expect(res.data?.content).toContain('already set up')
			expect(res.data?.content).toContain('3 points')
			expect(res.data?.content).not.toContain('Welcome')
		})
	})

	it('reports balance for the balance subcommand', async () => {
		hoisted.getWalletBalance.mockResolvedValue({ balance: '42' })
		const res = await MARKET_PROGRAMMATIC_COMMAND.handler(ctx('balance'))
		expect(res.data?.content).toContain('42 points')
		expect(hoisted.onboardUser).not.toHaveBeenCalled()
	})
})
