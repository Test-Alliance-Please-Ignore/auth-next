import type { NotificationTransportResult } from '@repo/notification-transport-base'

/**
 * Execute a transport via service binding (WorkerEntrypoint RPC)
 */
export async function executeServiceBindingTransport(
	binding: Fetcher,
	params: unknown
): Promise<NotificationTransportResult> {
	try {
		// Call the service binding's send method
		// Service bindings implement WorkerEntrypoint with RPC methods
		const response = await (binding as unknown as {
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

