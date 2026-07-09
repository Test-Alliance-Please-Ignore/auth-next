import { beforeEach, describe, expect, it, vi } from 'vitest'

import { executeDiscordModalSubmit } from '../discord-components.service'

// Verifies Core threads the site-admin `adminOverride` capability into proposeResolution: a plain
// resolver and a (non-admin) manager pass adminOverride:false — they stay bound by the resolve
// conflict-of-interest guards (creator ≠ resolver, no-position) AND the two-of-N second-signer rule —
// while an is_admin resolver passes adminOverride:true, letting them settle ANY market in one step
// (including one they created or bet on). bypassDesignated (admin OR manager) is threaded independently.

const hoisted = vi.hoisted(() => ({
	predictionBinding: {} as DurableObjectNamespace,
	prediction: {
		// A market with two outcomes so handleResolveModal reaches proposeResolution.
		getMarket: vi.fn().mockResolvedValue({
			id: 'm1',
			outcomes: [
				{ id: 'o1', label: 'A' },
				{ id: 'o2', label: 'B' },
			],
		}),
		// 'resolving' (non-terminal) ⇒ announceSettlement is skipped.
		proposeResolution: vi
			.fn()
			.mockResolvedValue({ marketId: 'm1', status: 'resolving', resolvedOutcomeId: null }),
	},
	hasMarketPermission: vi.fn(),
	findFirst: vi.fn(),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn((binding: DurableObjectNamespace) =>
		binding === hoisted.predictionBinding ? hoisted.prediction : {}
	),
}))
vi.mock('../../lib/market-permissions', () => ({
	hasMarketPermission: hoisted.hasMarketPermission,
}))
vi.mock('../../lib/market-custom-id', () => ({
	customIdAction: () => 'resolvemodal',
	decodeSingleMarketId: () => 'm1',
	RESOLVE_OUTCOME_INPUT_ID: 'outcome',
}))
// Downstream post/notify services aren't meaningfully reached; mock them so the module under test
// loads without pulling their transitive deps. updateMarketPostFromDetail → { success: false } so the
// refreshPost path never calls applyMarketPostStatus.
vi.mock('../discord-market-post.service', () => ({
	updateMarketPostFromDetail: vi.fn().mockResolvedValue({ success: false }),
	applyMarketPostStatus: vi.fn(),
	announceBetPlaced: vi.fn(),
}))
vi.mock('../discord-market-notify.service', () => ({
	announceMarketClosed: vi.fn(),
	announceMarketResolved: vi.fn(),
	dmWagerResults: vi.fn(),
}))

const db = { query: { users: { findFirst: hoisted.findFirst } } } as any
const env = {
	PREDICTION_MARKETS: hoisted.predictionBinding,
	DISCORD: {},
	GROUPS: {},
	PM_FORUM_GUILD_ID: 'g1',
} as any
const input = {
	customId: 'resolvemodal:m1',
	discordUserId: 'd1',
	fields: { outcome: '1' },
	interactionId: 'i1',
} as any

function mockTiers(isAdmin: boolean, manager: boolean) {
	hoisted.findFirst.mockResolvedValue({ id: 'u1', is_admin: isAdmin })
	// requireResolver checks 'resolver'; canBypassDesignated checks 'manager'.
	hoisted.hasMarketPermission.mockImplementation((_e: unknown, _u: unknown, tier: string) =>
		Promise.resolve(tier === 'manager' ? manager : true)
	)
}

describe('executeDiscordModalSubmit — adminOverride threading (resolve)', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		hoisted.prediction.getMarket.mockResolvedValue({
			id: 'm1',
			outcomes: [
				{ id: 'o1', label: 'A' },
				{ id: 'o2', label: 'B' },
			],
		})
		hoisted.prediction.proposeResolution.mockResolvedValue({
			marketId: 'm1',
			status: 'resolving',
			resolvedOutcomeId: null,
		})
	})

	it('a plain resolver passes adminOverride:false and bypassDesignated:false', async () => {
		mockTiers(false, false)
		await executeDiscordModalSubmit(db, env, input)
		expect(hoisted.prediction.proposeResolution).toHaveBeenCalledWith(
			expect.objectContaining({
				resolverId: 'u1',
				marketId: 'm1',
				outcomeId: 'o1',
				bypassDesignated: false,
				adminOverride: false,
			})
		)
	})

	it('a non-admin manager passes adminOverride:false but bypassDesignated:true', async () => {
		mockTiers(false, true)
		await executeDiscordModalSubmit(db, env, input)
		expect(hoisted.prediction.proposeResolution).toHaveBeenCalledWith(
			expect.objectContaining({ bypassDesignated: true, adminOverride: false })
		)
	})

	it('an admin passes adminOverride:true (and bypassDesignated:true)', async () => {
		mockTiers(true, false)
		await executeDiscordModalSubmit(db, env, input)
		expect(hoisted.prediction.proposeResolution).toHaveBeenCalledWith(
			expect.objectContaining({ bypassDesignated: true, adminOverride: true })
		)
	})
})
