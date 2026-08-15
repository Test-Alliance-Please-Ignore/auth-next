import { WorkflowEntrypoint } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type {
	CorporationTax,
	TaxAssessmentWorkflowOutput,
	TaxAssessmentWorkflowParams,
} from '@repo/corporation-tax'
import type { Env } from '../context'

/**
 * Runs one assessment behind a durable Workflow boundary so callers can queue it
 * and poll status instead of holding an HTTP request open for the full scan.
 */
export class TaxAssessmentWorkflow extends WorkflowEntrypoint<Env, TaxAssessmentWorkflowParams> {
	async run(
		event: WorkflowEvent<TaxAssessmentWorkflowParams>,
		step: WorkflowStep
	): Promise<TaxAssessmentWorkflowOutput> {
		const {
			actorUserId,
			corporationId,
			periodStart,
			periodEnd,
			includeCharacterWallets = false,
		} = event.payload

		return step.do(
			'run-assessment',
			{
				retries: {
					limit: 2,
					delay: '10 seconds',
					backoff: 'exponential',
				},
				timeout: '10 minutes',
			},
			async () => {
				const taxStub = getStub<CorporationTax>(this.env.CORPORATION_TAX, 'default')
				const result = await taxStub.runAssessmentForPeriod(actorUserId, {
					corporationId,
					periodStart: new Date(periodStart),
					periodEnd: new Date(periodEnd),
					includeCharacterWallets,
				})

				return {
					status: 'completed' as const,
					assessmentId: result.assessment.id,
					lineCount: result.lineCount,
					discrepancyCount: result.discrepancyCount,
				}
			}
		)
	}
}
