import type { NotificationTransportResult } from '@repo/notification-transport-base'

/**
 * Execute a transport via HTTP webhook (external HTTP endpoint)
 */
export async function executeWebhookTransport(
	url: string,
	params: unknown
): Promise<NotificationTransportResult> {
	try {
		// Send HTTP POST to webhook URL
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(params),
		})

		if (!response.ok) {
			return {
				success: false,
				error: new Error(
					`Webhook request failed with status ${response.status}`
				),
			}
		}

		const responseData = await response.json().catch(() => null)

		return {
			success: true,
			metadata: responseData as Record<string, unknown>,
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error : new Error(String(error)),
		}
	}
}

