export type StructurePermissionRole = 'viewer' | 'details' | 'sensitive' | 'manager'
export type CorporationAlertDestinationType =
	| 'discord_channel'
	| 'discord_user'
	| 'discord_webhook'
	| 'group'
export type StructureTab =
	| 'structures'
	| 'sovereignty'
	| 'skyhooks'
	| 'mining-citadels'
	| 'moon-drills'
export type StructureListSortDirection = 'asc' | 'desc'

export type StructureCommonListSortBy =
	| 'updatedAt'
	| 'nextStateAt'
	| 'fuel'
	| 'group'
	| 'syncStatus'
	| 'name'
	| 'corporation'
	| 'region'
	| 'system'
	| 'type'
	| 'state'

export const STRUCTURE_COMMON_LIST_SORT_FIELDS = [
	'updatedAt',
	'nextStateAt',
	'fuel',
	'group',
	'syncStatus',
	'name',
	'corporation',
	'region',
	'system',
	'type',
	'state',
] as const satisfies readonly StructureCommonListSortBy[]

export type StructureOperationalListSortBy = StructureCommonListSortBy

export type StructureMoonStructureListSortBy =
	| StructureCommonListSortBy
	| 'planet'
	| 'fuelBlocks'
	| 'magmaticGas'
	| 'moonMaterials'

export const STRUCTURE_MOON_STRUCTURE_LIST_SORT_FIELDS = [
	...STRUCTURE_COMMON_LIST_SORT_FIELDS,
	'planet',
	'fuelBlocks',
	'magmaticGas',
	'moonMaterials',
] as const satisfies readonly StructureMoonStructureListSortBy[]

export const FUEL_BLOCK_TYPE_IDS = new Set(['4051', '4246', '4247', '4312'])

export type StructureSkyhookListSortBy =
	| StructureCommonListSortBy
	| 'theftVulnerabilityStart'
	| 'skyhookSecureFullness'
	| 'skyhookSurplusFullness'
	| 'raidable'
	| 'workforce'

export const STRUCTURE_SKYHOOK_LIST_SORT_FIELDS = [
	...STRUCTURE_COMMON_LIST_SORT_FIELDS,
	'theftVulnerabilityStart',
	'skyhookSecureFullness',
	'skyhookSurplusFullness',
	'raidable',
	'workforce',
] as const satisfies readonly StructureSkyhookListSortBy[]

export type StructureSovereigntyListSortBy =
	| StructureCommonListSortBy
	| 'activityDefenseMultiplier'
	| 'magmaticGasEstimatedDepletionAt'
	| 'superionicIceEstimatedDepletionAt'

export const STRUCTURE_SOVEREIGNTY_LIST_SORT_FIELDS = [
	...STRUCTURE_COMMON_LIST_SORT_FIELDS,
	'activityDefenseMultiplier',
	'magmaticGasEstimatedDepletionAt',
	'superionicIceEstimatedDepletionAt',
] as const satisfies readonly StructureSovereigntyListSortBy[]

export type StructureListSortBy =
	| StructureCommonListSortBy
	| StructureMoonStructureListSortBy
	| StructureSkyhookListSortBy
	| StructureSovereigntyListSortBy

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
export const MOON_DRILL_STRUCTURE_TYPE_IDS = new Set([METENOX_MOON_DRILL_TYPE_ID])
export const STRUCTURE_REINFORCED_STATES = new Set([
	'shield',
	'armor',
	'hull',
	'anchoring',
	'unanchoring',
	'reinforced',
])

export const STRUCTURE_TABS: StructureTabDefinition[] = [
	{ tab: 'structures', label: 'Structures' },
	{ tab: 'sovereignty', label: 'Sovereignty' },
	{ tab: 'skyhooks', label: 'Skyhooks' },
	{ tab: 'mining-citadels', label: 'Mining Citadels' },
	{ tab: 'moon-drills', label: 'Moon Drills' },
]

const STRUCTURE_TAB_VALUES = new Set<string>(STRUCTURE_TABS.map((definition) => definition.tab))
const STRUCTURE_VULNERABILITY_STATE_VALUES = new Set<string>([
	'vulnerable',
	'invulnerable',
	'reinforced',
])

export function isStructureTab(value: unknown): value is StructureTab {
	return typeof value === 'string' && STRUCTURE_TAB_VALUES.has(value)
}

export function isStructureVulnerabilityState(
	value: unknown
): value is 'vulnerable' | 'invulnerable' | 'reinforced' {
	return typeof value === 'string' && STRUCTURE_VULNERABILITY_STATE_VALUES.has(value)
}

function normalizeStructureTypeId(value: string | null | undefined): string {
	return (value ?? '').trim()
}

export function getStructureTabForTypeId(
	typeId: string | null | undefined,
	typeName?: string | null | undefined
): StructureTab {
	const normalized = normalizeStructureTypeId(typeId)
	const normalizedName = (typeName ?? '').trim()

	if (
		normalizedName === METENOX_MOON_DRILL_TYPE_NAME ||
		MOON_DRILL_STRUCTURE_TYPE_IDS.has(normalized)
	) {
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
	return 'structures'
}

export function isReinforcedStructureState(state: string): boolean {
	return STRUCTURE_REINFORCED_STATES.has(state.trim().toLowerCase())
}

export interface StructureActor {
	id: string
	is_admin: boolean
	roles: string[]
}

export interface StructureListPagingQuery<
	TSortBy extends StructureListSortBy = StructureListSortBy,
> {
	page?: number
	pageSize?: number
	sortBy?: TSortBy
	sortDirection?: StructureListSortDirection
}

export interface StructureCommonListFilters {
	corporationId?: string
	assignedGroupId?: string
	lowPower?: 'true' | 'false'
	lowPowerAllowed?: 'true' | 'false'
	regionId?: string
	systemId?: string
	state?: string
	typeId?: string
}

export interface StructureCommonListQuery
	extends StructureListPagingQuery<StructureCommonListSortBy>,
		StructureCommonListFilters {}

export type StructureOperationalListFilters = StructureCommonListFilters

export type StructureOperationalListQuery = StructureCommonListQuery

export interface StructureListQuery extends StructureCommonListQuery {}

export interface StructureSovereigntyListFilters {
	corporationId?: string
	assignedGroupId?: string
	regionId?: string
	systemId?: string
	controllerAllianceId?: string
	vulnerabilityState?: 'vulnerable' | 'invulnerable' | 'reinforced'
}

export interface StructureSovereigntyListQuery
	extends StructureListPagingQuery<StructureSovereigntyListSortBy>,
		StructureSovereigntyListFilters {}

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

export interface StructureSovereigntyListSummary extends StructureListSummary {
	vulnerable: number
	invulnerable: number
	reinforced: number
	unknown: number
	magmaticGasBurningPerHour: string | null
	superionicIceBurningPerHour: string | null
	magmaticGasBurningSampleCount: number
	superionicIceBurningSampleCount: number
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

export type StructureSyncStatus = 'ok' | 'warning' | 'error'

export const STRUCTURE_SYNC_WARNING_STALE_MS = 12 * 60 * 60 * 1000
export const STRUCTURE_SYNC_ERROR_STALE_MS = 24 * 60 * 60 * 1000

export interface StructureIdentity {
	structureId: string
	corporationId: string
	corporationName: string
	systemId: string
	systemName: string | null
	regionId: string | null
	regionName: string | null
}

export interface StructureMoonGeography {
	moonId: string
	moonName: string | null
	planetId: string | null
	planetName: string | null
	systemId: string
	systemName: string | null
}

export interface StructureSyncState {
	syncStatus: StructureSyncStatus
	syncFailureReason: string | null
	lastSyncedAt: string | null
	updatedAt: string
	canViewDetails: boolean
}

export interface StructureConfig {
	assignedGroupId: string | null
	hidden: boolean
	lowPowerAllowed: boolean
}

export interface StructureListFilterOption {
	value: string
	label: string
}

export interface StructureCommonListFilterOptions {
	corporations: StructureListFilterOption[]
	assignedGroups: StructureListFilterOption[]
	regions: StructureListFilterOption[]
	systems: StructureListFilterOption[]
	states: StructureListFilterOption[]
	types: StructureListFilterOption[]
	alliances: StructureListFilterOption[]
}

export type StructureOperationalListFilterOptions = StructureCommonListFilterOptions

export interface StructureMoonStructureListFilterOptions extends StructureCommonListFilterOptions {
	planets: StructureListFilterOption[]
}

export interface StructureSkyhookListFilterOptions extends StructureMoonStructureListFilterOptions {
	raidableStates: StructureListFilterOption[]
}

export interface StructureListSummary {
	total: number
	lowFuel: number
	lowPower: number
	reinforced: number
	estimatedFuelBurnRatePerHour: string | null
	fuelBurnRateSampleCount: number
	skyhookHighestFillPercent?: number | null
	skyhookNextRaidableAt?: string | null
	skyhookNextRaidablePlanetName?: string | null
	skyhookCurrentRaidableCount?: number | null
	skyhookTotalWorkforce?: number | null
}

export interface StructureListBaseItem
	extends StructureIdentity,
		StructureSyncState,
		StructureConfig {
	name: string
	typeId: string
	typeName: string | null
	state: string
	nextStateAt: string | null
	fuelExpires: string | null
	fuelAmount: number | null
	lowPower: boolean
}

export interface StructureListItem extends StructureListBaseItem {}

export interface StructureModuleConfig {
	id: string
	lowFuelTimeThresholdHours: number
	criticalFuelTimeThresholdHours: number
	lowFuelAmountThreshold: number
	criticalFuelAmountThreshold: number
	updatedBy: string | null
	createdAt: Date
	updatedAt: Date
}

export interface StructureGroupSetting {
	id: string
	groupId: string
	createdBy: string | null
	updatedBy: string | null
	createdAt: Date
	updatedAt: Date
}

export interface StructureCorporationGroupDefault {
	corporationId: string
	corporationName?: string
	groupId: string | null
	updatedBy: string | null
	createdAt: Date
	updatedAt: Date
}

export interface StructureGroupAlertConfig {
	id: string
	groupId: string
	alertType: string
	destinationIds: string[]
	config: Record<string, unknown>
	isEnabled: boolean
	createdAt: Date
	updatedAt: Date
}

export interface StructureAlertDestinationRecord {
	id: string
	scopeType: 'corporation' | 'structure_group'
	scopeId: string
	alertType: string
	destinationType: CorporationAlertDestinationType
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

export interface StructureAlertDestination extends StructureAlertDestinationRecord {
	discordServer: {
		id: string
		guildId: string
		guildName: string
	} | null
}

export interface StructureInventoryItem {
	typeId: string
	typeName?: string | null
	quantity: number
	stackCount: number
}

export interface StructureInventoryBay {
	locationFlag: string
	label: string
	totalQuantity: number
	totalStacks: number
	items: StructureInventoryItem[]
}

export interface StructureSovereigntyListItem
	extends StructureIdentity,
		StructureSyncState,
		StructureConfig {
	state: string
	typeId: string
	typeName: string | null
	nextStateAt: string | null
	lowPower: boolean
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

export interface StructureSkyhookReagent {
	typeId: string
	typeName: string | null
	unitVolumeM3: number
	securedStock: number
	unsecuredStock: number
	securedVolumeM3: number
	unsecuredVolumeM3: number
	securedCapacityM3: number
	unsecuredCapacityM3: number
	securedFillPercent: number
	unsecuredFillPercent: number
	lastCycle: string
}

export interface StructureSkyhookListItem
	extends StructureIdentity,
		StructureSyncState,
		StructureConfig {
	state: string
	typeId: string
	typeName: string | null
	nextStateAt: string | null
	lowPower: boolean
	planetId: string
	planetName: string | null
	isActive: boolean
	effectiveWorkforce: number | null
	totalReagents: number
	totalSecuredStock: number
	totalUnsecuredStock: number
	totalSecuredVolumeM3: number
	totalUnsecuredVolumeM3: number
	securedCapacityM3: number
	unsecuredCapacityM3: number
	securedFillPercent: number
	unsecuredFillPercent: number
	reagents: StructureSkyhookReagent[]
	reinforcementTimerEnd: string | null
	theftVulnerabilityStart: string | null
	theftVulnerabilityEnd: string | null
	isRaidable: boolean
}

export interface StructureSkyhookListResponse {
	items: StructureSkyhookListItem[]
	pagination: {
		page: number
		pageSize: number
		totalCount: number
		totalPages: number
		hasNextPage: boolean
		hasPreviousPage: boolean
	}
	filterOptions: StructureSkyhookListFilterOptions
	summary: StructureListSummary
}

export interface StructureMoonDrillListItem
	extends StructureIdentity,
		StructureSyncState,
		StructureConfig,
		StructureMoonGeography {
	name: string
	state: string
	typeId: string
	typeName: string | null
	nextStateAt: string | null
	fuelExpires: string | null
	fuelAmount: number | null
	fuelBlockUnits: number
	magmaticGasUnits: number
	moonMaterialUnits: number
	moonMaterialVolumeM3: number
	lowPower: boolean
}

export interface StructureMiningCitadelListItem
	extends StructureIdentity,
		StructureSyncState,
		StructureConfig,
		StructureMoonGeography {
	name: string
	state: string
	typeId: string
	typeName: string | null
	nextStateAt: string | null
	fuelExpires: string | null
	fuelAmount: number | null
	lowPower: boolean
	extractionStartTime: string | null
	chunkArrivalTime: string | null
	naturalDecayTime: string | null
}

export interface StructureMoonDrillListResponse {
	items: StructureMoonDrillListItem[]
	pagination: {
		page: number
		pageSize: number
		totalCount: number
		totalPages: number
		hasNextPage: boolean
		hasPreviousPage: boolean
	}
	filterOptions: StructureMoonStructureListFilterOptions
	summary: StructureListSummary
}

export interface StructureMiningCitadelListResponse {
	items: StructureMiningCitadelListItem[]
	pagination: {
		page: number
		pageSize: number
		totalCount: number
		totalPages: number
		hasNextPage: boolean
		hasPreviousPage: boolean
	}
	filterOptions: StructureMoonStructureListFilterOptions
	summary: StructureListSummary
}

export interface StructureSovereigntyHubSummary {
	controllerAllianceId: string | null
	controllerAllianceName?: string | null
	reagentBayLastUpdated: string | null
	reagentCount: number
	magmaticGasQuantity: number
	magmaticGasBurningPerHour: number
	magmaticGasEstimatedDepletionAt: string | null
	superionicIceQuantity: number
	superionicIceBurningPerHour: number
	superionicIceEstimatedDepletionAt: string | null
	reagentBay: {
		lastUpdated: string
		reagents: StructureSovereigntyReagent[]
	}
	resources: {
		power: {
			allocated: number
			available: number
		}
		workforce: {
			allocated: number
			available: number
		}
	}
	upgrades: Array<{
		typeId: string
		typeName?: string | null
		powerState: string
	}>
	workforceTransport: StructureSovereigntyTransportState
	resourcePowerAllocated: number
	resourcePowerAvailable: number
	resourceWorkforceAllocated: number
	resourceWorkforceAvailable: number
	upgradeCount: number
	vulnerabilityWindowStart: string | null
	vulnerabilityWindowEnd: string | null
}

export interface StructureSovereigntySummary {
	claimType: 'alliance' | 'faction' | 'unclaimed'
	allianceId: string | null
	allianceName?: string | null
	corporationClaimantId: string | null
	factionId: string | null
	claimedSince: string | null
	sovereigntyHubStructureId: string | null
	isCapitalSystem: boolean | null
	vulnerabilityWindowStart: string | null
	vulnerabilityWindowEnd: string | null
	activityDefenseMultiplier: string | null
	militaryLevel: number | null
	industrialLevel: number | null
	strategicLevel: number | null
	hub: StructureSovereigntyHubSummary | null
}

export interface StructureSkyhookSummary {
	planetId: string | null
	planetName: string | null
	systemId: string | null
	systemName: string | null
	state: string
	isActive: boolean
	effectiveWorkforce: number | null
	totalReagents: number
	totalSecuredStock: number
	totalUnsecuredStock: number
	totalSecuredVolumeM3: number
	totalUnsecuredVolumeM3: number
	securedCapacityM3: number
	unsecuredCapacityM3: number
	securedFillPercent: number
	unsecuredFillPercent: number
	reagents: Array<{
		typeId: string
		typeName: string | null
		unitVolumeM3: number
		securedStock: number
		unsecuredStock: number
		securedVolumeM3: number
		unsecuredVolumeM3: number
		securedCapacityM3: number
		unsecuredCapacityM3: number
		securedFillPercent: number
		unsecuredFillPercent: number
		lastCycle: string
	}>
	reinforcementTimerEnd: string | null
	theftVulnerabilityStart: string | null
	theftVulnerabilityEnd: string | null
	isRaidable: boolean
}

export interface StructureMoonDrillSummary extends StructureMoonGeography {}

export interface StructureMiningCitadelSummary extends StructureMoonGeography {
	extractionStartTime: string | null
	chunkArrivalTime: string | null
	naturalDecayTime: string | null
}

export interface StructureFittingItem {
	locationFlag: string
	slotIndex: number
	flagName: 'High Slot' | 'Mid Slot' | 'Low Slot' | 'Rig Slot' | 'Subsystem Slot'
	typeId: string
	typeName: string | null
	quantity: number
	isConsumable?: boolean
}

export interface StructureDetailResult extends Omit<StructureListItem, 'canViewDetails'> {
	includeInStructureAssetSync: boolean
	canViewSensitive: boolean
	canEdit: boolean
	services: Array<{
		name: string
		state: string
	}>
	stateTimerStart: string | null
	stateTimerEnd: string | null
	unanchorsAt: string | null
	nextReinforceApply: string | null
	nextReinforceHour: number | null
	reinforceHour: number | null
	lastRefilledAt: string | null
	fuelBurnRate: string | null
	fuelUsage: {
		points: Array<{
			observedAt: string
			fuelBlockUnits: number | null
			fuelBurnRatePerHour: number | null
		}>
		lastRefilledAt: string | null
		sampleCount: number
	} | null
	sovereignty?: StructureSovereigntySummary | null
	skyhook?: StructureSkyhookSummary | null
	moonDrill?: StructureMoonDrillSummary | null
	miningExtraction?: StructureMiningCitadelSummary | null
	inventoryBays?: StructureInventoryBay[]
	fittingItems?: StructureFittingItem[]
}

export interface StructureListResponse<TItem = StructureListItem> {
	items: TItem[]
	pagination: {
		page: number
		pageSize: number
		totalCount: number
		totalPages: number
		hasNextPage: boolean
		hasPreviousPage: boolean
	}
	filterOptions: StructureListFilterOptions
	summary: StructureListSummary
}

export interface StructureSkyhookListFilters extends StructureOperationalListFilters {
	planetId?: string
	isRaidable?: 'true' | 'false'
}

export interface StructureSkyhookListQuery
	extends StructureListPagingQuery<StructureSkyhookListSortBy>,
		StructureSkyhookListFilters {}

export interface StructureMoonStructureListFilters extends StructureOperationalListFilters {
	planetId?: string
}

export interface StructureMoonStructureListQuery
	extends StructureListPagingQuery<StructureMoonStructureListSortBy>,
		StructureMoonStructureListFilters {}

export interface StructureMoonDrillListQuery extends StructureMoonStructureListQuery {
	corporationId?: string
	systemId?: string
	planetId?: string
}

export interface StructureMiningCitadelListQuery extends StructureMoonStructureListQuery {
	corporationId?: string
	systemId?: string
	planetId?: string
}

export type StructureListFilterOptions = StructureCommonListFilterOptions

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
	listStructures(actor: StructureActor, query?: StructureListQuery): Promise<StructureListResponse>
	listSovereigntyStructures(
		actor: StructureActor,
		query?: StructureSovereigntyListQuery
	): Promise<StructureSovereigntyListResponse>
	listSkyhookStructures(
		actor: StructureActor,
		query?: StructureSkyhookListQuery
	): Promise<StructureSkyhookListResponse>
	listMoonDrillStructures(
		actor: StructureActor,
		query?: StructureMoonDrillListQuery
	): Promise<StructureMoonDrillListResponse>
	listMiningCitadelStructures(
		actor: StructureActor,
		query?: StructureMiningCitadelListQuery
	): Promise<StructureMiningCitadelListResponse>
	getStructureDetail(
		actor: StructureActor,
		structureId: string
	): Promise<StructureDetailResult | null>
	updateStructureConfig(
		actor: StructureActor,
		structureId: string,
		input: UpdateStructureConfigInput
	): Promise<StructureDetailResult | null>
	getStructureModuleConfig(actor: StructureActor): Promise<StructureModuleConfig>
	updateStructureModuleConfig(
		actor: StructureActor,
		input: UpdateStructureModuleConfigInput
	): Promise<StructureModuleConfig>
	syncCorporationStructures(
		corporationId: string,
		forceRefresh?: boolean
	): Promise<{ structureCount: number; stateChangeCount: number }>
	listStructureGroupSettings(actor: StructureActor): Promise<StructureGroupSetting[]>
	upsertStructureGroupSetting(
		actor: StructureActor,
		input: UpsertStructureGroupSettingInput
	): Promise<StructureGroupSetting>
	deleteStructureGroupSetting(
		actor: StructureActor,
		groupId: string
	): Promise<StructureGroupSetting | null>
	listStructureCorporationGroupDefaults(
		actor: StructureActor
	): Promise<StructureCorporationGroupDefault[]>
	upsertStructureCorporationDefault(
		actor: StructureActor,
		input: UpsertStructureCorporationDefaultInput
	): Promise<StructureCorporationGroupDefault>
	listStructureGroupAlertDestinations(
		actor: StructureActor,
		groupId: string
	): Promise<StructureAlertDestination[]>
	createStructureAlertDestination(
		actor: StructureActor,
		groupId: string,
		input: CreateStructureAlertDestinationRequest
	): Promise<StructureAlertDestinationRecord>
	updateStructureAlertDestination(
		actor: StructureActor,
		groupId: string,
		destinationId: string,
		input: UpdateStructureAlertDestinationRequest
	): Promise<StructureAlertDestinationRecord>
	deleteStructureAlertDestination(
		actor: StructureActor,
		groupId: string,
		destinationId: string
	): Promise<void>
	listStructureGroupAlertConfigs(
		actor: StructureActor,
		groupId: string
	): Promise<StructureGroupAlertConfig[]>
	createStructureGroupAlertConfig(
		actor: StructureActor,
		groupId: string,
		input: CreateStructureGroupAlertConfigRequest
	): Promise<StructureGroupAlertConfig>
	updateStructureGroupAlertConfig(
		actor: StructureActor,
		groupId: string,
		configId: string,
		input: UpdateStructureGroupAlertConfigRequest
	): Promise<StructureGroupAlertConfig>
	deleteStructureGroupAlertConfig(
		actor: StructureActor,
		groupId: string,
		configId: string
	): Promise<void>
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
		description:
			'Trigger alerts for time-based structures when the configured thresholds are crossed.',
		supportedDestinationTypes: ['discord_channel', 'discord_user', 'discord_webhook', 'group'],
	},
	{
		type: 'structure_fuel_amount_status',
		label: 'Jump Gate Fuel Status',
		description:
			'Trigger alerts for fuel-unit structures when the configured thresholds are crossed.',
		supportedDestinationTypes: ['discord_channel', 'discord_user', 'discord_webhook', 'group'],
	},
]

export * from './skyhook-metrics'
export * from './sovereignty-metrics'
