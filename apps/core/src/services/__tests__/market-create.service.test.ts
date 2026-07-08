import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAndPublishMarket } from '../market-create.service'

import type { CreateMarketEnv } from '../market-create.service'

// Designated-resolver validation is where "designation NARROWS, never GRANTS" is enforced in Core
// (the DO can't read GROUPS). These tests exercise that gate through createAndPublishMarket.

const hoisted = vi.hoisted(() => ({
	predictionBinding: {} as DurableObjectNamespace,
	prediction: { createMarket: vi.fn() },
	hasMarketPermission: vi.fn(),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn((binding: DurableObjectNamespace) =>
		binding === hoisted.predictionBinding ? hoisted.prediction : {}
	),
}))
vi.mock('../../lib/market-permissions', () => ({
	hasMarketPermission: hoisted.hasMarketPermission,
}))
// Keep the DO the source of truth; publish is skipped by leaving forum config unset (postError path).

const CREATOR = 'creator-1'
const R1 = 'aaaaaaaa-1111-1111-1111-111111111111'
const R2 = 'bbbbbbbb-2222-2222-2222-222222222222'

// Minimal db whose select→from→where resolves to the given user rows. The service projects to
// { id, isAdmin }, so the mock rows use that shape (the mock ignores the projection args).
function makeDb(rows: Array<{ id: string; isAdmin: boolean }>) {
	return {
		select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
	} as unknown as Parameters<typeof createAndPublishMarket>[0]
}

// No forum config → publish is skipped (postError), so we don't need to mock the Discord post path.
const env = {
	PREDICTION_MARKETS: hoisted.predictionBinding,
	DISCORD: {},
	GROUPS: {},
} as CreateMarketEnv

const baseInput = {
	question: 'Will it rain tomorrow?',
	outcomes: ['Yes', 'No'],
	closesAt: new Date(Date.now() + 86_400_000).toISOString(),
}

describe('createAndPublishMarket — designated-resolver validation', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		hoisted.prediction.createMarket.mockResolvedValue({ id: 'm1' })
		hoisted.hasMarketPermission.mockResolvedValue(true)
	})

	it('forwards a valid designated set to the DO and tier-checks each designee with their own is_admin', async () => {
		const db = makeDb([
			{ id: R1, isAdmin: false },
			{ id: R2, isAdmin: true },
		])
		const res = await createAndPublishMarket(db, env, CREATOR, {
			...baseInput,
			designatedResolverIds: [R1, R2],
		})
		expect(res.market).toEqual({ id: 'm1' })
		expect(hoisted.prediction.createMarket).toHaveBeenCalledWith(
			expect.objectContaining({ createdBy: CREATOR, designatedResolverIds: [R1, R2] })
		)
		// Each designee validated for the resolver tier using THAT user's is_admin (not the creator's).
		expect(hoisted.hasMarketPermission).toHaveBeenCalledWith(env, R1, 'resolver', false)
		expect(hoisted.hasMarketPermission).toHaveBeenCalledWith(env, R2, 'resolver', true)
	})

	it('rejects designating the creator (CREATOR_IS_RESOLVER) and never creates', async () => {
		const db = makeDb([{ id: R1, isAdmin: false }])
		await expect(
			createAndPublishMarket(db, env, CREATOR, {
				...baseInput,
				designatedResolverIds: [CREATOR, R1],
			})
		).rejects.toThrow('CREATOR_IS_RESOLVER')
		expect(hoisted.prediction.createMarket).not.toHaveBeenCalled()
	})

	it('rejects an unknown user id with the same generic DESIGNATED_RESOLVER_INVALID (no existence oracle)', async () => {
		// R2 is absent from the users table → holds no permissions → fails the resolver-tier check via
		// the same path as an existing non-resolver (no distinct "not found" branch).
		const db = makeDb([{ id: R1, isAdmin: false }])
		hoisted.hasMarketPermission.mockImplementation((_e, id: string) => Promise.resolve(id === R1))
		await expect(
			createAndPublishMarket(db, env, CREATOR, {
				...baseInput,
				designatedResolverIds: [R1, R2],
			})
		).rejects.toThrow('DESIGNATED_RESOLVER_INVALID')
		expect(hoisted.prediction.createMarket).not.toHaveBeenCalled()
	})

	it('rejects a designee lacking the resolver tier with the same generic code', async () => {
		const db = makeDb([
			{ id: R1, isAdmin: false },
			{ id: R2, isAdmin: false },
		])
		hoisted.hasMarketPermission.mockImplementation((_e, id: string) => Promise.resolve(id === R1))
		await expect(
			createAndPublishMarket(db, env, CREATOR, {
				...baseInput,
				designatedResolverIds: [R1, R2],
			})
		).rejects.toThrow('DESIGNATED_RESOLVER_INVALID')
		expect(hoisted.prediction.createMarket).not.toHaveBeenCalled()
	})

	it('skips validation entirely when no set is designated', async () => {
		const db = makeDb([])
		await createAndPublishMarket(db, env, CREATOR, baseInput)
		expect(hoisted.hasMarketPermission).not.toHaveBeenCalled()
		expect(hoisted.prediction.createMarket).toHaveBeenCalledWith(
			expect.objectContaining({ createdBy: CREATOR })
		)
	})
})
