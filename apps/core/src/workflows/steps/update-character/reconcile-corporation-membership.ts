import { getStub } from '@repo/do-utils'

import { triggerMumbleRefreshWorkflow } from '../../../lib/workflow-triggers'
import { getWorkflowLogger } from '../../context'

import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { WorkflowContext } from '../../context'

export interface ReconcileCorporationMembershipResult {
	removedFromCorporationIds: string[]
	addedToCorporationId: string | null
}

/**
 * Reconcile corporation member rows for one character based on authoritative
 * affiliation from character refresh.
 */
export async function reconcileCharacterCorporationMembership(
	ctx: WorkflowContext,
	characterId: string,
	corporationId: string | null
): Promise<ReconcileCorporationMembershipResult> {
	const logger = getWorkflowLogger(ctx, 'reconcile-corporation-membership')
	const corporationDataStub = getStub<EveCorporationData>(ctx.env.EVE_CORPORATION_DATA, 'default')

	const result = await corporationDataStub.reconcileCharacterCorporationMembership(
		characterId,
		corporationId
	)

	const membershipChanged =
		result.removedFromCorporationIds.length > 0 || result.addedToCorporationId !== null

	if (membershipChanged) {
		await triggerMumbleRefreshWorkflow({
			env: ctx.env,
			userIds: [ctx.userId],
			source: 'corp-membership-reconciled',
		})
	}

	logger.info('[Workflow] Reconciled character corporation membership', {
		characterId,
		corporationId,
		removedFromCorporationIds: result.removedFromCorporationIds,
		addedToCorporationId: result.addedToCorporationId,
		membershipChanged,
	})

	return result
}
