import { logger } from '@repo/hono-helpers'

import { BillService } from '../services/bill.service'

import type { Env } from '../context'
import type { createDb } from '../db'

/**
 * Workflow context
 */
export interface WorkflowContext {
	db: ReturnType<typeof createDb>
	env: Env
	workflowInstanceId: string
	billId: string
	billService: BillService
}

/**
 * Get a logger for the workflow
 * @param ctx - Workflow context
 * @param stepName - Optional step name for logging
 * @returns Logger
 */
export const getWorkflowLogger = (ctx: WorkflowContext, stepName?: string) => {
	return logger.withTags({
		workflowInstanceId: ctx.workflowInstanceId,
		stepName: stepName ?? 'unknown',
	})
}
