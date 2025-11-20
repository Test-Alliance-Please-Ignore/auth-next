import { logger } from '@repo/hono-helpers'

/**
 * Discord embed colors
 */
const COLORS = {
	BLUE: 0x3b82f6, // Report started
	GREEN: 0x10b981, // Report completed
	RED: 0xef4444, // Report failed
}

/**
 * Metadata for Discord webhook notifications
 */
export interface WebhookMetadata {
	reportId: string
	requestorMainCharacterName: string
	subjectCharacterName: string
	subjectCharacterId: string
	corporationTicker: string
}

/**
 * Send Discord webhook notification for report started
 */
export async function sendReportStartedWebhook(
	webhookUrl: string,
	metadata: WebhookMetadata
): Promise<void> {
	try {
		await sendDiscordWebhook(webhookUrl, {
			embeds: [
				{
					title: 'Character Report Started',
					color: COLORS.BLUE,
					thumbnail: {
						url: `https://images.evetech.net/characters/${metadata.subjectCharacterId}/portrait?size=256`,
					},
					fields: [
						{
							name: 'Report Subject',
							value: metadata.subjectCharacterName,
							inline: true,
						},
						{
							name: 'Requested By',
							value: metadata.requestorMainCharacterName,
							inline: true,
						},
						{
							name: 'On behalf of',
							value: metadata.corporationTicker,
							inline: true,
						},
					],
					footer: {
						text: `Report ID: ${metadata.reportId}`,
					},
					timestamp: new Date().toISOString(),
				},
			],
		})

		logger.info('[Discord Webhook] Report started notification sent', {
			reportId: metadata.reportId,
		})
	} catch (error) {
		logger.error('[Discord Webhook] Failed to send report started notification', {
			reportId: metadata.reportId,
			error: error instanceof Error ? error.message : String(error),
		})
	}
}

/**
 * Send Discord webhook notification for report completed
 */
export async function sendReportCompletedWebhook(
	webhookUrl: string,
	metadata: WebhookMetadata,
	viewUrl: string
): Promise<void> {
	try {
		await sendDiscordWebhook(webhookUrl, {
			embeds: [
				{
					title: 'Character Report Completed',
					color: COLORS.GREEN,
					description: `[View Report](${viewUrl})`,
					thumbnail: {
						url: `https://images.evetech.net/characters/${metadata.subjectCharacterId}/portrait?size=256`,
					},
					fields: [
						{
							name: 'Report Subject',
							value: metadata.subjectCharacterName,
							inline: true,
						},
						{
							name: 'Requested By',
							value: metadata.requestorMainCharacterName,
							inline: true,
						},
						{
							name: 'On behalf of',
							value: metadata.corporationTicker,
							inline: true,
						},
					],
					footer: {
						text: `Report ID: ${metadata.reportId}`,
					},
					timestamp: new Date().toISOString(),
				},
			],
		})

		logger.info('[Discord Webhook] Report completed notification sent', {
			reportId: metadata.reportId,
		})
	} catch (error) {
		logger.error('[Discord Webhook] Failed to send report completed notification', {
			reportId: metadata.reportId,
			error: error instanceof Error ? error.message : String(error),
		})
	}
}

/**
 * Send Discord webhook notification for report failed
 */
export async function sendReportFailedWebhook(
	webhookUrl: string,
	metadata: WebhookMetadata,
	errorMessage: string
): Promise<void> {
	try {
		await sendDiscordWebhook(webhookUrl, {
			embeds: [
				{
					title: 'Character Report Failed',
					color: COLORS.RED,
					description: `**Error:** ${errorMessage}`,
					thumbnail: {
						url: `https://images.evetech.net/characters/${metadata.subjectCharacterId}/portrait?size=256`,
					},
					fields: [
						{
							name: 'Report Subject',
							value: metadata.subjectCharacterName,
							inline: true,
						},
						{
							name: 'Requested By',
							value: metadata.requestorMainCharacterName,
							inline: true,
						},
						{
							name: 'On behalf of',
							value: metadata.corporationTicker,
							inline: true,
						},
					],
					footer: {
						text: `Report ID: ${metadata.reportId}`,
					},
					timestamp: new Date().toISOString(),
				},
			],
		})

		logger.info('[Discord Webhook] Report failed notification sent', {
			reportId: metadata.reportId,
		})
	} catch (error) {
		logger.error('[Discord Webhook] Failed to send report failed notification', {
			reportId: metadata.reportId,
			error: error instanceof Error ? error.message : String(error),
		})
	}
}

/**
 * Send a Discord webhook request
 */
async function sendDiscordWebhook(webhookUrl: string, payload: unknown): Promise<void> {
	const response = await fetch(webhookUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payload),
	})

	if (!response.ok) {
		const errorText = await response.text().catch(() => 'Unknown error')
		throw new Error(`Discord webhook failed: ${response.status} - ${errorText}`)
	}
}
