import { describe, expect, it, vi } from 'vitest'

import { FeatureFlagService } from './feature-flag.service'

const flag = (overrides: Record<string, unknown> = {}) => ({
	id: 'flag-1',
	key: 'notifications.email',
	valueType: 'boolean',
	booleanValue: true,
	jsonValue: null,
	description: null,
	tags: [],
	createdAt: new Date('2026-01-01T00:00:00Z'),
	updatedAt: new Date('2026-01-01T00:00:00Z'),
	...overrides,
})

function makeDb() {
	const db = {
		query: {
			featureFlags: {
				findFirst: vi.fn(),
				findMany: vi.fn(),
			},
		},
		insert: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
	}
	return db
}

describe('FeatureFlagService', () => {
	it('registers a flag and maps the inserted row', async () => {
		const db = makeDb()
		db.query.featureFlags.findFirst.mockResolvedValue(undefined)
		db.insert.mockReturnValue({
		values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([flag()]) }),
	})

		const result = await new FeatureFlagService(db as any).registerFlag('notifications.email', true)

		expect(result.key).toBe('notifications.email')
		expect(result.booleanValue).toBe(true)
		expect(db.insert).toHaveBeenCalledOnce()
	})

	it('rejects duplicate flags before inserting', async () => {
		const db = makeDb()
		db.query.featureFlags.findFirst.mockResolvedValue(flag())

		await expect(new FeatureFlagService(db as any).registerFlag('notifications.email', true)).rejects.toThrow(
			'already exists'
		)
		expect(db.insert).not.toHaveBeenCalled()
	})

	it('returns null when checking an unknown flag or mismatched tags', async () => {
		const db = makeDb()
		db.query.featureFlags.findFirst.mockResolvedValueOnce(undefined).mockResolvedValueOnce(
			flag({ tags: ['admin'] })
		)
		const service = new FeatureFlagService(db as any)

		expect(await service.checkFlag('missing')).toBeNull()
		expect(await service.checkFlag('notifications.email', ['member'])).toBeNull()
	})

	it('lists flags in the order returned by the database query', async () => {
		const db = makeDb()
		db.query.featureFlags.findMany.mockResolvedValue([
			flag({ id: 'flag-2', key: 'zeta' }),
			flag({ id: 'flag-1', key: 'alpha' }),
		])

		const result = await new FeatureFlagService(db as any).listFlags({ prefix: 'notifications' })

		expect(result.map((item) => item.key)).toEqual(['zeta', 'alpha'])
		expect(db.query.featureFlags.findMany).toHaveBeenCalledOnce()
	})

	it('deletes a flag only when the database returns a deleted row', async () => {
		const db = makeDb()
		db.delete
			.mockReturnValueOnce({
				where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([flag()]) }),
			})
			.mockReturnValueOnce({
				where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
			})
		const service = new FeatureFlagService(db as any)

		expect(await service.deleteFlag('notifications.email')).toBe(true)
		expect(await service.deleteFlag('missing')).toBe(false)
	})
})
