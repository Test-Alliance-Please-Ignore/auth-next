import { describe, expect, it, vi } from 'vitest'

import { resolveMoonRegionIds } from '../../utils/moon-region-lookup'

describe('resolveMoonRegionIds', () => {
	it('splits large moon lookups into smaller batches', async () => {
		const moonIds = Array.from({ length: 1201 }, (_, index) => `moon-${index + 1}`)
		const chunks = [moonIds.slice(0, 500), moonIds.slice(500, 1000), moonIds.slice(1000)]
		let callIndex = 0

		const whereMock = vi.fn(async () => {
			const moonIdsForChunk = chunks[callIndex++] ?? []
			return moonIdsForChunk.map((moonId) => {
				const moonIndex = Number.parseInt(moonId.split('-').pop() ?? '', 10)
				return {
					moonId,
					regionId: moonIndex % 2 === 0 ? '10000002' : '10000043',
				}
			})
		})

		const chain: {
			from: ReturnType<typeof vi.fn>
			innerJoin: ReturnType<typeof vi.fn>
			where: typeof whereMock
		} = {
			from: vi.fn(() => chain),
			innerJoin: vi.fn(() => chain),
			where: whereMock,
		}

		const db = {
			select: vi.fn(() => chain),
		} as any

		const result = await resolveMoonRegionIds(db, moonIds)

		expect(db.select).toHaveBeenCalledTimes(3)
		expect(whereMock).toHaveBeenCalledTimes(3)
		expect(result['moon-1']).toBe('10000043')
		expect(result['moon-2']).toBe('10000002')
		expect(result['moon-1201']).toBe('10000043')
		expect(Object.keys(result)).toHaveLength(1201)
	})
})
