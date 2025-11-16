import type { NotificationTransportResult } from '@repo/notification-transport-base'

/**
 * Execute a transport via Durable Object binding
 */
export async function executeDurableObjectTransport(
	namespace: DurableObjectNamespace,
	params: unknown
): Promise<NotificationTransportResult> {
	try {
		// Get Durable Object stub (using destinationId for the ID)
		const destinationId = (params as { destinationId: string })
			.destinationId
		const id = namespace.idFromName(destinationId)
		const stub = namespace.get(id)

		// Call the Durable Object's send method
		const response = await (stub as unknown as {
			send(params: unknown): Promise<unknown>
		}).send(params)

		return {
			success: true,
			metadata: response as Record<string, unknown>,
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error : new Error(String(error)),
		}
	}
}

