import { alertDestinations, discordServers } from '../db/schema'

import {
	createAlertDestination as createSharedAlertDestination,
	deleteAlertDestination as deleteSharedAlertDestination,
	listAlertDestinations as listSharedAlertDestinations,
	updateAlertDestination as updateSharedAlertDestination,
	type AlertDestinationInsert as SharedAlertDestinationInsert,
	type AlertDestinationListItem,
	type AlertDestinationRecord,
	type AlertDestinationType,
	type AlertScopeType,
} from '@repo/alert-destinations'

import type { DbClient } from '../db'
import type * as schema from '../db/schema'

export type AlertDestinationRow = AlertDestinationRecord
export type AlertDestinationInsert = SharedAlertDestinationInsert

export { type AlertDestinationListItem, type AlertDestinationType, type AlertScopeType }

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

const tables = {
	alertDestinations,
	discordServers,
}

export async function listAlertDestinations(
	db: DbClient<typeof schema>,
	scopeType: AlertScopeType,
	scopeId: string
): Promise<AlertDestinationListItem[]> {
	return listSharedAlertDestinations(db, tables, scopeType, scopeId)
}

export async function createAlertDestination(
	db: DbClient<typeof schema>,
	input: CreateAlertDestinationInput
): Promise<AlertDestinationRow> {
	return createSharedAlertDestination(db, tables, input)
}

export async function updateAlertDestination(
	db: DbClient<typeof schema>,
	scopeType: AlertScopeType,
	scopeId: string,
	destinationId: string,
	input: UpdateAlertDestinationInput
): Promise<AlertDestinationRow> {
	return updateSharedAlertDestination(db, tables, scopeType, scopeId, destinationId, input)
}

export async function deleteAlertDestination(
	db: DbClient<typeof schema>,
	scopeType: AlertScopeType,
	scopeId: string,
	destinationId: string
): Promise<void> {
	await deleteSharedAlertDestination(db, tables, scopeType, scopeId, destinationId)
}
