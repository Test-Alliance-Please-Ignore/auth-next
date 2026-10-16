import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isMumbleFeatureEnabled } from '../mumble-feature'
import {
	createDirectorHealthRecheckWorkflowId,
	createDiscordRefreshWorkflowId,
	createMumbleRefreshWorkflowId,
	createUserRefreshWorkflowId,
	triggerMumbleRefreshWorkflow,
	triggerUserRefreshWorkflow,
} from '../workflow-triggers'

const createWorkflowMock = vi.hoisted(() => vi.fn())

vi.mock('@repo/workflow-utils', () => ({
	createWorkflow: createWorkflowMock,
}))
vi.mock('../mumble-feature', () => ({
	isMumbleFeatureEnabled: vi.fn(),
}))

describe('Director health recheck workflow IDs', () => {
	it('deduplicates the same character and corporation within a five-minute window', () => {
		const now = 1_699_999_801_000

		expect(createDirectorHealthRecheckWorkflowId('123', '456', now)).toBe(
			createDirectorHealthRecheckWorkflowId('123', '456', now + 4 * 60 * 1000)
		)
		expect(createDirectorHealthRecheckWorkflowId('123', '456', now)).not.toBe(
			createDirectorHealthRecheckWorkflowId('123', '456', now + 5 * 60 * 1000)
		)
		expect(createDirectorHealthRecheckWorkflowId('123', '456', now)).not.toBe(
			createDirectorHealthRecheckWorkflowId('123', '789', now)
		)
	})
})

describe('Mumble refresh workflow IDs', () => {
	it('does not collide for equal-sized batches created in the same millisecond', () => {
		const now = vi.spyOn(Date, 'now').mockReturnValue(1_699_999_801_000)
		try {
			expect(createMumbleRefreshWorkflowId('corp-member-flag-disabled', ['a', 'b'])).not.toBe(
				createMumbleRefreshWorkflowId('corp-member-flag-disabled', ['c', 'd'])
			)
		} finally {
			now.mockRestore()
		}
	})
})

describe('Mumble access reconciliation trigger', () => {
	it('starts a revocation check even when the Mumble UI feature is off', async () => {
		vi.mocked(isMumbleFeatureEnabled).mockResolvedValue(false)
		createWorkflowMock.mockResolvedValue({ id: 'mumble-wf-1' })
		const env = { USER_MUMBLE_REFRESH_WORKFLOW: {} } as any

		const result = await triggerMumbleRefreshWorkflow({
			env,
			userIds: ['user-1'],
			source: 'corp-member-flag-disabled',
			forceAccessReconciliation: true,
		})

		expect(result.status).toBe('triggered')
		expect(createWorkflowMock).toHaveBeenCalledWith(
			env.USER_MUMBLE_REFRESH_WORKFLOW,
			expect.anything()
		)
	})
})

describe('Discord refresh workflow IDs', () => {
	it('contains the complete user identifier for exact ownership checks', () => {
		const userId = '12345678-1234-1234-1234-123456789abc'
		const workflowId = createDiscordRefreshWorkflowId('user-manual', userId)

		expect(workflowId).toMatch(
			/^discord-refresh-user-manual-12345678123412341234123456789abc-[a-z0-9]+$/
		)
	})
})

describe('User refresh workflow IDs', () => {
	it('deduplicates normal refreshes within the five-minute throttle window', () => {
		const now = 1_699_999_801_000

		expect(createUserRefreshWorkflowId('login', 'user-123', now)).toBe(
			createUserRefreshWorkflowId('login', 'user-123', now + 4 * 60 * 1000)
		)
		expect(createUserRefreshWorkflowId('login', 'user-123', now)).not.toBe(
			createUserRefreshWorkflowId('login', 'user-123', now + 5 * 60 * 1000)
		)
	})

	it('allows explicit bypasses to create unique workflow IDs', () => {
		const now = 1_699_999_801_000

		expect(createUserRefreshWorkflowId('manual', 'user-123', now, false)).not.toBe(
			createUserRefreshWorkflowId('manual', 'user-123', now + 1, false)
		)
	})
})

describe('User refresh workflow trigger', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	function makeDb(lastRefreshWorkflowAttempt: Date | null = null) {
		const where = vi.fn().mockResolvedValue(undefined)
		const set = vi.fn().mockReturnValue({ where })
		return {
			query: {
				users: {
					findFirst: vi.fn().mockResolvedValue({ lastRefreshWorkflowAttempt }),
				},
			},
			update: vi.fn().mockReturnValue({ set }),
		}
	}

	it('does not write the throttle watermark when workflow creation fails', async () => {
		createWorkflowMock.mockRejectedValueOnce(new Error('workflows unavailable'))
		const db = makeDb(null)

		const result = await triggerUserRefreshWorkflow({
			db: db as never,
			env: { USER_REFRESH_WORKFLOW: {} } as never,
			userId: 'user-1',
			source: 'login',
		})

		expect(result).toMatchObject({ status: 'failed', triggered: false })
		expect(db.update).not.toHaveBeenCalled()
	})

	it('writes the throttle watermark only after workflow creation succeeds', async () => {
		createWorkflowMock.mockResolvedValueOnce({ id: 'workflow-1' })
		const db = makeDb(null)

		const result = await triggerUserRefreshWorkflow({
			db: db as never,
			env: { USER_REFRESH_WORKFLOW: {} } as never,
			userId: 'user-1',
			source: 'login',
		})

		expect(result).toMatchObject({ status: 'triggered', triggered: true })
		expect(createWorkflowMock).toHaveBeenCalledOnce()
		expect(db.update).toHaveBeenCalledOnce()
		expect(createWorkflowMock.mock.invocationCallOrder[0]).toBeLessThan(
			db.update.mock.invocationCallOrder[0]
		)
	})
})
