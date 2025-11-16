import type { NotificationTransportResult } from '@repo/notification-transport-base'

/**
 * Execute a transport via Cloudflare Queue (async fire-and-forget)
 */
export async function executeQueueTransport(
	queue: Queue,
	params: unknown
): Promise<NotificationTransportResult> {
	try {
		// Send message to queue
		await queue.send(params)

		return {
			success: true,
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error : new Error(String(error)),
		}
	}
}

