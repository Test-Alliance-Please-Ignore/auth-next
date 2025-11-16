import { DurableObject } from 'cloudflare:workers'

import { eq } from '@repo/db-utils'
import { createDb, workflowInstances, WorkflowStatus } from '@repo/orchestrator'

import type { WorkflowInstanceManager } from '@repo/orchestrator'
import type { Env } from './context'

/**
 * WorkflowInstanceManager Durable Object
 *
 * Singleton Durable Object (ID: 'default') that manages workflow instance status updates.
 * Uses PostgreSQL via Neon for persistent storage with a persistent database connection.
 *
 * This DO provides RPC methods to update workflow instance status, avoiding database
 * connection timeouts in workflows by maintaining a persistent connection.
 */
export class WorkflowInstanceManagerDO
	extends DurableObject<Env>
	implements WorkflowInstanceManager
{
	private db: ReturnType<typeof createDb>

	constructor(state: DurableObjectState, env: Env) {
		super(state, env)

		// Initialize database connection in constructor for persistence
		try {
			this.db = createDb(env.DATABASE_URL)
		} catch (error) {
			console.error('[WorkflowInstanceManagerDO] Failed to create database client', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
			throw error
		}
	}

	/**
	 * Mark a workflow instance as running
	 */
	async markRunning(workflowId: string): Promise<void> {
		try {
			await this.db
				.update(workflowInstances)
				.set({
					status: WorkflowStatus.Running,
					finished: false,
					failed: false,
					finishedAt: null,
					errorMessage: null,
					updatedAt: new Date(),
				})
				.where(eq(workflowInstances.id, workflowId))
		} catch (error) {
			console.error('[WorkflowInstanceManagerDO] Failed to mark workflow as running', {
				workflowId,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
			throw error
		}
	}

	/**
	 * Mark a workflow instance as completed
	 */
	async markCompleted(workflowId: string): Promise<void> {
		try {
			const now = new Date()
			await this.db
				.update(workflowInstances)
				.set({
					status: WorkflowStatus.Completed,
					finished: true,
					failed: false,
					finishedAt: now,
					errorMessage: null,
					updatedAt: now,
				})
				.where(eq(workflowInstances.id, workflowId))
		} catch (error) {
			console.error('[WorkflowInstanceManagerDO] Failed to mark workflow as completed', {
				workflowId,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
			throw error
		}
	}

	/**
	 * Mark a workflow instance as failed
	 */
	async markFailed(workflowId: string, errorMessage: string): Promise<void> {
		try {
			const now = new Date()
			await this.db
				.update(workflowInstances)
				.set({
					status: WorkflowStatus.Failed,
					finished: true,
					failed: true,
					finishedAt: now,
					errorMessage,
					updatedAt: now,
				})
				.where(eq(workflowInstances.id, workflowId))
		} catch (error) {
			console.error('[WorkflowInstanceManagerDO] Failed to mark workflow as failed', {
				workflowId,
				errorMessage,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
			throw error
		}
	}
}

export { WorkflowInstanceManagerDO as WorkflowInstanceManager }
