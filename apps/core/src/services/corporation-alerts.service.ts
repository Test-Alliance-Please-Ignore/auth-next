import { and, desc, eq } from '@repo/db-utils'
import { buildDiscordWebhookMessagePayload } from '@repo/discord'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { alertDestinations, discordServers, managedCorporations } from '../db/schema'
import {
	corporationAlertRegistry,
	getCorporationAlertTypeDefinitions,
	isCorporationAlertDestinationType,
	isCorporationAlertType,
} from '../lib/corporation-alerts'
import {
	createAlertDestination,
	deleteAlertDestination,
	listAlertDestinations,
	updateAlertDestination,
} from './alert-destinations.service'

import type { Discord, MessageContent, SendMessageResult } from '@repo/discord'
import type { Groups } from '@repo/groups'
import type { Env } from '../context'
import type { DbClient } from '../db'
import type * as schema from '../db/schema'
import type { AlertDestinationType, AlertRegistryEntry } from '../lib/alert-routing'
import type {
	CorporationAlertDestinationRecord,
	CorporationAlertPayloadByType,
	CorporationAlertType,
} from '../lib/corporation-alerts'
import type {
	AlertDestinationInsert,
	AlertDestinationListItem,
	AlertDestinationRow,
} from './alert-destinations.service'

export type CorporationAlertDestinationRow = AlertDestinationRow & { corporationId: string }
export type CorporationAlertDestinationInsert = AlertDestinationInsert

export interface CorporationAlertDestinationListItem extends CorporationAlertDestinationRecord {
	discordServer: {
		id: string
		guildId: string
		guildName: string
	} | null
}

export interface CreateCorporationAlertDestinationInput {
	corporationId: string
	alertType: string
	destinationType: string
	discordServerId?: string | null
	channelId?: string | null
	coreUserId?: string | null
	groupId?: string | null
	destinationConfig?: Record<string, unknown>
	isEnabled?: boolean
	createdBy?: string | null
	updatedBy?: string | null
}

export interface UpdateCorporationAlertDestinationInput {
	alertType?: string
	destinationType?: string
	discordServerId?: string | null
	channelId?: string | null
	coreUserId?: string | null
	groupId?: string | null
	destinationConfig?: Record<string, unknown>
	isEnabled?: boolean
	updatedBy?: string | null
}

export interface DispatchCorporationAlertInput<
	T extends CorporationAlertType = CorporationAlertType,
> {
	corporationId: string
	alertType: T
	payload: CorporationAlertPayloadByType[T]
}

function getDiscordWebhookUrl(destinationConfig: Record<string, unknown>): string | null {
	const webhookUrl = destinationConfig.webhookUrl
	if (typeof webhookUrl !== 'string') {
		return null
	}

	const trimmed = webhookUrl.trim()
	return trimmed.length > 0 ? trimmed : null
}

async function sendDiscordWebhookMessage(
	webhookUrl: string,
	message: MessageContent
): Promise<SendMessageResult> {
	try {
		const payload = buildDiscordWebhookMessagePayload(message)
		const response = await fetch(webhookUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(payload),
		})

		if (!response.ok) {
			const responseText = await response.text().catch(() => '')
			return {
				success: false,
				error: responseText || `Discord webhook request failed with status ${response.status}`,
			}
		}

		return { success: true }
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

export function listCorporationAlertTypes() {
	return getCorporationAlertTypeDefinitions()
}

export async function listCorporationAlertDestinations(
	db: DbClient<typeof schema>,
	corporationId: string
): Promise<CorporationAlertDestinationListItem[]> {
	const rows = await listAlertDestinations(db, 'corporation', corporationId)
	return rows.map(mapCorporationAlertDestination)
}

export async function createCorporationAlertDestination(
	db: DbClient<typeof schema>,
	input: CreateCorporationAlertDestinationInput
): Promise<CorporationAlertDestinationRow> {
	if (!isCorporationAlertType(input.alertType)) {
		throw new Error(`Unsupported alert type: ${input.alertType}`)
	}

	if (!isCorporationAlertDestinationType(input.destinationType)) {
		throw new Error(`Unsupported alert destination type: ${input.destinationType}`)
	}

	const row = await createAlertDestination(db, {
		scopeType: 'corporation',
		scopeId: input.corporationId,
		alertType: input.alertType,
		destinationType: input.destinationType,
		discordServerId: input.discordServerId ?? null,
		channelId: input.channelId ?? null,
		coreUserId: input.coreUserId ?? null,
		groupId: input.groupId ?? null,
		destinationConfig: input.destinationConfig,
		isEnabled: input.isEnabled,
		createdBy: input.createdBy,
		updatedBy: input.updatedBy,
	})

	return mapCorporationAlertDestination(row)
}

export async function updateCorporationAlertDestination(
	db: DbClient<typeof schema>,
	corporationId: string,
	destinationId: string,
	input: UpdateCorporationAlertDestinationInput
): Promise<CorporationAlertDestinationRow> {
	if (input.alertType !== undefined && !isCorporationAlertType(input.alertType)) {
		throw new Error(`Unsupported alert type: ${input.alertType}`)
	}

	if (
		input.destinationType !== undefined &&
		!isCorporationAlertDestinationType(input.destinationType)
	) {
		throw new Error(`Unsupported alert destination type: ${input.destinationType}`)
	}

	const updated = await updateAlertDestination(db, 'corporation', corporationId, destinationId, {
		alertType: input.alertType,
		destinationType: input.destinationType as AlertDestinationType | undefined,
		discordServerId: input.discordServerId,
		channelId: input.channelId,
		coreUserId: input.coreUserId,
		groupId: input.groupId,
		destinationConfig: input.destinationConfig,
		isEnabled: input.isEnabled,
		updatedBy: input.updatedBy,
	})

	return mapCorporationAlertDestination(updated)
}

export async function deleteCorporationAlertDestination(
	db: DbClient<typeof schema>,
	corporationId: string,
	destinationId: string
): Promise<void> {
	await deleteAlertDestination(db, 'corporation', corporationId, destinationId)
}

export async function dispatchCorporationAlert<T extends CorporationAlertType>(
	env: Env,
	db: DbClient<typeof schema>,
	input: DispatchCorporationAlertInput<T>
): Promise<{
	alertType: CorporationAlertType
	destinationCount: number
	sentCount: number
	failedCount: number
}> {
	const alertDefinition = corporationAlertRegistry[input.alertType] as AlertRegistryEntry<
		CorporationAlertPayloadByType[T]
	>
	if (!alertDefinition) {
		logger.warn('[CorporationAlerts] Unsupported alert type requested', {
			alertType: input.alertType,
			corporationId: input.corporationId,
		})
		return {
			alertType: input.alertType,
			destinationCount: 0,
			sentCount: 0,
			failedCount: 0,
		}
	}

	const [corporation, destinations] = await Promise.all([
		db.query.managedCorporations.findFirst({
			where: eq(managedCorporations.corporationId, input.corporationId),
			columns: {
				corporationId: true,
				name: true,
			},
		}),
		db.query.alertDestinations.findMany({
			where: and(
				eq(alertDestinations.scopeType, 'corporation'),
				eq(alertDestinations.scopeId, input.corporationId),
				eq(alertDestinations.alertType, input.alertType),
				eq(alertDestinations.isEnabled, true)
			),
			orderBy: desc(alertDestinations.createdAt),
		}),
	])

	if (!corporation) {
		throw new Error(`Corporation ${input.corporationId} was not found`)
	}

	if (destinations.length === 0) {
		return {
			alertType: input.alertType,
			destinationCount: 0,
			sentCount: 0,
			failedCount: 0,
		}
	}

	const payload: CorporationAlertPayloadByType[T] = {
		...input.payload,
		corporationName: corporation.name,
	}
	const message = alertDefinition.buildMessage(payload)
	const discordStub = getStub<Discord>(env.DISCORD, 'default')
	const groupsStub = getStub<Groups>(env.GROUPS, 'default')

	const results = await Promise.allSettled(
		destinations.map(async (destination) => {
			if (destination.destinationType === 'discord_channel') {
				if (!destination.discordServerId || !destination.channelId) {
					throw new Error('Discord channel destination is missing server or channel ID')
				}

				const server = await db.query.discordServers.findFirst({
					where: eq(discordServers.id, destination.discordServerId),
					columns: {
						id: true,
						guildId: true,
						guildName: true,
					},
				})

				if (!server) {
					throw new Error(`Discord server ${destination.discordServerId} was not found`)
				}

				return discordStub.sendMessage(server.guildId, destination.channelId, message)
			}

			if (destination.destinationType === 'discord_user') {
				if (!destination.coreUserId) {
					throw new Error('Discord user destination is missing core user ID')
				}

				return discordStub.sendDirectMessage(destination.coreUserId, message)
			}

			if (destination.destinationType === 'discord_webhook') {
				const webhookUrl = getDiscordWebhookUrl(destination.destinationConfig)
				if (!webhookUrl) {
					throw new Error('Discord webhook destination is missing webhook URL')
				}

				return sendDiscordWebhookMessage(webhookUrl, message)
			}

			if (destination.destinationType === 'group') {
				if (!destination.groupId) {
					throw new Error('Group destination is missing group ID')
				}

				// Group destinations currently fan out to the group's linked members.
				// The admin UI/config surface will supply owner/admin/member toggles, and
				// we can expand the groups RPC contract later if we need stricter targeting.
				const memberUserIds = await groupsStub.getGroupMemberUserIds(destination.groupId)
				if (memberUserIds.length === 0) {
					throw new Error(`Group ${destination.groupId} has no member recipients`)
				}

				const recipientResults = await Promise.allSettled(
					memberUserIds.map((userId) => discordStub.sendDirectMessage(userId, message))
				)

				const failedRecipients = recipientResults.filter((result) => result.status !== 'fulfilled')
				if (failedRecipients.length > 0) {
					throw new Error(
						`Failed to deliver group alert to ${failedRecipients.length} recipient(s)`
					)
				}

				return { success: true as const }
			}

			throw new Error(`Unsupported destination type ${destination.destinationType}`)
		})
	)

	let sentCount = 0
	let failedCount = 0
	for (const result of results) {
		if (result.status === 'fulfilled') {
			if (result.value.success) {
				sentCount += 1
			} else {
				failedCount += 1
				logger.warn('[CorporationAlerts] Failed to send alert destination', {
					alertType: input.alertType,
					corporationId: input.corporationId,
					error: result.value.error,
				})
			}
		} else {
			failedCount += 1
			logger.error('[CorporationAlerts] Error sending alert destination', {
				alertType: input.alertType,
				corporationId: input.corporationId,
				error: result.reason instanceof Error ? result.reason.message : String(result.reason),
			})
		}
	}

	logger.info('[CorporationAlerts] Dispatch complete', {
		alertType: input.alertType,
		corporationId: input.corporationId,
		destinationCount: destinations.length,
		sentCount,
		failedCount,
	})

	return {
		alertType: input.alertType,
		destinationCount: destinations.length,
		sentCount,
		failedCount,
	}
}

function mapCorporationAlertDestination(
	row: AlertDestinationListItem | AlertDestinationRow
): CorporationAlertDestinationListItem {
	return {
		...row,
		corporationId: row.scopeType === 'corporation' ? row.scopeId : row.scopeId,
		discordServer: 'discordServer' in row ? row.discordServer : null,
	}
}
