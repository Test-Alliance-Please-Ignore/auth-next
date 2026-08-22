import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { RoleAttachmentType } from '@repo/groups'

import { CoreRpcService } from '../core-rpc.service'

const getStubMock = vi.hoisted(() => vi.fn())

vi.mock('@repo/do-utils', () => ({
	getStub: getStubMock,
	withRpcResult: async <T, R>(result: Promise<T>, consume: (value: T) => R) =>
		consume(await result),
}))

describe('CoreRpcService.isUserAllianceMember', () => {
	let groupsStub: { getRolesFor: ReturnType<typeof vi.fn> }
	let db: {
		select: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.clearAllMocks()
		groupsStub = { getRolesFor: vi.fn() }
		db = { select: vi.fn() }
		getStubMock.mockReturnValue(groupsStub)
	})

	it('requires the persisted alliance-member role before querying affiliation', async () => {
		groupsStub.getRolesFor.mockResolvedValue([])
		const service = new CoreRpcService(db as never, { GROUPS: {} } as never)

		expect(await service.isUserAllianceMember('user-1')).toBe(false)
		expect(groupsStub.getRolesFor).toHaveBeenCalledWith({
			attachedToType: RoleAttachmentType.USER,
			attachedToId: 'user-1',
		})
		expect(db.select).not.toHaveBeenCalled()
	})

	it('requires both the role and an active eligible corporation affiliation', async () => {
		groupsStub.getRolesFor.mockResolvedValue([{ role: { name: ROLE_CORE_ALLIANCE_MEMBER } }])
		const limit = vi.fn().mockResolvedValue([{ characterId: '9001' }])
		const where = vi.fn().mockReturnValue({ limit })
		const innerJoin = vi.fn().mockReturnValue({ where })
		const from = vi.fn().mockReturnValue({ innerJoin })
		db.select.mockReturnValue({ from })
		const service = new CoreRpcService(db as never, { GROUPS: {} } as never)

		expect(await service.isUserAllianceMember('user-1')).toBe(true)
		expect(limit).toHaveBeenCalledWith(1)
	})

	it('returns false when the role exists but no eligible affiliation exists', async () => {
		groupsStub.getRolesFor.mockResolvedValue([{ role: { name: ROLE_CORE_ALLIANCE_MEMBER } }])
		const limit = vi.fn().mockResolvedValue([])
		const where = vi.fn().mockReturnValue({ limit })
		const innerJoin = vi.fn().mockReturnValue({ where })
		const from = vi.fn().mockReturnValue({ innerJoin })
		db.select.mockReturnValue({ from })
		const service = new CoreRpcService(db as never, { GROUPS: {} } as never)

		expect(await service.isUserAllianceMember('user-1')).toBe(false)
	})
})
