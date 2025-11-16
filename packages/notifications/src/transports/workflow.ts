import type { NotificationTransportResult } from '@repo/notification-transport-base'

/**
 * Execute a transport via Cloudflare Workflow (durable async execution)
 */
export async function executeWorkflowTransport(
	workflow: Workflow,
	params: unknown
): Promise<NotificationTransportResult> {
	try {
		// Create workflow instance
		const destinationId = (params as { destinationId: string })
			.destinationId
		const workflowId = `notification-${destinationId}-${Date.now()}`
		const instance = await workflow.create({
			id: workflowId,
			params: params as Record<string, unknown>,
		})

		return {
			success: true,
			metadata: {
				workflowId: instance.id,
			},
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error : new Error(String(error)),
		}
	}
}

