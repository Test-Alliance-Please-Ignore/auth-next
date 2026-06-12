import { alertDestinations, discordServers } from '../db'
import { assertStructureGroupConfigured } from './structures.service'

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

import type { DbClient } from '@repo/db-utils'
import type { DbSchema } from '../db'

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

async function validateStructureScope(
	db: DbClient<DbSchema>,
	scopeType: AlertScopeType,
	scopeId: string
): Promise<void> {
	if (scopeType !== 'structure_group') {
		return
	}

	await assertStructureGroupConfigured(db, scopeId)
}

export async function listAlertDestinations(
	db: DbClient<DbSchema>,
	scopeType: AlertScopeType,
	scopeId: string
): Promise<AlertDestinationListItem[]> {
	return listSharedAlertDestinations(db, tables, scopeType, scopeId)
}

export async function createAlertDestination(
	db: DbClient<DbSchema>,
	input: CreateAlertDestinationInput
): Promise<AlertDestinationRow> {
	return createSharedAlertDestination(db, tables, input, {
		validateScope: validateStructureScope,
	})
}

export async function updateAlertDestination(
	db: DbClient<DbSchema>,
	scopeType: AlertScopeType,
	scopeId: string,
	destinationId: string,
	input: UpdateAlertDestinationInput
): Promise<AlertDestinationRow> {
	return updateSharedAlertDestination(db, tables, scopeType, scopeId, destinationId, input, {
		validateScope: validateStructureScope,
	})
}

export async function deleteAlertDestination(
	db: DbClient<DbSchema>,
	scopeType: AlertScopeType,
	scopeId: string,
	destinationId: string
): Promise<void> {
	await deleteSharedAlertDestination(db, tables, scopeType, scopeId, destinationId, {
		validateScope: validateStructureScope,
	})
}
