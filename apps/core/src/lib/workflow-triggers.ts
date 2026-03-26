import { eq } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'

import { users } from '../db/schema'

import type { Env } from '../context'
import type { createDb } from '../db'

const THROTTLE_MS = 5 * 60 * 1000 // 5 minutes

export interface TriggerUserRefreshOptions {
	db: ReturnType<typeof createDb>
	env: Env
	userId: string
	source: string
	bypassThrottle?: boolean
	refreshMode?: 'scheduled' | 'event' | 'manual'
}

export interface TriggerUserRefreshResult {
	status: 'triggered' | 'throttled' | 'failed'
	triggered: boolean
	workflowInstanceId?: string
	error?: string
}

export function createUserRefreshWorkflowId(source: string, userId: string): string {
	const normalizedSource = source
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
	const sourceToken = (normalizedSource || 'unknown').slice(0, 16)
	const userToken = userId.replace(/-/g, '').slice(0, 12)
	const timeToken = Date.now().toString(36)
	return `user-refresh-${sourceToken}-${userToken}-${timeToken}`
}

/**
 * Trigger user refresh workflow with throttling.
 * Returns immediately - does not block on workflow creation.
 * Logs errors but does not throw.
 */
export async function triggerUserRefreshWorkflow({
	db,
	env,
	userId,
	source,
	bypassThrottle = false,
	refreshMode = 'scheduled',
}: TriggerUserRefreshOptions): Promise<TriggerUserRefreshResult> {
	try {
		const userRecord = await db.query.users.findFirst({
			where: eq(users.id, userId),
			columns: { lastRefreshWorkflowAttempt: true },
		})

		const shouldTrigger =
			bypassThrottle ||
			!userRecord?.lastRefreshWorkflowAttempt ||
			Date.now() - userRecord.lastRefreshWorkflowAttempt.getTime() > THROTTLE_MS

		if (!shouldTrigger) {
			return { status: 'throttled', triggered: false }
		}

		await db
			.update(users)
			.set({ lastRefreshWorkflowAttempt: new Date() })
			.where(eq(users.id, userId))

		const instance = await env.USER_REFRESH_WORKFLOW.create({
			id: createUserRefreshWorkflowId(source, userId),
			params: { userId, refreshMode },
		})

		logger.info('[WorkflowTrigger] Triggered user refresh workflow', {
			userId,
			source,
			bypassThrottle,
			refreshMode,
			workflowInstanceId: instance.id,
		})
		return {
			status: 'triggered',
			triggered: true,
			workflowInstanceId: instance.id,
		}
	} catch (error) {
		logger.error('[WorkflowTrigger] Failed to trigger user refresh workflow', {
			userId,
			source,
			error: error instanceof Error ? error.message : String(error),
		})
		return {
			status: 'failed',
			triggered: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}
