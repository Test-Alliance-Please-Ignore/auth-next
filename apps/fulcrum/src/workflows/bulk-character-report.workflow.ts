import { WorkflowEntrypoint } from 'cloudflare:workers'

import { runBulkCharacterReportWorkflow } from './bulk-character-report.runner'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { Env } from '../context'
import type { BulkCharacterReportWorkflowParams } from './bulk-character-report.runner'

export type { BulkCharacterReportWorkflowParams } from './bulk-character-report.runner'

export class BulkCharacterReportWorkflow extends WorkflowEntrypoint<Env, BulkCharacterReportWorkflowParams> {
	async run(event: WorkflowEvent<BulkCharacterReportWorkflowParams>, step: WorkflowStep) {
		const stepDo = <T>(name: string, config: unknown, fn: () => Promise<T>) =>
			step.do(name, config as any, fn as any) as Promise<T>

		await runBulkCharacterReportWorkflow(
			this.env,
			stepDo,
			event.instanceId,
			event.payload,
		)
	}
}
