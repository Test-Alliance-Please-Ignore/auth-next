import { beforeEach, describe, expect, it, vi } from 'vitest'

import { executeDiscordModalSubmit } from '../discord-components.service'

// Verifies Core threads the site-admin `adminOverride` capability into voidMarket: a plain resolver
// and a (non-admin) manager pass adminOverride:false — they stay bound by the void conflict-of-interest
// guards — while an is_admin voider passes adminOverride:true, letting them void ANY market (including
// one they created or bet on). bypassDesignated (admin OR manager) is threaded independently.

const hoisted = vi.hoisted(() => ({
	predictionBinding: {} as DurableObjectNamespace,
	prediction: {
		voidMarket: vi.fn().mockResolvedValue(undefined),
		// getMarket → null so refreshPost / announceSettlement are no-ops (no post/notify service runs).
		getMarket: vi.fn().mockResolvedValue(null),
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
	customIdAction: () => 'voidmodal',
	decodeSingleMarketId: () => 'm1',
	VOID_REASON_INPUT_ID: 'reason',
}))
// Downstream post/notify services aren't reached (getMarket→null), but mock them so the module under
// test loads without pulling their transitive deps.
vi.mock('../discord-market-post.service', () => ({
	updateMarketPostFromDetail: vi.fn(),
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
	customId: 'voidmodal:m1',
	discordUserId: 'd1',
	fields: { reason: 'settling manually' },
	interactionId: 'i1',
} as any

function mockTiers(isAdmin: boolean, manager: boolean) {
	hoisted.findFirst.mockResolvedValue({ id: 'u1', is_admin: isAdmin })
	// requireResolver checks 'resolver'; canBypassDesignated checks 'manager'.
	hoisted.hasMarketPermission.mockImplementation((_e: unknown, _u: unknown, tier: string) =>
		Promise.resolve(tier === 'manager' ? manager : true)
	)
}

describe('executeDiscordModalSubmit — adminOverride threading (void)', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		hoisted.prediction.getMarket.mockResolvedValue(null)
	})

	it('a plain resolver passes adminOverride:false and bypassDesignated:false', async () => {
		mockTiers(false, false)
		await executeDiscordModalSubmit(db, env, input)
		expect(hoisted.prediction.voidMarket).toHaveBeenCalledWith(
			expect.objectContaining({
				actorUserId: 'u1',
				marketId: 'm1',
				reason: 'settling manually',
				bypassDesignated: false,
				adminOverride: false,
			})
		)
	})

	it('a non-admin manager passes adminOverride:false but bypassDesignated:true', async () => {
		mockTiers(false, true)
		await executeDiscordModalSubmit(db, env, input)
		expect(hoisted.prediction.voidMarket).toHaveBeenCalledWith(
			expect.objectContaining({ bypassDesignated: true, adminOverride: false })
		)
	})

	it('an admin passes adminOverride:true (and bypassDesignated:true)', async () => {
		mockTiers(true, false)
		await executeDiscordModalSubmit(db, env, input)
		expect(hoisted.prediction.voidMarket).toHaveBeenCalledWith(
			expect.objectContaining({ bypassDesignated: true, adminOverride: true })
		)
	})
})
