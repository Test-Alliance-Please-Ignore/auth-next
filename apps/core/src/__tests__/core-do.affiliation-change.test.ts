import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CoreDO } from '../durable-object'
import { triggerUserRefreshWorkflow } from '../lib/workflow-triggers'

vi.mock('../lib/workflow-triggers', () => ({
	triggerDiscordRefreshWorkflow: vi.fn(),
	triggerUserRefreshWorkflow: vi.fn(),
}))

function createDbMock(mappings: Array<{ userId: string }>) {
	const where = vi.fn().mockResolvedValue(mappings)
	const from = vi.fn().mockReturnValue({ where })
	const select = vi.fn().mockReturnValue({ from })

	return {
		select,
		from,
		where,
	}
}

describe('CoreDO.handleCharacterAffiliationChanges', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('deduplicates users, triggers refresh workflows, and queues pending Discord refreshes', async () => {
		const dbMock = createDbMock([{ userId: 'user-1' }, { userId: 'user-2' }, { userId: 'user-1' }])
		const addPendingDiscordRefreshes = vi.fn().mockResolvedValue({ pendingCount: 2 })
		const core = Object.create(CoreDO.prototype) as CoreDO
		;(core as any).env = { WORKFLOWS: {} }
		;(core as any).getDb = vi.fn().mockReturnValue(dbMock)
		;(core as any).addPendingDiscordRefreshes = addPendingDiscordRefreshes

		vi.mocked(triggerUserRefreshWorkflow)
			.mockResolvedValueOnce({ triggered: true } as never)
			.mockResolvedValueOnce({ triggered: false } as never)

		const result = await core.handleCharacterAffiliationChanges(['100', '100', '200'], {
			source: 'corp-membership-changed',
			bypassThrottle: true,
		})

		expect(triggerUserRefreshWorkflow).toHaveBeenCalledTimes(2)
		expect(addPendingDiscordRefreshes).toHaveBeenCalledWith(['user-1', 'user-2'], {
			source: 'corp-membership-changed',
		})
		expect(result).toEqual({
			usersMatched: 2,
			workflowsTriggered: 1,
			discordUsersQueued: 2,
		})
	})
})
