export type StructurePermissionRole = 'viewer' | 'manager' | 'sensitive'
export type CorporationAlertDestinationType = 'discord_channel' | 'discord_user' | 'group'
export type StructureListSortBy =
	| 'updatedAt'
	| 'nextStateAt'
	| 'fuel'
	| 'name'
	| 'corporation'
	| 'region'
	| 'system'
	| 'type'
	| 'state'
export type StructureListSortDirection = 'asc' | 'desc'

export interface StructureActor {
	id: string
	is_admin: boolean
	roles: string[]
}

export interface StructureListQuery {
	page?: number
	pageSize?: number
	corporationId?: string
	assignedGroupId?: string
	lowPower?: 'true' | 'false'
	lowPowerAllowed?: 'true' | 'false'
	regionId?: string
	systemId?: string
	state?: string
	typeId?: string
	sortBy?: StructureListSortBy
	sortDirection?: StructureListSortDirection
}

export interface UpdateStructureConfigInput {
	hidden?: boolean
	lowPowerAllowed?: boolean
	assignedGroupId?: string | null
	updatedBy?: string | null
}

export interface UpdateStructureModuleConfigInput {
	lowFuelTimeThresholdHours?: number
	criticalFuelTimeThresholdHours?: number
	lowFuelAmountThreshold?: number
	criticalFuelAmountThreshold?: number
	updatedBy?: string | null
}

export interface UpsertStructureGroupSettingInput {
	groupId: string
	updatedBy?: string | null
}

export interface DeleteStructureGroupSettingInput {
	groupId: string
}

export interface UpsertStructureCorporationDefaultInput {
	corporationId: string
	groupId: string | null
	updatedBy?: string | null
}

export interface CreateStructureAlertDestinationRequest {
	alertType: string
	destinationType: CorporationAlertDestinationType | string
	discordServerId?: string | null
	channelId?: string | null
	coreUserId?: string | null
	groupId?: string | null
	destinationConfig?: Record<string, unknown>
	isEnabled?: boolean
}

export interface UpdateStructureAlertDestinationRequest {
	alertType?: string
	destinationType?: CorporationAlertDestinationType | string
	discordServerId?: string | null
	channelId?: string | null
	coreUserId?: string | null
	groupId?: string | null
	destinationConfig?: Record<string, unknown>
	isEnabled?: boolean
}

export interface CreateStructureGroupAlertConfigRequest {
	alertType: string
	destinationIds: string[]
	config?: Record<string, unknown>
	isEnabled?: boolean
}

export interface UpdateStructureGroupAlertConfigRequest {
	alertType?: string
	destinationIds?: string[]
	config?: Record<string, unknown>
	isEnabled?: boolean
}

export interface StructuresWorker {
	listVisibleStructures(actor: StructureActor, query?: StructureListQuery): Promise<unknown>
	getVisibleStructureDetail(actor: StructureActor, structureId: string): Promise<unknown>
	updateStructureConfig(
		actor: StructureActor,
		structureId: string,
		input: UpdateStructureConfigInput
	): Promise<unknown>
	getStructureModuleConfig(actor: StructureActor): Promise<unknown>
	updateStructureModuleConfig(
		actor: StructureActor,
		input: UpdateStructureModuleConfigInput
	): Promise<unknown>
	syncCorporationStructures(
		corporationId: string,
		forceRefresh?: boolean
	): Promise<{ structureCount: number; stateChangeCount: number }>
	listStructureGroupSettings(actor: StructureActor): Promise<unknown>
	upsertStructureGroupSetting(
		actor: StructureActor,
		input: UpsertStructureGroupSettingInput
	): Promise<unknown>
	deleteStructureGroupSetting(actor: StructureActor, groupId: string): Promise<unknown>
	listStructureCorporationGroupDefaults(actor: StructureActor): Promise<unknown>
	upsertStructureCorporationDefault(
		actor: StructureActor,
		input: UpsertStructureCorporationDefaultInput
	): Promise<unknown>
	listStructureGroupAlertDestinations(actor: StructureActor, groupId: string): Promise<unknown>
	createStructureAlertDestination(
		actor: StructureActor,
		groupId: string,
		input: CreateStructureAlertDestinationRequest
	): Promise<unknown>
	updateStructureAlertDestination(
		actor: StructureActor,
		groupId: string,
		destinationId: string,
		input: UpdateStructureAlertDestinationRequest
	): Promise<unknown>
	deleteStructureAlertDestination(
		actor: StructureActor,
		groupId: string,
		destinationId: string
	): Promise<unknown>
	listStructureGroupAlertConfigs(actor: StructureActor, groupId: string): Promise<unknown>
	createStructureGroupAlertConfig(
		actor: StructureActor,
		groupId: string,
		input: CreateStructureGroupAlertConfigRequest
	): Promise<unknown>
	updateStructureGroupAlertConfig(
		actor: StructureActor,
		groupId: string,
		configId: string,
		input: UpdateStructureGroupAlertConfigRequest
	): Promise<unknown>
	deleteStructureGroupAlertConfig(
		actor: StructureActor,
		groupId: string,
		configId: string
	): Promise<unknown>
}

export interface StructureAlertTypeDefinition {
	type: string
	label: string
	description: string
	supportedDestinationTypes: CorporationAlertDestinationType[]
}

export const STRUCTURE_ALERT_TYPES: StructureAlertTypeDefinition[] = [
	{
		type: 'structure_state_changed',
		label: 'Structure State Changed',
		description: 'Trigger alerts when a structure enters a configured destination state.',
		supportedDestinationTypes: ['discord_channel', 'discord_user', 'group'],
	},
	{
		type: 'structure_fuel_time_status',
		label: 'Structure Fuel Status',
		description: 'Trigger alerts for time-based structures when the configured thresholds are crossed.',
		supportedDestinationTypes: ['discord_channel', 'discord_user', 'group'],
	},
	{
		type: 'structure_fuel_amount_status',
		label: 'Jump Gate Fuel Status',
		description: 'Trigger alerts for fuel-unit structures when the configured thresholds are crossed.',
		supportedDestinationTypes: ['discord_channel', 'discord_user', 'group'],
	},
]
