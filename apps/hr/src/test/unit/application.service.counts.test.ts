import { describe, expect, it, vi } from 'vitest'

import { ApplicationService } from '../../services/application.service'

import type { ServiceContext } from '../../services/context'

function makeService(rows: Array<{ corporationId: string; status: string; total: number }>) {
	const groupedQuery = {
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		groupBy: vi.fn().mockResolvedValue(rows),
	}
	const db = {
		select: vi.fn().mockReturnValue(groupedQuery),
	} as unknown as ServiceContext['db']

	return {
		service: new ApplicationService({ db, env: {} } as ServiceContext),
		groupedQuery,
	}
}

describe('ApplicationService.getApplicationCountsByCorporation', () => {
	it('returns only authorized corporations and groups open statuses in one query', async () => {
		const { service, groupedQuery } = makeService([
			{ corporationId: 'corp-1', status: 'pending', total: 2 },
			{ corporationId: 'corp-1', status: 'under_review', total: 1 },
			{ corporationId: 'corp-2', status: 'pending', total: 7 },
		])

		const result = await service.getApplicationCountsByCorporation(
			['corp-1', 'corp-2'],
			false,
			false,
			['corp-1']
		)

		expect(result).toEqual([{ corporationId: 'corp-1', pending: 2, underReview: 1 }])
		expect(groupedQuery.groupBy).toHaveBeenCalledTimes(1)
	})

	it('returns zero counts for authorized corporations with no open applications', async () => {
		const { service } = makeService([])

		await expect(
			service.getApplicationCountsByCorporation(['corp-1'], true, false)
		).resolves.toEqual([{ corporationId: 'corp-1', pending: 0, underReview: 0 }])
	})
})
