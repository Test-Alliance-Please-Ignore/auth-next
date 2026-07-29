import { describe, expect, it, vi } from 'vitest'

import { UserFeatureFlagService } from './user-feature-flag.service'

const flag = (overrides: Record<string, unknown> = {}) => ({
	id: 'flag-1',
	key: 'feature.enabled',
	valueType: 'boolean',
	booleanValue: true,
	jsonValue: null,
	description: null,
	tags: [],
	createdAt: new Date('2026-01-01T00:00:00Z'),
	updatedAt: new Date('2026-01-01T00:00:00Z'),
	...overrides,
})

const override = (enabled: boolean) => ({
	id: 'override-1',
	featureFlagId: 'flag-1',
	userId: 'user-1',
	enabled,
	createdAt: new Date('2026-01-01T00:00:00Z'),
	updatedAt: new Date('2026-01-01T00:00:00Z'),
})

function makeDb() {
	return {
		query: {
			featureFlags: { findFirst: vi.fn(), findMany: vi.fn() },
			userFeatureFlags: { findFirst: vi.fn(), findMany: vi.fn() },
		},
		insert: vi.fn(),
		delete: vi.fn(),
		select: vi.fn(),
	}
}

describe('UserFeatureFlagService', () => {
	it('uses a user override before the global default', async () => {
		const db = makeDb()
		db.query.featureFlags.findFirst.mockResolvedValue(flag())
		db.query.userFeatureFlags.findFirst.mockResolvedValue(override(false))

		const result = await new UserFeatureFlagService(db as any).checkUserFlag('user-1', 'feature.enabled')

		expect(result).toBe(false)
	})

	it('returns false for an unknown flag', async () => {
		const db = makeDb()
		db.query.featureFlags.findFirst.mockResolvedValue(undefined)

		expect(await new UserFeatureFlagService(db as any).checkUserFlag('user-1', 'missing')).toBe(false)
	})

	it('resolves a batch with missing keys and duplicate requests', async () => {
		const db = makeDb()
		db.query.featureFlags.findMany.mockResolvedValue([flag()])
		db.query.userFeatureFlags.findMany.mockResolvedValue([override(false)])

		const result = await new UserFeatureFlagService(db as any).checkUserFlags('user-1', [
			'feature.enabled',
			'missing',
			'feature.enabled',
		])

		expect(result).toEqual({ 'feature.enabled': false, missing: false })
	})

	it('rejects setting an override for an unknown flag', async () => {
		const db = makeDb()
		db.query.featureFlags.findFirst.mockResolvedValue(undefined)

		await expect(
			new UserFeatureFlagService(db as any).setUserFlag('user-1', 'missing', true)
		).rejects.toThrow('not found')
		expect(db.insert).not.toHaveBeenCalled()
	})
})
