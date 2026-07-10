export type NormalizedWorkflowStatus = 'queued' | 'running' | 'completed' | 'failed' | 'unknown'

export function normalizeWorkflowStatus(
	rawStatus: string | undefined,
	outputStatus?: string | undefined
): NormalizedWorkflowStatus {
	if (outputStatus === 'completed') return 'completed'
	if (outputStatus === 'failed') return 'failed'

	switch (rawStatus) {
		case 'queued':
		case 'waiting':
			return 'queued'
		case 'running':
			return 'running'
		case 'complete':
		case 'completed':
			return 'completed'
		case 'errored':
		case 'failed':
			return 'failed'
		default:
			return 'unknown'
	}
}
