import { describe, expect, it, vi } from 'vitest'

import { TaxCorporationExclusionsService } from '../tax-corporation-exclusions.service'

describe('TaxCorporationExclusionsService', () => {
	it('upserts exclusions and trims reason text', async () => {
		const returnedRow = {
			corporationId: '98000001',
			reason: 'manual exclusion',
			createdBy: 'admin-1',
			updatedBy: 'admin-1',
			createdAt: new Date('2026-03-01T00:00:00.000Z'),
			updatedAt: new Date('2026-03-01T00:00:00.000Z'),
		}
		const db = {
			insert: vi.fn(() => ({
				values: vi.fn(() => ({
					onConflictDoUpdate: vi.fn(() => ({
						returning: vi.fn().mockResolvedValue([returnedRow]),
					})),
				})),
			})),
		} as any

		const service = new TaxCorporationExclusionsService(db)
		const result = await service.upsertExclusion('admin-1', '98000001', {
			reason: '  manual exclusion  ',
		})

		expect(result).toEqual(returnedRow)
		expect(db.insert).toHaveBeenCalledTimes(1)
	})

	it('lists exclusions with bounded pagination', async () => {
		const row = {
			corporationId: '98000001',
			reason: null,
			createdBy: 'admin-1',
			updatedBy: 'admin-1',
			createdAt: new Date('2026-03-01T00:00:00.000Z'),
			updatedAt: new Date('2026-03-01T00:00:00.000Z'),
		}
		const findMany = vi.fn().mockResolvedValue([row])
		const db = {
			query: {
				taxCorporationExclusions: {
					findMany,
				},
			},
		} as any

		const service = new TaxCorporationExclusionsService(db)
		const result = await service.listExclusions({ limit: 9999, offset: -10 })

		expect(result).toEqual([row])
		expect(findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				limit: 500,
				offset: 0,
			})
		)
	})

	it('deletes and checks excluded state', async () => {
		const deleteWhere = vi.fn().mockResolvedValue(undefined)
		const findFirst = vi
			.fn()
			.mockResolvedValueOnce({ corporationId: '98000001' })
			.mockResolvedValueOnce(null)
		const db = {
			delete: vi.fn(() => ({
				where: deleteWhere,
			})),
			query: {
				taxCorporationExclusions: {
					findFirst,
				},
			},
		} as any

		const service = new TaxCorporationExclusionsService(db)
		await service.deleteExclusion('98000001')
		const firstCheck = await service.isExcluded('98000001')
		const secondCheck = await service.isExcluded('98000001')

		expect(deleteWhere).toHaveBeenCalledTimes(1)
		expect(firstCheck).toBe(true)
		expect(secondCheck).toBe(false)
	})
})
