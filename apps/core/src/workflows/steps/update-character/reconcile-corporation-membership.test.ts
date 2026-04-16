import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reconcileCharacterCorporationMembership } from './reconcile-corporation-membership'

import type { WorkflowContext } from '../../context'

const reconcileCharacterCorporationMembershipMock = vi.fn()
const addPendingDiscordRefreshes = vi.fn()

const EVE_CORPORATION_DATA_NS = Symbol('EVE_CORPORATION_DATA')
const CORE_NS = Symbol('CORE')

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn((namespace: symbol) => {
		if (namespace === EVE_CORPORATION_DATA_NS) {
			return {
				reconcileCharacterCorporationMembership: reconcileCharacterCorporationMembershipMock,
			}
		}
		if (namespace === CORE_NS) {
			return { addPendingDiscordRefreshes }
		}
		return {}
	}),
}))

function createCtx(): WorkflowContext {
	return {
		db: {} as WorkflowContext['db'],
		env: {
			CORE: CORE_NS as unknown as WorkflowContext['env']['CORE'],
			EVE_CORPORATION_DATA: EVE_CORPORATION_DATA_NS as unknown as WorkflowContext['env']['EVE_CORPORATION_DATA'],
		} as WorkflowContext['env'],
		refreshMode: 'event',
		userId: 'user-123',
		workflowInstanceId: 'wf-123',
	}
}

describe('reconcileCharacterCorporationMembership', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('queues a Discord refresh when membership changed', async () => {
		reconcileCharacterCorporationMembershipMock.mockResolvedValue({
			removedFromCorporationIds: ['1234'],
			addedToCorporationId: '5678',
		})

		const result = await reconcileCharacterCorporationMembership(createCtx(), '9001', '5678')

		expect(addPendingDiscordRefreshes).toHaveBeenCalledWith(['user-123'], {
			source: 'corp-membership-reconciled',
		})
		expect(result).toEqual({
			removedFromCorporationIds: ['1234'],
			addedToCorporationId: '5678',
		})
	})

	it('does not queue a Discord refresh when membership did not change', async () => {
		reconcileCharacterCorporationMembershipMock.mockResolvedValue({
			removedFromCorporationIds: [],
			addedToCorporationId: null,
		})

		await reconcileCharacterCorporationMembership(createCtx(), '9001', '5678')

		expect(addPendingDiscordRefreshes).not.toHaveBeenCalled()
	})
})
