export const WorkflowStatus = {
	Pending: 'pending',
	Created: 'created',
	NotCreated: 'not_created',
	Running: 'running',
	Completed: 'completed',
	Failed: 'failed',
} as const

export type WorkflowStatusValue = (typeof WorkflowStatus)[keyof typeof WorkflowStatus]

