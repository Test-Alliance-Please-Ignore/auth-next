/**
 * RPC interface for WorkflowInstanceManager Durable Object
 *
 * Provides methods to update workflow instance status via RPC calls.
 * This avoids database connection timeouts in workflows by using
 * persistent connections in the Durable Object.
 */
export interface WorkflowInstanceManager {
	/**
	 * Mark a workflow instance as running
	 */
	markRunning(workflowId: string): Promise<void>

	/**
	 * Mark a workflow instance as completed
	 */
	markCompleted(workflowId: string): Promise<void>

	/**
	 * Mark a workflow instance as failed
	 */
	markFailed(workflowId: string, errorMessage: string): Promise<void>
}

