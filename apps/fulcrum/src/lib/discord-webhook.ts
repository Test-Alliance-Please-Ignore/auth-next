import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import type { Discord, MessageContent } from '@repo/discord'

import type { Env } from '../context'

/**
 * Discord embed colors
 */
const COLORS = {
	BLUE: 0x3b82f6, // Report started
	GREEN: 0x10b981, // Report completed
	RED: 0xef4444, // Report failed
}

/**
 * Metadata for Discord notifications
 */
export interface WebhookMetadata {
	reportId: string
	requestorMainCharacterName: string
	subjectCharacterName: string
	subjectCharacterId: string
	corporationTicker: string
}

/**
 * Send Discord direct message notification for report started
 */
export async function sendReportStartedDM(
	env: Env,
	requestorUserId: string,
	metadata: WebhookMetadata
): Promise<void> {
	try {
		const discordStub = getStub<Discord>(env.DISCORD, 'default')

		const message: MessageContent = {
			content: '',
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
		}

		const result = await discordStub.sendDirectMessage(requestorUserId, message)

		if (!result.success) {
			logger.warn('[Discord DM] Failed to send report started notification', {
				reportId: metadata.reportId,
				requestorUserId,
				error: result.error,
			})
		} else {
			logger.info('[Discord DM] Report started notification sent', {
				reportId: metadata.reportId,
				requestorUserId,
			})
		}
	} catch (error) {
		// Log but don't fail - DM failures should not block workflow
		logger.error('[Discord DM] Failed to send report started notification', {
			reportId: metadata.reportId,
			requestorUserId,
			error: error instanceof Error ? error.message : String(error),
		})
	}
}

/**
 * Send Discord direct message notification for report completed
 */
export async function sendReportCompletedDM(
	env: Env,
	requestorUserId: string,
	metadata: WebhookMetadata,
	viewUrl: string
): Promise<void> {
	try {
		const discordStub = getStub<Discord>(env.DISCORD, 'default')

		const message: MessageContent = {
			content: '',
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
		}

		const result = await discordStub.sendDirectMessage(requestorUserId, message)

		if (!result.success) {
			logger.warn('[Discord DM] Failed to send report completed notification', {
				reportId: metadata.reportId,
				requestorUserId,
				error: result.error,
			})
		} else {
			logger.info('[Discord DM] Report completed notification sent', {
				reportId: metadata.reportId,
				requestorUserId,
			})
		}
	} catch (error) {
		// Log but don't fail - DM failures should not block workflow
		logger.error('[Discord DM] Failed to send report completed notification', {
			reportId: metadata.reportId,
			requestorUserId,
			error: error instanceof Error ? error.message : String(error),
		})
	}
}

/**
 * Send Discord direct message notification for report failed
 */
export async function sendReportFailedDM(
	env: Env,
	requestorUserId: string,
	metadata: WebhookMetadata,
	errorMessage: string
): Promise<void> {
	try {
		const discordStub = getStub<Discord>(env.DISCORD, 'default')

		const message: MessageContent = {
			content: '',
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
		}

		const result = await discordStub.sendDirectMessage(requestorUserId, message)

		if (!result.success) {
			logger.warn('[Discord DM] Failed to send report failed notification', {
				reportId: metadata.reportId,
				requestorUserId,
				error: result.error,
			})
		} else {
			logger.info('[Discord DM] Report failed notification sent', {
				reportId: metadata.reportId,
				requestorUserId,
			})
		}
	} catch (error) {
		// Log but don't fail - DM failures should not block workflow
		logger.error('[Discord DM] Failed to send report failed notification', {
			reportId: metadata.reportId,
			requestorUserId,
			error: error instanceof Error ? error.message : String(error),
		})
	}
}
