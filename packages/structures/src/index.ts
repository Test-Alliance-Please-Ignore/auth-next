export type StructurePermissionRole = 'viewer' | 'details' | 'sensitive' | 'manager'
export type CorporationAlertDestinationType = 'discord_channel' | 'discord_user' | 'discord_webhook' | 'group'
export type StructureTab =
	| 'citadels'
	| 'sovereignty'
	| 'skyhooks'
	| 'navigation'
	| 'mining-citadels'
	| 'moon-drills'
export type StructureListSortBy =
	| 'updatedAt'
	| 'nextStateAt'
	| 'fuel'
	| 'activityDefenseMultiplier'
	| 'magmaticGasEstimatedDepletionAt'
	| 'superionicIceEstimatedDepletionAt'
	| 'name'
	| 'corporation'
	| 'region'
	| 'system'
	| 'type'
	| 'state'
export type StructureListSortDirection = 'asc' | 'desc'

export interface StructureTabDefinition {
	tab: StructureTab
	label: string
}

export const SOVEREIGNTY_HUB_TYPE_ID = '32458'
export const ORBITAL_SKYHOOK_TYPE_ID = '81080'
export const ANSIBLEX_JUMP_GATE_TYPE_ID = '35841'
export const TENEBREX_CYNO_JAMMER_TYPE_ID = '37534'
export const PHAROLUX_CYNO_BEACON_TYPE_ID = '35840'
export const METENOX_MOON_DRILL_TYPE_ID = '81826'
export const METENOX_MOON_DRILL_TYPE_NAME = 'Metenox Moon Drill'
export const MINING_CITADEL_TYPE_NAMES = new Set(['Athanor', 'Tatara'])

export const SOVEREIGNTY_STRUCTURE_TYPE_IDS = new Set([SOVEREIGNTY_HUB_TYPE_ID])
export const SKYHOOK_STRUCTURE_TYPE_IDS = new Set([ORBITAL_SKYHOOK_TYPE_ID])
export const NAVIGATION_STRUCTURE_TYPE_IDS = new Set([
	ANSIBLEX_JUMP_GATE_TYPE_ID,
	TENEBREX_CYNO_JAMMER_TYPE_ID,
	PHAROLUX_CYNO_BEACON_TYPE_ID,
])
export const MINING_STRUCTURE_TYPE_IDS = new Set([METENOX_MOON_DRILL_TYPE_ID])
export const STRUCTURE_REINFORCED_STATES = new Set([
	'shield',
	'armor',
	'hull',
	'anchoring',
	'unanchoring',
	'reinforced',
])

export const STRUCTURE_TABS: StructureTabDefinition[] = [
	{ tab: 'citadels', label: 'Citadels' },
	{ tab: 'sovereignty', label: 'Sovereignty' },
	{ tab: 'skyhooks', label: 'Skyhooks' },
	{ tab: 'navigation', label: 'Navigation' },
	{ tab: 'mining-citadels', label: 'Mining Citadels' },
	{ tab: 'moon-drills', label: 'Moon Drills' },
]

function normalizeStructureTypeId(value: string | null | undefined): string {
	return (value ?? '').trim()
}

export function getStructureTabForTypeId(
	typeId: string | null | undefined,
	typeName?: string | null | undefined
): StructureTab {
	const normalized = normalizeStructureTypeId(typeId)
	const normalizedName = (typeName ?? '').trim()

	if (normalizedName === METENOX_MOON_DRILL_TYPE_NAME || MINING_STRUCTURE_TYPE_IDS.has(normalized)) {
		return 'moon-drills'
	}

	if (MINING_CITADEL_TYPE_NAMES.has(normalizedName)) {
		return 'mining-citadels'
	}
	if (SOVEREIGNTY_STRUCTURE_TYPE_IDS.has(normalized)) {
		return 'sovereignty'
	}
	if (SKYHOOK_STRUCTURE_TYPE_IDS.has(normalized)) {
		return 'skyhooks'
	}
	if (NAVIGATION_STRUCTURE_TYPE_IDS.has(normalized)) {
		return 'navigation'
	}

	return 'citadels'
}

export function isReinforcedStructureState(state: string): boolean {
	return STRUCTURE_REINFORCED_STATES.has(state.trim().toLowerCase())
}

export interface StructureActor {
	id: string
	is_admin: boolean
	roles: string[]
}

export interface StructureListPagingQuery {
	page?: number
	pageSize?: number
	sortBy?: StructureListSortBy
	sortDirection?: StructureListSortDirection
}

export interface StructureCommonListQuery extends StructureListPagingQuery {
	corporationId?: string
	assignedGroupId?: string
	lowPower?: 'true' | 'false'
	lowPowerAllowed?: 'true' | 'false'
	regionId?: string
	systemId?: string
	state?: string
	typeId?: string
}

export interface StructureCitadelListQuery extends StructureListPagingQuery {
	corporationId?: string
	assignedGroupId?: string
	lowPower?: 'true' | 'false'
	lowPowerAllowed?: 'true' | 'false'
	regionId?: string
	systemId?: string
	state?: string
	typeId?: string
}

export interface StructureNavigationListQuery extends StructureCommonListQuery {
	corporationId?: string
	systemId?: string
}

export interface StructureSovereigntyListQuery extends StructureListPagingQuery {
	corporationId?: string
	assignedGroupId?: string
	regionId?: string
	systemId?: string
	controllerAllianceId?: string
	vulnerabilityState?: 'vulnerable' | 'invulnerable' | 'reinforced'
}

export interface StructureSovereigntyListFilterOption {
	value: string
	label: string
}

export interface StructureSovereigntyListFilterOptions {
	corporations: StructureSovereigntyListFilterOption[]
	assignedGroups: StructureSovereigntyListFilterOption[]
	regions: StructureSovereigntyListFilterOption[]
	systems: StructureSovereigntyListFilterOption[]
	controllerAlliances: StructureSovereigntyListFilterOption[]
	vulnerabilityStates: StructureSovereigntyListFilterOption[]
}

export interface StructureSovereigntyListSummary {
	total: number
	vulnerable: number
	invulnerable: number
	reinforced: number
	unknown: number
}

export interface StructureSovereigntyReagent {
	typeId: string
	typeName?: string | null
	amount: number
	burningPerHour: number
	lastCycle: string
}

export interface StructureSovereigntyTransportEntry {
	solarSystemId: string
	amount: number | null
}

export type StructureSovereigntyTransportMode = 'import' | 'export' | 'transit' | 'unknown'

export interface StructureSovereigntyTransportSection {
	mode: StructureSovereigntyTransportMode
	systems: StructureSovereigntyTransportEntry[]
}

export interface StructureSovereigntyTransportState {
	configuration: StructureSovereigntyTransportSection
	state: StructureSovereigntyTransportSection
}

export interface StructureSovereigntyListItem {
	structureId: string
	corporationId: string
	corporationName: string
	systemId: string
	systemName: string | null
	regionId: string | null
	regionName: string | null
	name: string
	state: string
	typeId: string
	typeName: string | null
	nextStateAt: string | null
	fuelExpires: string | null
	fuelAmount: number | null
	lowPower: boolean
	hidden: boolean
	lowPowerAllowed: boolean
	assignedGroupId: string | null
	claimType: 'alliance' | 'faction' | 'unclaimed'
	allianceId: string | null
	allianceName: string | null
	controllerAllianceId: string | null
	controllerAllianceName: string | null
	corporationClaimantId: string | null
	factionId: string | null
	claimedSince: string | null
	sovereigntyHubStructureId: string | null
	vulnerabilityWindowStart: string | null
	vulnerabilityWindowEnd: string | null
	activityDefenseMultiplier: string | null
	militaryLevel: number | null
	industrialLevel: number | null
	strategicLevel: number | null
	fuelAccessListId: string | null
	reagentBayLastUpdated: string | null
	reagentCount: number
	magmaticGasQuantity: number
	magmaticGasBurningPerHour: number
	magmaticGasEstimatedDepletionAt: string | null
	superionicIceQuantity: number
	superionicIceBurningPerHour: number
	superionicIceEstimatedDepletionAt: string | null
	resourcePowerAllocated: number
	resourcePowerAvailable: number
	resourceWorkforceAllocated: number
	resourceWorkforceAvailable: number
	upgradeCount: number
	syncStatus: 'ok' | 'warning' | 'error'
	syncFailureReason: string | null
	lastSyncedAt: string | null
	canViewDetails: boolean
}

export interface StructureSovereigntyListResponse {
	items: StructureSovereigntyListItem[]
	pagination: {
		page: number
		pageSize: number
		totalCount: number
		totalPages: number
		hasNextPage: boolean
		hasPreviousPage: boolean
	}
	filterOptions: StructureSovereigntyListFilterOptions
	summary: StructureSovereigntyListSummary
}

export interface StructureOverviewMetrics {
	total: number
	lowFuel: number
	lowPower: number
	reinforced: number
	estimatedFuelBurnRatePerHour: string | null
	fuelBurnRateSampleCount: number
}

export interface StructureSkyhookListQuery extends StructureCommonListQuery {
	corporationId?: string
	systemId?: string
	planetId?: string
	isRaidable?: 'true' | 'false'
}

export interface StructureMiningListQuery extends StructureCommonListQuery {
	corporationId?: string
	systemId?: string
	planetId?: string
}

export type StructureListQuery = StructureCitadelListQuery

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
	listCitadelStructures(actor: StructureActor, query?: StructureCitadelListQuery): Promise<unknown>
	listNavigationStructures(actor: StructureActor, query?: StructureNavigationListQuery): Promise<unknown>
	listSovereigntyStructures(
		actor: StructureActor,
		query?: StructureSovereigntyListQuery
	): Promise<StructureSovereigntyListResponse>
	listSkyhookStructures(actor: StructureActor, query?: StructureSkyhookListQuery): Promise<unknown>
	listMiningStructures(actor: StructureActor, query?: StructureMiningListQuery): Promise<unknown>
	listMoonDrillStructures(actor: StructureActor, query?: StructureMiningListQuery): Promise<unknown>
	listMiningCitadelStructures(actor: StructureActor, query?: StructureMiningListQuery): Promise<unknown>
	getStructureOverviewMetrics(actor: StructureActor): Promise<StructureOverviewMetrics>
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
		supportedDestinationTypes: ['discord_channel', 'discord_user', 'discord_webhook', 'group'],
	},
	{
		type: 'structure_fuel_time_status',
		label: 'Structure Fuel Status',
		description: 'Trigger alerts for time-based structures when the configured thresholds are crossed.',
		supportedDestinationTypes: ['discord_channel', 'discord_user', 'discord_webhook', 'group'],
	},
	{
		type: 'structure_fuel_amount_status',
		label: 'Jump Gate Fuel Status',
		description: 'Trigger alerts for fuel-unit structures when the configured thresholds are crossed.',
		supportedDestinationTypes: ['discord_channel', 'discord_user', 'discord_webhook', 'group'],
	},
]
