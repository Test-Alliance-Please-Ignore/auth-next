import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reconcileCharacterCorporationMembership } from './reconcile-corporation-membership'

import type { WorkflowContext } from '../../context'

const reconcileCharacterCorporationMembershipMock = vi.fn()
const hoisted = vi.hoisted(() => ({
	triggerMumbleRefreshWorkflow: vi.fn(),
	revokeIneligibleMumbleAccounts: vi.fn(),
}))

const EVE_CORPORATION_DATA_NS = Symbol('EVE_CORPORATION_DATA')

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn((namespace: symbol) => {
		if (namespace === EVE_CORPORATION_DATA_NS) {
			return {
				reconcileCharacterCorporationMembership: reconcileCharacterCorporationMembershipMock,
			}
		}
		return {}
	}),
}))

vi.mock('../../../lib/workflow-triggers', () => ({
	triggerMumbleRefreshWorkflow: hoisted.triggerMumbleRefreshWorkflow,
}))

vi.mock('../../../services/mumble.service', () => ({
	revokeIneligibleMumbleAccounts: hoisted.revokeIneligibleMumbleAccounts,
}))

function createCtx(options?: {
	isAdmin?: boolean
	memberCorporationIds?: string[]
}): WorkflowContext {
	const memberCorporationIds = options?.memberCorporationIds ?? ['5678']
	const isAdmin = options?.isAdmin ?? false

	return {
		db: {
			query: {
				users: {
					findFirst: vi.fn().mockResolvedValue({ is_admin: isAdmin }),
				},
				userCharacters: {
					findMany: vi.fn().mockResolvedValue([{ corporationId: memberCorporationIds[0] ?? null }]),
				},
				managedCorporations: {
					findMany: vi
						.fn()
						.mockResolvedValue(memberCorporationIds.map((corporationId) => ({ corporationId }))),
				},
			},
		} as unknown as WorkflowContext['db'],
		env: {
			EVE_CORPORATION_DATA:
				EVE_CORPORATION_DATA_NS as unknown as WorkflowContext['env']['EVE_CORPORATION_DATA'],
		} as WorkflowContext['env'],
		refreshMode: 'event',
		userId: 'user-123',
		workflowInstanceId: 'wf-123',
	}
}

describe('reconcileCharacterCorporationMembership', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		hoisted.triggerMumbleRefreshWorkflow.mockResolvedValue({
			status: 'triggered',
			triggered: true,
			workflowInstanceId: 'mumble-wf-1',
		})
		hoisted.revokeIneligibleMumbleAccounts.mockResolvedValue({
			deleted: [],
			notFound: [],
			queued: [],
		})
	})

	it('triggers a Mumble refresh when membership changed', async () => {
		reconcileCharacterCorporationMembershipMock.mockResolvedValue({
			removedFromCorporationIds: ['1234'],
			addedToCorporationId: '5678',
		})

		const ctx = createCtx()
		const result = await reconcileCharacterCorporationMembership(ctx, '9001', '5678')

		expect(hoisted.triggerMumbleRefreshWorkflow).toHaveBeenCalledWith({
			env: ctx.env,
			userIds: ['user-123'],
			source: 'corp-membership-reconciled',
		})
		expect(hoisted.revokeIneligibleMumbleAccounts).not.toHaveBeenCalled()
		expect(result).toEqual({
			removedFromCorporationIds: ['1234'],
			addedToCorporationId: '5678',
		})
	})

	it('does not trigger downstream refreshes when membership did not change', async () => {
		reconcileCharacterCorporationMembershipMock.mockResolvedValue({
			removedFromCorporationIds: [],
			addedToCorporationId: null,
		})

		await reconcileCharacterCorporationMembership(createCtx(), '9001', '5678')

		expect(hoisted.triggerMumbleRefreshWorkflow).not.toHaveBeenCalled()
		expect(hoisted.revokeIneligibleMumbleAccounts).not.toHaveBeenCalled()
	})

	it('refreshes the Mumble profile when core affiliation changed but membership rows were current', async () => {
		reconcileCharacterCorporationMembershipMock.mockResolvedValue({
			removedFromCorporationIds: [],
			addedToCorporationId: null,
		})

		const ctx = createCtx()
		await reconcileCharacterCorporationMembership(ctx, '9001', '5678', true)

		expect(hoisted.triggerMumbleRefreshWorkflow).toHaveBeenCalledWith({
			env: ctx.env,
			userIds: ['user-123'],
			source: 'corp-membership-reconciled',
		})
	})

	it('fails the retryable reconciliation step when Mumble refresh cannot be queued', async () => {
		reconcileCharacterCorporationMembershipMock.mockResolvedValue({
			removedFromCorporationIds: [],
			addedToCorporationId: null,
		})
		hoisted.triggerMumbleRefreshWorkflow.mockResolvedValue({
			status: 'failed',
			triggered: false,
			error: 'workflow unavailable',
		})

		await expect(
			reconcileCharacterCorporationMembership(createCtx(), '9001', '5678', true)
		).rejects.toThrow('Failed to queue Mumble refresh: workflow unavailable')
	})

	it('deletes an ineligible user even when the corporation member rows were already current', async () => {
		reconcileCharacterCorporationMembershipMock.mockResolvedValue({
			removedFromCorporationIds: [],
			addedToCorporationId: null,
		})

		await reconcileCharacterCorporationMembership(
			createCtx({ memberCorporationIds: [] }),
			'9001',
			'outside-corp',
			true
		)

		expect(hoisted.revokeIneligibleMumbleAccounts).toHaveBeenCalledWith(
			expect.anything(),
			['user-123'],
			'corp-membership-reconciled'
		)
	})

	it('deletes the Mumble account when the user loses their final qualifying membership', async () => {
		reconcileCharacterCorporationMembershipMock.mockResolvedValue({
			removedFromCorporationIds: ['1234'],
			addedToCorporationId: null,
		})

		await reconcileCharacterCorporationMembership(
			createCtx({ memberCorporationIds: [] }),
			'9001',
			null
		)

		expect(hoisted.revokeIneligibleMumbleAccounts).toHaveBeenCalledWith(
			expect.anything(),
			['user-123'],
			'corp-membership-reconciled'
		)
		expect(hoisted.triggerMumbleRefreshWorkflow).not.toHaveBeenCalled()
	})

	it('retains the Mumble account for site admins without a qualifying membership', async () => {
		reconcileCharacterCorporationMembershipMock.mockResolvedValue({
			removedFromCorporationIds: ['1234'],
			addedToCorporationId: null,
		})

		await reconcileCharacterCorporationMembership(
			createCtx({ isAdmin: true, memberCorporationIds: [] }),
			'9001',
			null
		)

		expect(hoisted.revokeIneligibleMumbleAccounts).not.toHaveBeenCalled()
		expect(hoisted.triggerMumbleRefreshWorkflow).toHaveBeenCalled()
	})
})
