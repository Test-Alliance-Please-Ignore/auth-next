import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CoreDO } from '../durable-object'
import { triggerDiscordRefreshWorkflow, triggerUserRefreshWorkflow } from '../lib/workflow-triggers'

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

	it('deduplicates users and queues a batched user refresh', async () => {
		const dbMock = createDbMock([{ userId: 'user-1' }, { userId: 'user-2' }, { userId: 'user-1' }])
		const queueUserRefreshes = vi.fn().mockResolvedValue({ added: 2, pendingCount: 2 })
		const core = Object.create(CoreDO.prototype) as CoreDO
		;(core as any).getDb = vi.fn().mockReturnValue(dbMock)
		;(core as any).queueUserRefreshes = queueUserRefreshes

		const result = await core.handleCharacterAffiliationChanges(['100', '100', '200'], {
			source: 'corp-membership-changed',
		})

		expect(queueUserRefreshes).toHaveBeenCalledWith(
			['user-1', 'user-2'],
			expect.objectContaining({ source: 'corp-membership-changed', force: true })
		)
		expect(result).toEqual({
			usersMatched: 2,
			refreshUsersQueued: 2,
		})
	})
})

describe('CoreDO.processPendingRefreshes', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	function createCore() {
		const core = Object.create(CoreDO.prototype) as CoreDO
		;(core as any).env = {}
		;(core as any).logger = { error: vi.fn(), info: vi.fn() }
		;(core as any).state = {
			storage: {
				delete: vi.fn(),
				put: vi.fn(),
			},
		}
		;(core as any).pendingUserRefreshes = new Map()
		;(core as any).pendingDiscordRefreshes = new Map()
		return core
	}

	it('starts queued user refreshes without polling for workflow completion', async () => {
		const core = createCore()
		;(core as any).pendingUserRefreshes.set('user-1', {
			expiresAt: Date.now() + 60_000,
			processed: false,
			source: 'corp-membership-changed',
		})
		;(core as any).getDb = vi.fn().mockReturnValue({ query: { users: { findFirst: vi.fn() } } })
		vi.mocked(triggerUserRefreshWorkflow).mockResolvedValue({
			status: 'triggered',
			triggered: true,
			workflowInstanceId: 'user-refresh-1',
		})

		const result = await core.processPendingRefreshes()

		expect(triggerUserRefreshWorkflow).toHaveBeenCalledWith(
			expect.objectContaining({
				bypassThrottle: true,
				refreshMode: 'event',
				source: 'corp-membership-changed',
				userId: 'user-1',
			})
		)
		expect(triggerDiscordRefreshWorkflow).not.toHaveBeenCalled()
		expect(result).toMatchObject({
			refreshesProcessed: 1,
			refreshesTriggered: 1,
			discordProcessed: 0,
		})
	})

	it('drains ready Discord work with its explicit role-removal options', async () => {
		const core = createCore()
		;(core as any).pendingDiscordRefreshes.set('user-1', {
			allowRemoval: true,
			expiresAt: Date.now() + 60_000,
			hardStripAllRoles: true,
			processed: false,
			source: 'corp-member-flag-disabled',
		})
		;(core as any).getDb = vi.fn().mockReturnValue({
			query: {
				users: { findFirst: vi.fn().mockResolvedValue({ discordUserId: 'discord-user-1' }) },
			},
		})
		vi.mocked(triggerDiscordRefreshWorkflow).mockResolvedValue({
			status: 'triggered',
			triggered: true,
			workflowInstanceId: 'discord-refresh-1',
		})

		const result = await core.processPendingRefreshes()

		expect(triggerDiscordRefreshWorkflow).toHaveBeenCalledWith(
			expect.objectContaining({
				allowRemoval: true,
				hardStripAllRoles: true,
				source: 'corp-member-flag-disabled',
				userId: 'user-1',
			})
		)
		expect(result).toMatchObject({
			refreshesProcessed: 0,
			discordProcessed: 1,
			triggered: 1,
		})
	})
})
