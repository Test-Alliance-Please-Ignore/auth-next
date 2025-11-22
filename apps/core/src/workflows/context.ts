import { logger } from '@repo/hono-helpers'

import type { Env } from '../context'
import type { createDb } from '../db'

/**
 * Workflow context
 */
export interface WorkflowContext {
	db: ReturnType<typeof createDb>
	env: Env
	workflowInstanceId: string
}

/**
 * Get a logger for the workflow
 * @param ctx - Workflow context
 * @returns Logger
 */
export const getWorkflowLogger = (ctx: WorkflowContext, stepName?: string) => {
	return logger.withTags({
		workflowInstanceId: ctx.workflowInstanceId,
		stepName: stepName ?? 'unknown',
	})
}
