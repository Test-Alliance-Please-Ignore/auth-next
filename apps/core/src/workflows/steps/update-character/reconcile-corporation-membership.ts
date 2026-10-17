import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { users } from '../../../db/schema'
import { hasMemberCorporationAttachment } from '../../../lib/service-eligibility'
import { triggerMumbleRefreshWorkflow } from '../../../lib/workflow-triggers'
import { revokeIneligibleMumbleAccounts } from '../../../services/mumble.service'
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
	corporationId: string | null,
	affiliationChanged = false
): Promise<ReconcileCorporationMembershipResult> {
	const logger = getWorkflowLogger(ctx, 'reconcile-corporation-membership')
	const corporationDataStub = getStub<EveCorporationData>(ctx.env.EVE_CORPORATION_DATA, 'default')

	const result = await corporationDataStub.reconcileCharacterCorporationMembership(
		characterId,
		corporationId
	)

	const membershipChanged =
		result.removedFromCorporationIds.length > 0 || result.addedToCorporationId !== null

	if (membershipChanged || affiliationChanged) {
		const [user, hasMemberCorporation] = await Promise.all([
			ctx.db.query.users.findFirst({
				where: eq(users.id, ctx.userId),
				columns: { is_admin: true },
			}),
			hasMemberCorporationAttachment(ctx.db, ctx.userId),
		])
		const shouldDeleteMumbleAccount = !user?.is_admin && !hasMemberCorporation

		if (shouldDeleteMumbleAccount) {
			await revokeIneligibleMumbleAccounts(ctx.env, [ctx.userId], 'corp-membership-reconciled')
		} else {
			const refresh = await triggerMumbleRefreshWorkflow({
				env: ctx.env,
				userIds: [ctx.userId],
				source: 'corp-membership-reconciled',
			})
			if (refresh.status === 'failed') {
				throw new Error(`Failed to queue Mumble refresh: ${refresh.error}`)
			}
		}

		logger.info('[Workflow] Reconciled Mumble access after corporation membership change', {
			userId: ctx.userId,
			characterId,
			hasMemberCorporation,
			isAdmin: user?.is_admin === true,
			mumbleDeletionRequested: shouldDeleteMumbleAccount,
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
