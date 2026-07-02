import { and, desc, eq } from 'drizzle-orm'

import type { DbClient } from '@repo/db-utils'

export const ALERT_SCOPE_TYPES = ['corporation', 'structure_group'] as const
export type AlertScopeType = (typeof ALERT_SCOPE_TYPES)[number]

export const ALERT_DESTINATION_TYPES = ['discord_channel', 'discord_user', 'discord_webhook', 'group'] as const
export type AlertDestinationType = (typeof ALERT_DESTINATION_TYPES)[number]

export interface AlertDestinationRecord {
	id: string
	scopeType: AlertScopeType
	scopeId: string
	alertType: string
	destinationType: AlertDestinationType
	discordServerId: string | null
	channelId: string | null
	coreUserId: string | null
	groupId: string | null
	destinationConfig: Record<string, unknown>
	isEnabled: boolean
	createdBy: string | null
	updatedBy: string | null
	createdAt: Date
	updatedAt: Date
}

export type AlertDestinationInsert = Omit<AlertDestinationRecord, 'id' | 'createdAt' | 'updatedAt'>

export interface AlertDestinationListItem extends AlertDestinationRecord {
	discordServer: {
		id: string
		guildId: string
		guildName: string
	} | null
}

export interface CreateAlertDestinationInput {
	scopeType: AlertScopeType
	scopeId: string
	alertType: string
	destinationType: AlertDestinationType
	discordServerId?: string | null
	channelId?: string | null
	coreUserId?: string | null
	groupId?: string | null
	destinationConfig?: Record<string, unknown>
	isEnabled?: boolean
	createdBy?: string | null
	updatedBy?: string | null
}

export interface UpdateAlertDestinationInput {
	alertType?: string
	destinationType?: AlertDestinationType
	discordServerId?: string | null
	channelId?: string | null
	coreUserId?: string | null
	groupId?: string | null
	destinationConfig?: Record<string, unknown>
	isEnabled?: boolean
	updatedBy?: string | null
}

export interface AlertDestinationTables {
	alertDestinations: any
	discordServers: any
}

export interface AlertDestinationHelperOptions {
	validateScope?: (db: DbClient<any>, scopeType: AlertScopeType, scopeId: string) => Promise<void> | void
}

export interface AlertDestinationTypeOption {
	value: AlertDestinationType
	label: string
}

const ALERT_DESTINATION_TYPE_LABELS: Record<AlertDestinationType, string> = {
	discord_channel: 'Discord Channel',
	discord_user: 'Discord User',
	discord_webhook: 'Discord Webhook',
	group: 'Group',
}

export function isAlertDestinationType(value: string): value is AlertDestinationType {
	return (ALERT_DESTINATION_TYPES as readonly string[]).includes(value)
}

export function validateDiscordWebhookDestinationConfig(
	destinationConfig?: Record<string, unknown> | null
): string | null {
	const webhookUrl = destinationConfig?.webhookUrl
	if (typeof webhookUrl !== 'string' || !webhookUrl.trim()) {
		return 'webhookUrl is required for discord_webhook destinations'
	}

	try {
		const parsedUrl = new URL(webhookUrl.trim())
		const isDiscordHost =
			parsedUrl.hostname === 'discord.com' ||
			parsedUrl.hostname.endsWith('.discord.com') ||
			parsedUrl.hostname === 'discordapp.com' ||
			parsedUrl.hostname.endsWith('.discordapp.com')
		if (parsedUrl.protocol !== 'https:' || !isDiscordHost || !parsedUrl.pathname.startsWith('/api/webhooks/')) {
			return 'webhookUrl must be a valid Discord webhook URL for discord_webhook destinations'
		}
	} catch {
		return 'webhookUrl must be a valid Discord webhook URL for discord_webhook destinations'
	}

	return null
}

export function getAlertDestinationTypeOptions(
	allowedTypes: readonly AlertDestinationType[]
): AlertDestinationTypeOption[] {
	return allowedTypes.map((type) => ({
		value: type,
		label: ALERT_DESTINATION_TYPE_LABELS[type],
	}))
}

export function validateAlertDestinationRequirements(input: {
	destinationType: AlertDestinationType
	discordServerId?: string | null
	channelId?: string | null
	coreUserId?: string | null
	groupId?: string | null
	destinationConfig?: Record<string, unknown> | null
}): string | null {
	if (input.destinationType === 'discord_channel') {
		if (!input.discordServerId || !input.channelId) {
			return 'discordServerId and channelId are required for discord_channel destinations'
		}
		return null
	}

	if (input.destinationType === 'discord_user') {
		if (!input.coreUserId) {
			return 'coreUserId is required for discord_user destinations'
		}
		return null
	}

	if (input.destinationType === 'discord_webhook') {
		return validateDiscordWebhookDestinationConfig(input.destinationConfig)
	}

	if (input.destinationType === 'group' && !input.groupId) {
		return 'groupId is required for group destinations'
	}

	return null
}

function validateDestinationShape(input: {
	destinationType: AlertDestinationType
	discordServerId?: string | null
	channelId?: string | null
	coreUserId?: string | null
	groupId?: string | null
	destinationConfig?: Record<string, unknown> | null
}): void {
	const error = validateAlertDestinationRequirements(input)
	if (error) {
		throw new Error(error)
	}
}

export async function listAlertDestinations(
	db: DbClient<any>,
	tables: AlertDestinationTables,
	scopeType: AlertScopeType,
	scopeId: string
): Promise<AlertDestinationListItem[]> {
	const rows = await db
		.select({
			id: tables.alertDestinations.id,
			scopeType: tables.alertDestinations.scopeType,
			scopeId: tables.alertDestinations.scopeId,
			alertType: tables.alertDestinations.alertType,
			destinationType: tables.alertDestinations.destinationType,
			discordServerId: tables.alertDestinations.discordServerId,
			channelId: tables.alertDestinations.channelId,
			coreUserId: tables.alertDestinations.coreUserId,
			groupId: tables.alertDestinations.groupId,
			destinationConfig: tables.alertDestinations.destinationConfig,
			isEnabled: tables.alertDestinations.isEnabled,
			createdBy: tables.alertDestinations.createdBy,
			updatedBy: tables.alertDestinations.updatedBy,
			createdAt: tables.alertDestinations.createdAt,
			updatedAt: tables.alertDestinations.updatedAt,
			discordServerTableId: tables.discordServers.id,
			discordServerGuildId: tables.discordServers.guildId,
			discordServerGuildName: tables.discordServers.guildName,
		} as any)
		.from(tables.alertDestinations)
		.leftJoin(tables.discordServers, eq(tables.alertDestinations.discordServerId, tables.discordServers.id))
		.where(and(eq(tables.alertDestinations.scopeType, scopeType), eq(tables.alertDestinations.scopeId, scopeId)))
		.orderBy(desc(tables.alertDestinations.createdAt))

	return rows.map((row: any) => ({
		id: String(row.id),
		scopeType: row.scopeType as AlertScopeType,
		scopeId: String(row.scopeId),
		alertType: String(row.alertType),
		destinationType: row.destinationType as AlertDestinationType,
		discordServerId: row.discordServerId ? String(row.discordServerId) : null,
		channelId: row.channelId ? String(row.channelId) : null,
		coreUserId: row.coreUserId ? String(row.coreUserId) : null,
		groupId: row.groupId ? String(row.groupId) : null,
		destinationConfig: (row.destinationConfig ?? {}) as Record<string, unknown>,
		isEnabled: Boolean(row.isEnabled),
		createdBy: row.createdBy ? String(row.createdBy) : null,
		updatedBy: row.updatedBy ? String(row.updatedBy) : null,
		createdAt: row.createdAt as Date,
		updatedAt: row.updatedAt as Date,
		discordServer: row.discordServerTableId
			? {
					id: String(row.discordServerTableId),
					guildId: String(row.discordServerGuildId),
					guildName: String(row.discordServerGuildName),
				}
			: null,
	}))
}

export async function createAlertDestination(
	db: DbClient<any>,
	tables: AlertDestinationTables,
	input: CreateAlertDestinationInput,
	options?: AlertDestinationHelperOptions
): Promise<AlertDestinationRecord> {
	validateDestinationShape(input)
	await options?.validateScope?.(db, input.scopeType, input.scopeId)

	const rows = await db
		.insert(tables.alertDestinations as any)
		.values({
			scopeType: input.scopeType,
			scopeId: input.scopeId,
			alertType: input.alertType,
			destinationType: input.destinationType,
			discordServerId: input.discordServerId ?? null,
			channelId: input.channelId ?? null,
			coreUserId: input.coreUserId ?? null,
			groupId: input.groupId ?? null,
			destinationConfig: input.destinationConfig ?? {},
			isEnabled: input.isEnabled ?? true,
			createdBy: input.createdBy ?? null,
			updatedBy: input.updatedBy ?? input.createdBy ?? null,
		})
		.returning()

	const row = (rows as any[])[0]
	if (!row) {
		throw new Error('Failed to create alert destination')
	}
	return row as AlertDestinationRecord
}

export async function updateAlertDestination(
	db: DbClient<any>,
	tables: AlertDestinationTables,
	scopeType: AlertScopeType,
	scopeId: string,
	destinationId: string,
	input: UpdateAlertDestinationInput,
	options?: AlertDestinationHelperOptions
): Promise<AlertDestinationRecord> {
	const existingRows = await db
		.select({
			id: tables.alertDestinations.id,
			scopeType: tables.alertDestinations.scopeType,
			scopeId: tables.alertDestinations.scopeId,
			alertType: tables.alertDestinations.alertType,
			destinationType: tables.alertDestinations.destinationType,
			discordServerId: tables.alertDestinations.discordServerId,
			channelId: tables.alertDestinations.channelId,
			coreUserId: tables.alertDestinations.coreUserId,
			groupId: tables.alertDestinations.groupId,
			destinationConfig: tables.alertDestinations.destinationConfig,
			isEnabled: tables.alertDestinations.isEnabled,
			createdBy: tables.alertDestinations.createdBy,
			updatedBy: tables.alertDestinations.updatedBy,
			createdAt: tables.alertDestinations.createdAt,
			updatedAt: tables.alertDestinations.updatedAt,
		} as any)
		.from(tables.alertDestinations)
		.where(and(
			eq(tables.alertDestinations.id, destinationId),
			eq(tables.alertDestinations.scopeType, scopeType),
			eq(tables.alertDestinations.scopeId, scopeId)
		))
		.limit(1)

	const existing = existingRows[0]
	if (!existing) {
		throw new Error('Alert destination not found')
	}

	const nextDestinationType = input.destinationType ?? (existing.destinationType as AlertDestinationType)
	validateDestinationShape({
		destinationType: nextDestinationType,
		discordServerId: input.discordServerId ?? (existing.discordServerId as string | null),
		channelId: input.channelId ?? (existing.channelId as string | null),
		coreUserId: input.coreUserId ?? (existing.coreUserId as string | null),
		groupId: input.groupId ?? (existing.groupId as string | null),
		destinationConfig:
			input.destinationConfig ?? (existing.destinationConfig as Record<string, unknown> | null),
	})
	await options?.validateScope?.(db, scopeType, scopeId)

	const rows = await db
		.update(tables.alertDestinations as any)
		.set({
			...(input.alertType !== undefined ? { alertType: input.alertType } : {}),
			...(input.destinationType !== undefined ? { destinationType: input.destinationType } : {}),
			...(input.discordServerId !== undefined ? { discordServerId: input.discordServerId } : {}),
			...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
			...(input.coreUserId !== undefined ? { coreUserId: input.coreUserId } : {}),
			...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
			...(input.destinationConfig !== undefined
				? { destinationConfig: input.destinationConfig }
				: {}),
			...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
			updatedBy: input.updatedBy ?? (existing.updatedBy as string | null),
			updatedAt: new Date(),
		})
		.where(eq(tables.alertDestinations.id, destinationId))
		.returning()

	const updated = (rows as any[])[0]
	if (!updated) {
		throw new Error('Failed to update alert destination')
	}
	return updated as AlertDestinationRecord
}

export async function deleteAlertDestination(
	db: DbClient<any>,
	tables: AlertDestinationTables,
	scopeType: AlertScopeType,
	scopeId: string,
	destinationId: string,
	options?: AlertDestinationHelperOptions
): Promise<void> {
	await options?.validateScope?.(db, scopeType, scopeId)
	const existingRows = await db
		.select({
			id: tables.alertDestinations.id,
		} as any)
		.from(tables.alertDestinations)
		.where(and(
			eq(tables.alertDestinations.id, destinationId),
			eq(tables.alertDestinations.scopeType, scopeType),
			eq(tables.alertDestinations.scopeId, scopeId)
		))
		.limit(1)

	if (existingRows.length === 0) {
		throw new Error('Alert destination not found')
	}

	await db.delete(tables.alertDestinations as any).where(eq(tables.alertDestinations.id, destinationId))
}
