import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import {
	and,
	desc,
	eq,
} from '@repo/db-utils'

import {
	corporationAlertRegistry,
	getCorporationAlertTypeDefinitions,
	isCorporationAlertDestinationType,
	isCorporationAlertType,
	type CorporationAlertDestinationRecord,
	type CorporationAlertPayloadByType,
	type CorporationAlertType,
} from '../lib/corporation-alerts'
import {
	corporationAlertDestinations,
	managedCorporations,
	discordServers,
} from '../db/schema'
import type * as schema from '../db/schema'

import type { Discord } from '@repo/discord'
import type { DbClient } from '../db'
import type { Env } from '../context'

export type CorporationAlertDestinationRow = typeof corporationAlertDestinations.$inferSelect
export type CorporationAlertDestinationInsert = typeof corporationAlertDestinations.$inferInsert

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
	destinationConfig?: Record<string, unknown>
	isEnabled?: boolean
	updatedBy?: string | null
}

export interface DispatchCorporationAlertInput {
	corporationId: string
	alertType: CorporationAlertType
	payload: CorporationAlertPayloadByType[CorporationAlertType]
}

export function listCorporationAlertTypes() {
	return getCorporationAlertTypeDefinitions()
}

export async function listCorporationAlertDestinations(
	db: DbClient<typeof schema>,
	corporationId: string
): Promise<CorporationAlertDestinationListItem[]> {
	const rows = await db.query.corporationAlertDestinations.findMany({
		where: eq(corporationAlertDestinations.corporationId, corporationId),
		with: {
			discordServer: {
				columns: {
					id: true,
					guildId: true,
					guildName: true,
				},
			},
		},
		orderBy: desc(corporationAlertDestinations.createdAt),
	})

	return rows.map((row) => ({
		...row,
		discordServer: row.discordServer
			? {
					id: row.discordServer.id,
					guildId: row.discordServer.guildId,
					guildName: row.discordServer.guildName,
				}
			: null,
	}))
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

	const [row] = await db
		.insert(corporationAlertDestinations)
		.values({
			corporationId: input.corporationId,
			alertType: input.alertType,
			destinationType: input.destinationType,
			discordServerId: input.discordServerId ?? null,
			channelId: input.channelId ?? null,
			coreUserId: input.coreUserId ?? null,
			destinationConfig: input.destinationConfig ?? {},
			isEnabled: input.isEnabled ?? true,
			createdBy: input.createdBy ?? null,
			updatedBy: input.updatedBy ?? input.createdBy ?? null,
		})
		.returning()

	return row
}

export async function updateCorporationAlertDestination(
	db: DbClient<typeof schema>,
	corporationId: string,
	destinationId: string,
	input: UpdateCorporationAlertDestinationInput
): Promise<CorporationAlertDestinationRow> {
	const existing = await db.query.corporationAlertDestinations.findFirst({
		where: and(
			eq(corporationAlertDestinations.id, destinationId),
			eq(corporationAlertDestinations.corporationId, corporationId)
		),
	})

	if (!existing) {
		throw new Error('Alert destination not found')
	}

	if (input.alertType !== undefined && !isCorporationAlertType(input.alertType)) {
		throw new Error(`Unsupported alert type: ${input.alertType}`)
	}

	if (input.destinationType !== undefined && !isCorporationAlertDestinationType(input.destinationType)) {
		throw new Error(`Unsupported alert destination type: ${input.destinationType}`)
	}

	const [updated] = await db
		.update(corporationAlertDestinations)
		.set({
			...(input.alertType !== undefined ? { alertType: input.alertType } : {}),
			...(input.destinationType !== undefined ? { destinationType: input.destinationType } : {}),
			...(input.discordServerId !== undefined ? { discordServerId: input.discordServerId } : {}),
			...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
			...(input.coreUserId !== undefined ? { coreUserId: input.coreUserId } : {}),
			...(input.destinationConfig !== undefined
				? { destinationConfig: input.destinationConfig }
				: {}),
			...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
			updatedBy: input.updatedBy ?? existing.updatedBy,
			updatedAt: new Date(),
		})
		.where(eq(corporationAlertDestinations.id, destinationId))
		.returning()

	return updated
}

export async function deleteCorporationAlertDestination(
	db: DbClient<typeof schema>,
	corporationId: string,
	destinationId: string
): Promise<void> {
	const existing = await db.query.corporationAlertDestinations.findFirst({
		where: and(
			eq(corporationAlertDestinations.id, destinationId),
			eq(corporationAlertDestinations.corporationId, corporationId)
		),
	})

	if (!existing) {
		throw new Error('Alert destination not found')
	}

	await db.delete(corporationAlertDestinations).where(eq(corporationAlertDestinations.id, destinationId))
}

export async function dispatchCorporationAlert(
	env: Env,
	db: DbClient<typeof schema>,
	input: DispatchCorporationAlertInput
): Promise<{
	alertType: CorporationAlertType
	destinationCount: number
	sentCount: number
	failedCount: number
}> {
	const alertDefinition = corporationAlertRegistry[input.alertType]
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
		db.query.corporationAlertDestinations.findMany({
			where: and(
				eq(corporationAlertDestinations.corporationId, input.corporationId),
				eq(corporationAlertDestinations.alertType, input.alertType),
				eq(corporationAlertDestinations.isEnabled, true)
			),
			orderBy: desc(corporationAlertDestinations.createdAt),
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

	const payload = {
		...input.payload,
		corporationName: corporation.name,
	}
	const message = alertDefinition.buildMessage(payload)
	const discordStub = getStub<Discord>(env.DISCORD, 'default')

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
