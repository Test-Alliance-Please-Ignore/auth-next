import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CoreDO } from '../durable-object'

function createDbMock() {
	const where = vi.fn().mockResolvedValue(undefined)
	const set = vi.fn().mockReturnValue({ where })
	const update = vi.fn().mockReturnValue({ set })

	return {
		query: {
			users: {
				findMany: vi.fn(),
			},
			userCharacters: {
				findMany: vi.fn(),
			},
		},
		update,
		where,
	}
}

describe('CoreDO.listUsersNeedingRefresh', () => {
	let dbMock: ReturnType<typeof createDbMock>
	let core: CoreDO

	beforeEach(() => {
		dbMock = createDbMock()
		core = Object.create(CoreDO.prototype) as CoreDO
		;(core as any).getDb = vi.fn().mockReturnValue(dbMock)
	})

	it('filters out users with only deleted characters from refresh candidates', async () => {
		dbMock.query.users.findMany.mockResolvedValue([{ id: 'u-1' }, { id: 'u-2' }])
		dbMock.query.userCharacters.findMany.mockResolvedValue([{ userId: 'u-1' }])

		const result = await core.listUsersNeedingRefresh(50)

		expect(result).toEqual(['u-1'])
		expect(dbMock.query.userCharacters.findMany).toHaveBeenCalledTimes(1)
		expect(dbMock.update).toHaveBeenCalledTimes(1)
	})

	it('returns no candidates when all candidate users only have deleted characters', async () => {
		dbMock.query.users.findMany.mockResolvedValue([{ id: 'u-1' }])
		dbMock.query.userCharacters.findMany.mockResolvedValue([])

		const result = await core.listUsersNeedingRefresh(50)

		expect(result).toEqual([])
		expect(dbMock.update).not.toHaveBeenCalled()
	})
})
