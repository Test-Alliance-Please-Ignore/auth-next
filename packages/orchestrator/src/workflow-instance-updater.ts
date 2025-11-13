import { eq } from '@repo/db-utils'

import { createDb } from './db'
import { workflowInstances } from './db/schema'
import { WorkflowStatus } from './status'

import type { OrchestratorDbClient } from './db'

export interface WorkflowInstanceUpdaterContext {
	/**
	 * Database URL for the orchestrator database.
	 */
	readonly databaseUrl: string
}

export interface WorkflowBaseUpdate {
	readonly status: (typeof WorkflowStatus)[keyof typeof WorkflowStatus]
	readonly finished?: boolean
	readonly failed?: boolean
	readonly finishedAt?: Date | null
	readonly errorMessage?: string | null
}

/**
 * Helper for updating workflow instance records from within running workflows.
 */
export class WorkflowInstanceUpdater {
	private readonly db: OrchestratorDbClient

	constructor(private readonly workflowId: string, databaseUrl: string) {
		this.db = createDb(databaseUrl)
	}

	async update(update: WorkflowBaseUpdate): Promise<void> {
		await this.db
			.update(workflowInstances)
			.set({
				status: update.status,
				finished: update.finished ?? false,
				failed: update.failed ?? false,
				finishedAt: update.finishedAt ?? null,
				errorMessage: update.errorMessage ?? null,
				updatedAt: new Date(),
			})
			.where(eq(workflowInstances.id, this.workflowId))
	}

	async markPending(): Promise<void> {
		await this.update({
			status: WorkflowStatus.Pending,
			finished: false,
			failed: false,
			finishedAt: null,
			errorMessage: null,
		})
	}

	async markCreated(): Promise<void> {
		await this.update({
			status: WorkflowStatus.Created,
			finished: false,
			failed: false,
			finishedAt: null,
			errorMessage: null,
		})
	}

	async markRunning(): Promise<void> {
		await this.update({
			status: WorkflowStatus.Running,
			finished: false,
			failed: false,
			finishedAt: null,
			errorMessage: null,
		})
	}

	async markCompleted(): Promise<void> {
		const now = new Date()
		await this.update({
			status: WorkflowStatus.Completed,
			finished: true,
			failed: false,
			finishedAt: now,
			errorMessage: null,
		})
	}

	async markFailed(error: unknown): Promise<void> {
		const errorMessage = error instanceof Error ? error.message : String(error)
		const now = new Date()

		await this.update({
			status: WorkflowStatus.Failed,
			finished: true,
			failed: true,
			finishedAt: now,
			errorMessage,
		})
	}

	async markNotCreated(error: unknown): Promise<void> {
		const errorMessage = error instanceof Error ? error.message : String(error)

		await this.update({
			status: WorkflowStatus.NotCreated,
			finished: false,
			failed: false,
			finishedAt: null,
			errorMessage,
		})
	}
}

export function createWorkflowInstanceUpdater(
	workflowId: string,
	databaseUrl: string
): WorkflowInstanceUpdater {
	return new WorkflowInstanceUpdater(workflowId, databaseUrl)
}

