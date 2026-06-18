import { beforeEach, describe, expect, it, vi } from 'vitest'

import { disableBlacklistedUser } from './disable-blacklisted-user'

const { enforceBlacklistedDiscordAccessMock, enforceBlacklistedMumbleAccessMock } = vi.hoisted(
	() => ({
		enforceBlacklistedDiscordAccessMock: vi.fn(),
		enforceBlacklistedMumbleAccessMock: vi.fn(),
	})
)

vi.mock('../../../services/discord.service', () => ({
	enforceBlacklistedDiscordAccess: enforceBlacklistedDiscordAccessMock,
}))

vi.mock('../../../services/mumble.service', () => ({
	enforceBlacklistedMumbleAccess: enforceBlacklistedMumbleAccessMock,
}))

describe('disableBlacklistedUser', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('enforces role stripping and ban across managed Discord servers', async () => {
		enforceBlacklistedDiscordAccessMock.mockResolvedValue({
			results: [],
			totalInvited: 0,
			totalUpdated: 3,
			totalFailed: 1,
		})
		enforceBlacklistedMumbleAccessMock.mockResolvedValue(undefined)

		const result = await disableBlacklistedUser({
			env: {} as any,
			db: {} as any,
			userId: 'user-1',
			workflowInstanceId: 'wf-1',
			refreshMode: 'event',
		})

		expect(enforceBlacklistedDiscordAccessMock).toHaveBeenCalledWith(
			{} as any,
			'user-1',
			'User is blacklisted (user-refresh workflow enforcement)'
		)
		expect(enforceBlacklistedMumbleAccessMock).toHaveBeenCalledWith(
			{} as any,
			'user-1',
			'User is blacklisted (user-refresh workflow enforcement)'
		)
		expect(result).toEqual({
			success: true,
			totalUpdated: 3,
			totalFailed: 1,
		})
	})
})
