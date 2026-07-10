import { beforeEach, describe, expect, it, vi } from 'vitest'

import { executeDiscordComponent } from '../discord-components.service'

// Verifies Core threads the admin/manager `bypassDesignated` capability AND the is_admin-only
// `adminOverride` capability into the approveResolution RPC. bypassDesignated: a plain
// urn:markets:resolver passes false (narrowed to the market's designated set); an is_admin or
// urn:markets:manager holder passes true (retains "resolve any market"). adminOverride: only an
// is_admin passes true (may single-sign any pending proposal); resolvers and non-admin managers pass
// false (stay bound by every conflict-of-interest guard).

const hoisted = vi.hoisted(() => ({
	predictionBinding: {} as DurableObjectNamespace,
	prediction: {
		getPendingProposal: vi.fn(),
		approveResolution: vi.fn(),
		// getMarket → null so refreshPost is a no-op and no post/notify service is exercised.
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
	decodeMarketAction: () => ({ action: 'approve', marketId: 'm1' }),
}))
// Downstream post/notify services aren't reached (getMarket→null), but mock them so the module
// under test loads without pulling their transitive deps.
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
const input = { customId: 'approve:m1', discordUserId: 'd1' } as any

function mockTiers(isAdmin: boolean, manager: boolean) {
	hoisted.findFirst.mockResolvedValue({ id: 'u1', is_admin: isAdmin })
	// requireResolver checks 'resolver'; canBypassDesignated checks 'manager'.
	hoisted.hasMarketPermission.mockImplementation((_e, _u, tier: string) =>
		Promise.resolve(tier === 'manager' ? manager : true)
	)
}

describe('executeDiscordComponent — bypassDesignated + adminOverride threading (approve)', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		hoisted.prediction.getMarket.mockResolvedValue(null)
		hoisted.prediction.getPendingProposal.mockResolvedValue({ id: 'p1' })
		hoisted.prediction.approveResolution.mockResolvedValue({
			marketId: 'm1',
			status: 'resolving', // non-terminal → announceSettlement is skipped
			resolvedOutcomeId: null,
		})
	})

	it('a plain resolver passes bypassDesignated: false and adminOverride: false', async () => {
		mockTiers(false, false)
		await executeDiscordComponent(db, env, input)
		expect(hoisted.prediction.approveResolution).toHaveBeenCalledWith(
			expect.objectContaining({
				resolverId: 'u1',
				proposalId: 'p1',
				bypassDesignated: false,
				adminOverride: false,
			})
		)
	})

	it('a non-admin manager passes bypassDesignated: true but adminOverride: false', async () => {
		mockTiers(false, true)
		await executeDiscordComponent(db, env, input)
		expect(hoisted.prediction.approveResolution).toHaveBeenCalledWith(
			expect.objectContaining({ bypassDesignated: true, adminOverride: false })
		)
	})

	it('an admin passes bypassDesignated: true and adminOverride: true', async () => {
		mockTiers(true, false)
		await executeDiscordComponent(db, env, input)
		expect(hoisted.prediction.approveResolution).toHaveBeenCalledWith(
			expect.objectContaining({ bypassDesignated: true, adminOverride: true })
		)
	})
})
