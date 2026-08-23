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
	beforeEach(() => {
		vi.clearAllMocks()
		groupsStub = { getRolesFor: vi.fn() }
		getStubMock.mockReturnValue(groupsStub)
	})

	it('requires the persisted alliance-member role', async () => {
		groupsStub.getRolesFor.mockResolvedValue([])
		const service = new CoreRpcService({} as never, { GROUPS: {} } as never)

		expect(await service.isUserAllianceMember('user-1')).toBe(false)
		expect(groupsStub.getRolesFor).toHaveBeenCalledWith({
			attachedToType: RoleAttachmentType.USER,
			attachedToId: 'user-1',
		})
	})

	it('accepts the persisted alliance-member role without a second corporation lookup', async () => {
		groupsStub.getRolesFor.mockResolvedValue([{ role: { name: ROLE_CORE_ALLIANCE_MEMBER } }])
		const service = new CoreRpcService({} as never, { GROUPS: {} } as never)

		expect(await service.isUserAllianceMember('user-1')).toBe(true)
	})
})
