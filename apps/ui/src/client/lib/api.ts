/**
 * API client for making requests to the core worker
 */

import { isDateRangeWithinOneYear } from '../features/srp/utils'
import { downloadTextFile } from './csv-utils'

import type {
	SidebarExternalLinkCreateInput,
	SidebarExternalLinkSummary,
	SidebarExternalLinkUpdateInput,
} from '@repo/admin'
import type { FreightRoute } from '@repo/freight'
import type { InventoryDisplayBay as SharedInventoryDisplayBay } from '@repo/inventory-display'
import type { UpdateSRPConfig } from '@repo/srp'
import type {
	StructureCitadelListQuery as RepoStructureCitadelListQuery,
	StructureMoonStructureListFilterOptions as RepoStructureMoonStructureListFilterOptions,
	StructureMoonDrillListItem as RepoStructureMoonDrillListItem,
	StructureMoonDrillListQuery as RepoStructureMoonDrillListQuery,
	StructureMoonDrillListResponse as RepoStructureMoonDrillListResponse,
	StructureMoonStructureListSortBy as RepoStructureMoonStructureListSortBy,
	StructureMiningCitadelListItem as RepoStructureMiningCitadelListItem,
	StructureMiningCitadelListQuery as RepoStructureMiningCitadelListQuery,
	StructureMiningCitadelListResponse as RepoStructureMiningCitadelListResponse,
	StructureNavigationListQuery as RepoStructureNavigationListQuery,
	StructureListSummary as RepoStructureListSummary,
	StructureCommonListQuery as RepoStructureCommonListQuery,
	StructureCommonListFilterOptions as RepoStructureCommonListFilterOptions,
	StructureCommonListSortBy as RepoStructureCommonListSortBy,
	StructureSkyhookListItem as RepoStructureSkyhookListItem,
	StructureSkyhookListFilterOptions as RepoStructureSkyhookListFilterOptions,
	StructureSkyhookListSortBy as RepoStructureSkyhookListSortBy,
	StructureSkyhookListResponse as RepoStructureSkyhookListResponse,
	StructureSkyhookListQuery as RepoStructureSkyhookListQuery,
	StructureSovereigntyListFilterOptions as RepoStructureSovereigntyListFilterOptions,
	StructureSovereigntyListFilterOption as RepoStructureSovereigntyListFilterOption,
	StructureSovereigntyListItem as RepoStructureSovereigntyListItem,
	StructureSovereigntyListResponse as RepoStructureSovereigntyListResponse,
	StructureSovereigntyListSummary as RepoStructureSovereigntyListSummary,
	StructureSovereigntyListQuery as RepoStructureSovereigntyListQuery,
	StructureSovereigntyListSortBy as RepoStructureSovereigntyListSortBy,
	StructureMoonDrillSummary as RepoStructureMoonDrillSummary,
	StructureMiningCitadelSummary as RepoStructureMiningCitadelSummary,
	StructureSovereigntyReagent,
	StructureSovereigntyTransportState,
} from '@repo/structures'
import type { TrackingSession } from '../features/fleet-tracking/types'
import type {
	RecentLossesResponse,
	RequestListResponse,
} from '../features/srp/types'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'
const API_REQUEST_TIMEOUT_MS = 30_000

export interface ApiError {
	message: string
	status: number
	requestInfo?: ApiRequestDebugInfo
}

export interface ApiRequestDebugInfo {
	url: string
	method: string
	payload?: unknown
	status?: number
	responseBody?: unknown
}

/**
 * Base error class for API errors
 */
export class BaseApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public requestInfo?: ApiRequestDebugInfo
	) {
		super(message)
		this.name = 'BaseApiError'
	}
}

/**
 * Network-related errors (fetch failures, timeouts, etc.)
 */
export class NetworkError extends Error {
	constructor(
		message?: string,
		public requestInfo?: ApiRequestDebugInfo
	) {
		super(message ?? 'Unable to connect. Please check your internet connection.')
		this.name = 'NetworkError'
	}
}

/**
 * Authentication errors (401)
 */
export class AuthenticationError extends BaseApiError {
	constructor(
		message: string = 'Your session has expired. Please log in again.',
		requestInfo?: ApiRequestDebugInfo
	) {
		super(message, 401, requestInfo)
		this.name = 'AuthenticationError'
	}
}

/**
 * Authorization errors (403)
 */
export class AuthorizationError extends BaseApiError {
	constructor(
		message: string = 'You do not have permission to perform this action.',
		requestInfo?: ApiRequestDebugInfo
	) {
		super(message, 403, requestInfo)
		this.name = 'AuthorizationError'
	}
}

/**
 * Validation errors (400)
 */
export class ValidationError extends BaseApiError {
	constructor(
		message: string,
		public fields?: Record<string, string[]>,
		requestInfo?: ApiRequestDebugInfo
	) {
		super(message, 400, requestInfo)
		this.name = 'ValidationError'
	}
}

/**
 * Not found errors (404)
 */
export class NotFoundError extends BaseApiError {
	constructor(
		message: string = 'The requested resource was not found.',
		requestInfo?: ApiRequestDebugInfo
	) {
		super(message, 404, requestInfo)
		this.name = 'NotFoundError'
	}
}

/**
 * Server errors (500+)
 */
export class ServerError extends BaseApiError {
	constructor(
		message: string = 'Something went wrong on the server. Please try again later.',
		requestInfo?: ApiRequestDebugInfo
	) {
		super(message, 500, requestInfo)
		this.name = 'ServerError'
	}
}

const API_ERROR_LOGGED_SYMBOL = Symbol('apiErrorLogged')

type ApiErrorWithLogMarker = Error & {
	[API_ERROR_LOGGED_SYMBOL]?: boolean
}

function maskRequestInfo(
	requestInfo: ApiRequestDebugInfo | undefined
): ApiRequestDebugInfo | undefined {
	if (!requestInfo) return undefined
	return {
		...requestInfo,
		payload:
			typeof requestInfo.payload === 'string' && requestInfo.payload.length > 1000
				? `${requestInfo.payload.slice(0, 1000)}…`
				: requestInfo.payload,
		responseBody:
			typeof requestInfo.responseBody === 'string' && requestInfo.responseBody.length > 1000
				? `${requestInfo.responseBody.slice(0, 1000)}…`
				: requestInfo.responseBody,
	}
}

export function logApiError(error: unknown, fallbackRequestInfo?: ApiRequestDebugInfo): void {
	const requestInfo =
		error instanceof BaseApiError || error instanceof NetworkError
			? (error.requestInfo ?? fallbackRequestInfo)
			: fallbackRequestInfo

	if (error instanceof Error) {
		const errorWithMarker = error as ApiErrorWithLogMarker
		if (errorWithMarker[API_ERROR_LOGGED_SYMBOL]) return
		Object.defineProperty(errorWithMarker, API_ERROR_LOGGED_SYMBOL, {
			value: true,
			configurable: true,
		})

		console.error('[API] Request failed', {
			name: error.name,
			message: error.message,
			stack: error.stack,
			request: maskRequestInfo(requestInfo),
			fields: error instanceof ValidationError ? error.fields : undefined,
		})
		return
	}

	console.error('[API] Request failed', {
		error,
		request: maskRequestInfo(requestInfo),
	})
}

/**
 * Groups API Types
 */

export type Visibility = 'public' | 'hidden' | 'system'
export type CategoryPermission = 'anyone' | 'admin_only'
export type JoinMode = 'open' | 'approval' | 'invitation_only' | 'admin_managed'

export interface Category {
	id: string
	name: string
	description: string | null
	visibility: Visibility
	allowGroupCreation: CategoryPermission
	createdAt: string
	updatedAt: string
}

export interface CategoryWithGroups extends Category {
	groups: Group[]
	groupCount?: number
}

export interface Group {
	id: string
	categoryId: string
	name: string
	description: string | null
	visibility: Visibility
	joinMode: JoinMode
	mumbleSyncEnabled: boolean
	mumbleTicker?: string | null
	ownerId: string
	createdAt: string
	updatedAt: string
}

export interface GroupWithDetails extends Group {
	category: Category
	memberCount?: number
	isOwner?: boolean
	isAdmin?: boolean
	isMember?: boolean
	hasPendingJoinRequest?: boolean
	adminUserIds?: string[]
	ownerName?: string
}

export interface GroupMember {
	id: string
	groupId: string
	userId: string
	joinedAt: string
	mainCharacterName?: string
	mainCharacterId?: string
}

export interface CreateCategoryRequest {
	name: string
	description?: string
	visibility?: Visibility
	allowGroupCreation?: CategoryPermission
}

export interface UpdateCategoryRequest {
	name?: string
	description?: string
	visibility?: Visibility
	allowGroupCreation?: CategoryPermission
}

export interface CreateGroupRequest {
	categoryId: string
	name: string
	description?: string
	visibility?: Visibility
	joinMode?: JoinMode
	mumbleSyncEnabled?: boolean
	mumbleTicker?: string | null
}

export interface UpdateGroupRequest {
	name?: string
	description?: string
	visibility?: Visibility
	joinMode?: JoinMode
	mumbleSyncEnabled?: boolean
	mumbleTicker?: string | null
	categoryId?: string
}

export interface GroupsFilters {
	categoryId?: string
	visibility?: Visibility
	joinMode?: JoinMode
	search?: string
	myGroups?: boolean
	limit?: number
	offset?: number
}

export interface GroupMembershipSummary {
	groupId: string
	groupName: string
	categoryName: string
	isOwner: boolean
	isAdmin: boolean
	mumbleSyncEnabled: boolean
	mumbleTicker?: string | null
	joinedAt: string
}

export interface CreateJoinRequestRequest {
	groupId: string
	reason?: string
}

export interface GroupJoinRequest {
	id: string
	groupId: string
	userId: string
	reason: string | null
	status: 'pending' | 'approved' | 'rejected'
	createdAt: string
	respondedAt: string | null
	respondedBy: string | null
}

export interface GroupJoinRequestWithDetails extends GroupJoinRequest {
	userName?: string
	userMainCharacterName?: string
}

export interface GroupInvitationWithDetails {
	id: string
	groupId: string
	inviterId: string
	inviteeMainCharacterId: string
	inviteeUserId: string | null
	status: 'pending' | 'accepted' | 'declined' | 'expired'
	expiresAt: string
	createdAt: string
	respondedAt: string | null
	inviterCharacterName?: string
	inviteeCharacterName?: string
	group: {
		id: string
		name: string
		description: string | null
		visibility: Visibility
	}
}

export interface GroupInviteCode {
	id: string
	groupId: string
	code: string
	createdBy: string
	maxUses: number | null
	currentUses: number
	expiresAt: string
	createdAt: string
	revokedAt: string | null
}

export interface GroupDiscordServer {
	id: string
	groupId: string
	discordServerId: string
	autoInvite: boolean
	autoAssignRoles: boolean
	createdAt: string
	updatedAt: string
	discordServer?: DiscordServerWithRoles
	roles?: Array<{
		id: string
		discordRoleId: string
		membershipType: 'member' | 'owner_admin'
		discordRole: DiscordRole
	}>
}

export interface CharacterSearchResult {
	userId: string
	characterId: string
	characterName: string
}

/**
 * Permissions API Types
 */

export type PermissionTarget = 'all_members' | 'all_admins' | 'owner_only' | 'owner_and_admins'

export interface PermissionCategory {
	id: string
	name: string
	description: string | null
	createdAt: string
	updatedAt: string
}

export interface Permission {
	id: string
	urn: string
	name: string
	description: string | null
	categoryId: string | null
	createdBy: string
	createdAt: string
	updatedAt: string
}

export interface PermissionWithDetails extends Permission {
	category: PermissionCategory | null
}

export interface GroupPermission {
	id: string
	groupId: string
	permissionId: string | null
	customUrn: string | null
	customName: string | null
	customDescription: string | null
	targetType: PermissionTarget
	createdBy: string
	createdByName?: string
	createdAt: string
}

export interface GroupPermissionWithDetails extends GroupPermission {
	permission: PermissionWithDetails | null
	group: {
		id: string
		name: string
	}
}

export interface CorporationPermissionWithDetails {
	id: string
	corporationId: string
	permissionId: string
	createdBy: string
	createdAt: Date
	permission: PermissionWithDetails
}

export interface UserPermission {
	permissionId?: string | null
	urn: string
	name: string
	description: string | null
	category: PermissionCategory | null
	groupId: string
	groupName: string
	targetType: PermissionTarget
	source: 'global' | 'group_scoped'
}

export interface CreatePermissionCategoryRequest {
	name: string
	description?: string
}

export interface UpdatePermissionCategoryRequest {
	name?: string
	description?: string
}

export interface CreatePermissionRequest {
	urn: string
	name: string
	description?: string
	categoryId?: string
}

export interface UpdatePermissionRequest {
	urn?: string
	name?: string
	description?: string
	categoryId?: string | null
}

export interface AttachPermissionRequest {
	groupId: string
	permissionId: string
	targetType: PermissionTarget
}

export interface CreateGroupScopedPermissionRequest {
	groupId: string
	urn: string
	name: string
	description?: string
	targetType: PermissionTarget
}

export interface UpdateGroupPermissionRequest {
	targetType?: PermissionTarget
	customUrn?: string
	customName?: string
	customDescription?: string
}

export interface GetGroupMemberPermissionsResponse {
	userPermissions: Record<string, UserPermission[]>
}

export interface GetMultiGroupMemberPermissionsResponse {
	userPermissions: Record<string, UserPermission[]>
}

export interface PermissionUsageGroup {
	groupId: string
	groupName: string
	targetType: PermissionTarget
}

/**
 * Corporations API Types
 */

export interface ManagedCorporation {
	corporationId: string
	name: string
	ticker: string
	assignedCharacterId: string | null
	assignedCharacterName: string | null
	isActive: boolean
	includeInBackgroundRefresh: boolean
	includeInStructureAssetSync: boolean
	isMemberCorporation: boolean
	isAltCorp: boolean
	isSpecialPurpose: boolean
	isRecruiting: boolean
	shortDescription: string | null
	fullDescription: string | null
	lastSync: string | null
	lastVerified: string | null
	isVerified: boolean
	healthyDirectorCount: number
	configuredBy: string | null
	createdAt: string
	updatedAt: string
}

export interface CorporationWithConfig extends ManagedCorporation {
	doConfig: {
		corporationId: string
		characterId: string
		characterName: string
		lastVerified: Date | null
		isVerified: boolean
		createdAt: Date
		updatedAt: Date
		includeInStructureAssetSync: boolean
	} | null
}

export interface CreateCorporationRequest {
	corporationId: string
	name: string
	ticker: string
	assignedCharacterId?: string
	assignedCharacterName?: string
	includeInBackgroundRefresh?: boolean
	includeInStructureAssetSync?: boolean
}

export interface UpdateCorporationRequest {
	assignedCharacterId?: string
	assignedCharacterName?: string
	isActive?: boolean
	includeInBackgroundRefresh?: boolean
	includeInStructureAssetSync?: boolean
	isMemberCorporation?: boolean
	isAltCorp?: boolean
	isSpecialPurpose?: boolean
}

export interface CorporationsFilters {
	corporationType?: 'member' | 'alt' | 'special' | 'other'
}

export interface CorporationAccessVerification {
	hasAccess: boolean
	characterId: string | null
	characterName: string | null
	verifiedRoles: string[]
	missingRoles?: string[]
	lastVerified: Date | null
}

export interface CorporationDataSummary {
	publicInfo: any
	coreData: {
		memberCount: number
		trackingCount: number
	} | null
	financialData: {
		walletCount: number
		journalCount: number
		transactionCount: number
	} | null
	assetsData: {
		assetCount: number
		structureCount: number
	} | null
	marketData: {
		orderCount: number
		contractCount: number
		industryJobCount: number
	} | null
	killmailCount: number
}

export interface FetchCorporationDataRequest {
	category?: 'all' | 'public' | 'core' | 'financial' | 'assets' | 'market' | 'killmails'
	forceRefresh?: boolean
}

/**
 * Discord Registry API Types
 */

export interface DiscordServer {
	id: string
	guildId: string
	guildName: string
	description: string | null
	isActive: boolean
	manageNicknames: boolean
	createdBy: string
	createdAt: string
	updatedAt: string
}

export interface DiscordRole {
	id: string
	discordServerId: string
	roleId: string
	roleName: string
	description: string | null
	isActive: boolean
	autoApply: boolean
	createdAt: string
	updatedAt: string
}

export interface DiscordServerWithRoles extends DiscordServer {
	roles: DiscordRole[]
}

export interface CorporationDiscordServer {
	id: string
	corporationId: string
	discordServerId: string
	autoInvite: boolean
	autoAssignRoles: boolean
	corpMemberNicknameEnabled: boolean
	corpMemberNicknameSource: 'corp' | 'alliance' | 'custom'
	corpMemberNicknameCustomTicker: string | null
	allianceGuestRoleId: string | null
	allianceGuestAutoApply: boolean
	allianceGuestNicknameEnabled: boolean
	allianceGuestNicknameSource: 'corp' | 'alliance' | 'custom'
	allianceGuestNicknameCustomTicker: string | null
	nonAllianceGuestRoleId: string | null
	nonAllianceGuestAutoApply: boolean
	nonAllianceGuestNicknameEnabled: boolean
	nonAllianceGuestNicknameSource: 'corp' | 'alliance' | 'custom'
	nonAllianceGuestNicknameCustomTicker: string | null
	createdAt: string
	updatedAt: string
	discordServer?: DiscordServerWithRoles
	roles?: Array<{
		id: string
		discordRoleId: string
		discordRole: DiscordRole
	}>
}

export type CorporationAlertDestinationType =
	| 'discord_channel'
	| 'discord_user'
	| 'discord_webhook'
	| 'group'

export interface CorporationAlertTypeDefinition {
	type: string
	label: string
	description: string
	supportedDestinationTypes: CorporationAlertDestinationType[]
}

export interface CorporationAlertDestination {
	id: string
	corporationId?: string | null
	scopeType?: 'corporation' | 'structure_group'
	scopeId?: string
	alertType: string
	destinationType: CorporationAlertDestinationType | string
	discordServerId: string | null
	channelId: string | null
	coreUserId: string | null
	groupId?: string | null
	destinationConfig: Record<string, unknown>
	isEnabled: boolean
	createdBy: string | null
	updatedBy: string | null
	createdAt: string
	updatedAt: string
	discordServer?: {
		id: string
		guildId: string
		guildName: string
	} | null
}

export interface CreateCorporationAlertDestinationRequest {
	alertType: string
	destinationType: CorporationAlertDestinationType | string
	discordServerId?: string | null
	channelId?: string | null
	coreUserId?: string | null
	groupId?: string | null
	destinationConfig?: Record<string, unknown>
	isEnabled?: boolean
}

export type StructurePermissionRole = 'viewer' | 'details' | 'sensitive' | 'manager'
export type StructureListSortBy =
	| RepoStructureCommonListSortBy
	| RepoStructureSkyhookListSortBy
	| RepoStructureMoonStructureListSortBy
	| RepoStructureSovereigntyListSortBy
export type StructureListSortDirection = 'asc' | 'desc'

export interface StructureListPagingQuery {
	page?: number
	pageSize?: number
	sortBy?: StructureListSortBy
	sortDirection?: StructureListSortDirection
}

export type StructureCommonListSortBy = RepoStructureCommonListSortBy
export type StructureOperationalListSortBy = RepoStructureCommonListSortBy

export type StructureCommonListQuery = RepoStructureCommonListQuery
export type StructureOperationalListQuery = RepoStructureCommonListQuery

export interface StructureCitadelListQuery extends RepoStructureCitadelListQuery {}

export interface StructureListQuery extends StructureCitadelListQuery {}

export interface StructureNavigationListQuery extends RepoStructureNavigationListQuery {}

export interface StructureSovereigntyListQuery extends RepoStructureSovereigntyListQuery {}

export interface StructureSkyhookListQuery extends RepoStructureSkyhookListQuery {}

export interface StructureMoonDrillListQuery extends RepoStructureMoonDrillListQuery {}

export interface StructureMiningCitadelListQuery extends RepoStructureMiningCitadelListQuery {}

export interface StructureListFilterOption {
	value: string
	label: string
}

export type StructureCommonListFilterOptions = RepoStructureCommonListFilterOptions

export interface StructureListFilterOptions extends RepoStructureCommonListFilterOptions {}

export type StructureOperationalListFilterOptions = RepoStructureCommonListFilterOptions

export interface StructureSkyhookListFilterOptions
	extends RepoStructureSkyhookListFilterOptions {}

export interface StructureMoonStructureListFilterOptions
	extends RepoStructureMoonStructureListFilterOptions {}

export type StructureSovereigntyListFilterOption = RepoStructureSovereigntyListFilterOption
export type StructureSovereigntyListFilterOptions = RepoStructureSovereigntyListFilterOptions
export type StructureSovereigntyListSummary = RepoStructureSovereigntyListSummary

export interface StructureListSummary extends RepoStructureListSummary {}

export interface StructureListBaseItem {
	structureId: string
	corporationId: string
	corporationName: string
	name: string
	typeId: string
	typeName: string | null
	systemId: string
	systemName: string | null
	regionId: string | null
	regionName: string | null
	state: string
	nextStateAt: string | null
	fuelExpires: string | null
	fuelAmount: number | null
	lowPower: boolean
	hidden: boolean
	lowPowerAllowed: boolean
	assignedGroupId: string | null
	syncStatus: 'ok' | 'warning' | 'error'
	syncFailureReason: string | null
	lastSyncedAt: string | null
	canViewDetails: boolean
}

export interface StructureCitadelListItem extends StructureListBaseItem {}

export interface StructureNavigationListItem extends StructureCitadelListItem {}

export interface StructureSovereigntyHubSummary {
	fuelAccessListId: string | null
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

export type StructureMoonDrillSummary = RepoStructureMoonDrillSummary
export type StructureMiningCitadelSummary = RepoStructureMiningCitadelSummary

export type StructureSovereigntyListItem = RepoStructureSovereigntyListItem

export type StructureSkyhookListItem = RepoStructureSkyhookListItem

export type StructureMoonDrillListItem = RepoStructureMoonDrillListItem
export type StructureMiningCitadelListItem = RepoStructureMiningCitadelListItem

export type StructureInventoryBay = SharedInventoryDisplayBay
export type StructureInventoryItem = StructureInventoryBay['items'][number]

export interface StructureAssetsDebugItem {
	itemId: string
	typeId: string
	typeName: string | null
	quantity: number
	isSingleton: boolean
	locationId: string
	locationType: string
	locationFlag: string
	locationFlagLabel: string
	updatedAt: string
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

export interface StructureDetailResult extends Omit<StructureCitadelListItem, 'canViewDetails'> {
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

export interface StructureAssetsDebugResult {
	corporationId: string
	corporationName: string
	structureId: string
	structureName: string
	fetchedAt: string
	fetchedAssetCount: number
	itemCount: number
	items: StructureAssetsDebugItem[]
}

export interface StructureListResponse<TItem = StructureCitadelListItem> {
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

export interface StructureCitadelListResponse
	extends StructureListResponse<StructureCitadelListItem> {}
export interface StructureNavigationListResponse
	extends StructureListResponse<StructureNavigationListItem> {}
export type StructureSovereigntyListResponse = RepoStructureSovereigntyListResponse
export type StructureSkyhookListResponse = RepoStructureSkyhookListResponse
export type StructureMoonDrillListResponse = RepoStructureMoonDrillListResponse
export type StructureMiningCitadelListResponse = RepoStructureMiningCitadelListResponse
export type StructureTabListResponse =
	| StructureCitadelListResponse
	| StructureNavigationListResponse
	| StructureSovereigntyListResponse
	| StructureSkyhookListResponse
	| StructureMiningCitadelListResponse
	| StructureMoonDrillListResponse

export interface UpdateStructureConfigRequest {
	hidden?: boolean
	lowPowerAllowed?: boolean
	assignedGroupId?: string | null
}

export interface StructureModuleConfig {
	id: string
	lowFuelTimeThresholdHours: number
	criticalFuelTimeThresholdHours: number
	lowFuelAmountThreshold: number
	criticalFuelAmountThreshold: number
	updatedBy: string | null
	createdAt: string
	updatedAt: string
}

export interface UpdateCorporationAlertDestinationRequest {
	alertType?: string
	destinationType?: CorporationAlertDestinationType | string
	discordServerId?: string | null
	channelId?: string | null
	coreUserId?: string | null
	groupId?: string | null
	destinationConfig?: Record<string, unknown>
	isEnabled?: boolean
}

export interface StructureAlertTypeDefinition {
	type: string
	label: string
	description: string
	supportedDestinationTypes: CorporationAlertDestinationType[]
}

export interface StructureGroupSetting {
	id: string
	groupId: string
	createdBy: string | null
	updatedBy: string | null
	createdAt: string
	updatedAt: string
}

export interface StructureCorporationGroupDefault {
	corporationId: string
	corporationName?: string
	groupId: string | null
	updatedBy: string | null
	createdAt: string
	updatedAt: string
}

export interface StructureGroupAlertConfig {
	id: string
	groupId: string
	alertType: string
	destinationIds: string[]
	config: Record<string, unknown>
	isEnabled: boolean
	createdAt: string
	updatedAt: string
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

export interface UpdateStructureModuleConfigRequest {
	lowFuelTimeThresholdHours?: number
	criticalFuelTimeThresholdHours?: number
	lowFuelAmountThreshold?: number
	criticalFuelAmountThreshold?: number
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

export interface CreateDiscordServerRequest {
	guildId: string
	guildName: string
	description?: string
	manageNicknames?: boolean
}

export interface UpdateDiscordServerRequest {
	guildName?: string
	description?: string
	isActive?: boolean
	manageNicknames?: boolean
}

export interface CreateDiscordRoleRequest {
	roleId: string
	roleName: string
	description?: string
	autoApply?: boolean
}

export interface UpdateDiscordRoleRequest {
	roleName?: string
	description?: string
	isActive?: boolean
	autoApply?: boolean
}

export interface AttachDiscordServerRequest {
	discordServerId: string
	autoInvite?: boolean
	autoAssignRoles?: boolean
	corpMemberNicknameEnabled?: boolean
	corpMemberNicknameSource?: 'corp' | 'alliance' | 'custom'
	corpMemberNicknameCustomTicker?: string | null
	allianceGuestRoleId?: string | null
	allianceGuestAutoApply?: boolean
	allianceGuestNicknameEnabled?: boolean
	allianceGuestNicknameSource?: 'corp' | 'alliance' | 'custom'
	allianceGuestNicknameCustomTicker?: string | null
	nonAllianceGuestRoleId?: string | null
	nonAllianceGuestAutoApply?: boolean
	nonAllianceGuestNicknameEnabled?: boolean
	nonAllianceGuestNicknameSource?: 'corp' | 'alliance' | 'custom'
	nonAllianceGuestNicknameCustomTicker?: string | null
}

export interface UpdateDiscordServerAttachmentRequest {
	autoInvite?: boolean
	autoAssignRoles?: boolean
	allianceGuestRoleId?: string | null
	allianceGuestAutoApply?: boolean
	nonAllianceGuestRoleId?: string | null
	nonAllianceGuestAutoApply?: boolean
}

export interface UpdateDiscordServerNicknameConfigRequest {
	corpMemberNicknameEnabled?: boolean
	corpMemberNicknameSource?: 'corp' | 'alliance' | 'custom'
	corpMemberNicknameCustomTicker?: string | null
	allianceGuestNicknameEnabled?: boolean
	allianceGuestNicknameSource?: 'corp' | 'alliance' | 'custom'
	allianceGuestNicknameCustomTicker?: string | null
	nonAllianceGuestNicknameEnabled?: boolean
	nonAllianceGuestNicknameSource?: 'corp' | 'alliance' | 'custom'
	nonAllianceGuestNicknameCustomTicker?: string | null
}

export interface AssignRoleRequest {
	discordRoleId: string
	membershipType?: 'member' | 'owner_admin'
}

export interface RefreshDiscordServerMembersResponse {
	totalProcessed: number
	successfulInvites: number
	failedInvites: number
	results: Array<{
		userId: string
		userName?: string
		success: boolean
		errorMessage?: string
	}>
}

export interface ResyncDiscordServerCommandsResponse {
	success: boolean
	total: number
	synced: number
	failed: number
	results: Array<{
		attachmentId: string
		commandId: string
		commandName: string
		success: boolean
		discordCommandId?: string
		error?: string
	}>
}

export interface DiscordAuditMember {
	discordUserId: string
	username: string
	discriminator: string
	displayName: string
	roleIds: string[]
	linked: boolean
	coreUserId: string | null
	mainCharacterId: string | null
	mainCharacterName: string | null
	hasValidToken: boolean | null
	corporationId: string | null
	corporationName: string | null
	isInMemberCorporation?: boolean
	hasRoleAffiliationMismatch?: boolean
	unmanagedRoleCount?: number
	hasManagedRoleDrift?: boolean
	roleState?: 'ok' | 'drift' | 'error'
	roleStateReason?: string
}

export interface DiscordGuildAuditResponse {
	server: {
		id: string
		guildId: string
		guildName: string
	}
	tab: 'linked' | 'unlinked'
	items: DiscordAuditMember[]
	nextCursor: string | null
	scanned: number
	runId?: string | null
	runStatus?: 'idle' | 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
	runStartedAt?: string | null
	runCompletedAt?: string | null
	linkedCount?: number
	unlinkedCount?: number
	runError?: string | null
	filter?:
		| 'all'
		| 'member_corp'
		| 'external'
		| 'roles_without_member_corp'
		| 'drifted'
		| 'unmanaged_roles'
		| 'with_roles'
		| 'without_roles'
	pagination?: {
		page: number
		pageSize: number
		totalCount: number
		totalPages: number
	}
}

export interface StartDiscordGuildAuditResponse {
	runId: string
	workflowInstanceId: string
	status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
}

export interface CleanupDiscordGuildAuditResponse {
	deletedRuns: number
}

// ---------------------------------------------------------------------------
// Service access audit (READ-ONLY).
//
// Mirrors apps/core/src/routes/services-audit.ts. There is deliberately no
// enforce/confirm shape here: enforcement is not built, and a client method that
// exists is a client method that gets called.
// ---------------------------------------------------------------------------

export type ServiceEligibilityReasonCode =
	| 'member_corp'
	| 'admin_exempt'
	| 'no_characters'
	| 'null_corp'
	| 'only_deleted_member_char'
	| 'unmanaged_corp'
	| 'no_user_row'

export type ServicesAuditRunStatus =
	| 'scanning'
	| 'blocked'
	| 'awaiting_confirmation'
	| 'enforcing'
	| 'completed'
	| 'completed_with_errors'
	| 'failed'
	| 'cancelled'

export interface ServicesAuditRunSummary {
	id: string
	status: ServicesAuditRunStatus
	/** The eligibility BASIS. Reported as prominently as the ineligible count:
	 * an inverted basis is what makes an ineligible count wrong. */
	memberCorpCount: number
	scanned: number
	inPopulation: number
	eligibleCount: number
	ineligibleCount: number
	blastRadiusTripped: boolean
	/**
	 * The basis shrank against the recent high-water mark, so THIS RUN'S NUMBERS
	 * MAY BE WRONG. Present on the summary (not just the detail) because someone
	 * looking at a list of runs has to see which ones not to believe.
	 */
	basisSuspect: boolean
	errorMessage: string | null
	startedAt: string | null
	completedAt: string | null
}

/** Discriminated union: "off" and "we could not tell" are different answers. */
export type ServicesAuditMumbleFeature =
	| { enabled: true; state: 'enabled' }
	| { enabled: false; state: 'flag_off' | 'binding_missing' | 'unreachable'; message: string }

export interface ServicesAuditSampleRow {
	userId: string
	mainCharacterId: string | null
	mainCharacterName: string | null
	reason: ServiceEligibilityReasonCode
	hasDiscordLink: boolean
}

export interface ServicesAuditRunDetail extends ServicesAuditRunSummary {
	memberCorporationIds: string[]
	initiatedByUserId: string | null
	scanWorkflowInstanceId: string | null
	/** The high-water basis count this run was compared against; null on the very
	 * first run, where nothing has validated the basis. */
	basisComparedToCount: number | null
	/**
	 * Exactly which corporations left the basis since the high-water run. THIS IS
	 * THE POINT: a count ratio cannot tell "an operator de-flagged 13 corps" from
	 * "the table got truncated", but a human reading 13 familiar names can.
	 */
	basisRemovedCorporationIds: string[] | null
	/** Operator-facing explanation of the diff; null unless basisSuspect. */
	basisNote: string | null
	/** Grouped by (reason, eligible) in SQL — NOT one "ineligible" total. */
	reasonBreakdown: Array<{
		reason: ServiceEligibilityReasonCode
		eligible: boolean
		count: number
	}>
	sample: ServicesAuditSampleRow[]
	mumbleFeature: ServicesAuditMumbleFeature
	/** false => `inPopulation` counts Discord-linked users only. The UI must say
	 * so rather than imply the denominator is complete. */
	mumblePopulationKnown: boolean
	inPopulationBasis: 'discord_link_only'
}

export interface ServicesAuditRow {
	id: string
	userId: string
	mainCharacterId: string | null
	mainCharacterName: string | null
	eligible: boolean
	reason: ServiceEligibilityReasonCode
	corporationIds: string[]
	hasDiscordLink: boolean
}

export interface ServicesAuditRowsResponse {
	rows: ServicesAuditRow[]
	pagination: {
		page: number
		pageSize: number
		totalCount: number
		totalPages: number
	}
}

export interface StartServicesAuditScanResponse {
	runId: string
	workflowInstanceId: string
	status: ServicesAuditRunStatus
}

export interface DiscordGuildAuditStripRolesResponse {
	guildId: string
	guildName: string
	results: Array<{
		discordUserId: string
		success: boolean
		errorMessage?: string
	}>
	successCount: number
	failureCount: number
}

export interface DiscordGuildAuditKickUsersResponse {
	guildId: string
	guildName: string
	results: Array<{
		discordUserId: string
		success: boolean
		errorMessage?: string
	}>
	successCount: number
	failureCount: number
}

export interface ManualEveCharacterSyncBatchRunResponse {
	batchId: string
	totalWorkflowInstances: number
	totalCharacters: number
	ownedUserWorkflows: number
	unownedCharacterWorkflows: number
	created: number
	failed: number
	workflowInstanceIds: string[]
	startedAt: string
}

export interface ManualEveCharacterSyncBatchStatusResponse {
	batchId: string
	startedAt: string
	total: number
	statusCounts: {
		queued: number
		running: number
		waiting: number
		complete: number
		errored: number
		terminated: number
		unknown: number
	}
	failedInstances: Array<{
		id: string
		status: string
		error?: string
	}>
}

export interface DiscordCommandCategory {
	id: string
	name: string
	description: string | null
	sortOrder: number
	createdAt: string
	updatedAt: string
}

export interface DiscordCommandPermission {
	id: string
	commandId: string
	permissionId: string
	createdAt: string
}

export interface DiscordServerCommand {
	id: string
	discordServerId: string
	commandId: string
	discordCommandId: string | null
	createdBy: string | null
	createdAt: string
	updatedAt: string
	discordServer?: DiscordServer
}

export interface DiscordCommand {
	id: string
	categoryId: string | null
	name: string
	description: string
	commandType: 'static_response' | 'programmatic'
	responseTemplate: string | null
	isActive: boolean
	createdBy: string | null
	createdAt: string
	updatedAt: string
	category?: DiscordCommandCategory | null
	requiredPermissions: DiscordCommandPermission[]
	serverAttachments: DiscordServerCommand[]
}

export interface CreateDiscordCommandCategoryRequest {
	name: string
	description?: string
	sortOrder?: number
}

export interface UpdateDiscordCommandCategoryRequest {
	name?: string
	description?: string
	sortOrder?: number
}

export interface CreateDiscordCommandRequest {
	categoryId?: string | null
	name: string
	description: string
	responseTemplate: string
	isActive?: boolean
	requiredPermissionIds?: string[]
}

export interface UpdateDiscordCommandRequest {
	categoryId?: string | null
	name?: string
	description?: string
	responseTemplate?: string
	isActive?: boolean
	requiredPermissionIds?: string[]
}

export interface AttachDiscordCommandToServerRequest {
	serverId: string
}

export interface DiscordCommandSyncResponse {
	success: boolean
	total?: number
	synced?: number
	failed?: number
	results?: Array<{
		attachmentId: string
		serverId: string
		guildId: string
		success: boolean
		discordCommandId?: string
		error?: string
	}>
}

/**
 * Directors API Types
 */

export interface DirectorHealth {
	directorId: string
	characterId: string
	characterName: string
	userId?: string | null
	isHealthy: boolean
	lastHealthCheck: string | null
	lastUsed: string | null
	failureCount: number
	lastFailureReason: string | null
	unhealthyReason?: {
		summary: string
		status: number | null
		step: string | null
		path: string | null
		hint: string | null
		reasonCode: string | null
		detailCode: string | null
		requiredRoles: string[] | null
		missingRoles: string[] | null
	} | null
	priority: number
}

export interface AddDirectorRequest {
	characterId: string
	characterName: string
	priority?: number
}

export interface UpdateDirectorPriorityRequest {
	priority: number
}

export interface VerifyDirectorResponse {
	success: boolean
	directorId: string
	isHealthy: boolean
}

export interface VerifyAllDirectorsResponse {
	success: boolean
	verified: number
	failed: number
	healthyCount: number
}

export interface RedeemInviteCodeRequest {
	code: string
}

export interface RedeemInviteCodeResponse {
	success: boolean
	group: Group
	message: string
}

/**
 * Admin User Management API Types
 */

export interface AdminUser {
	id: string
	mainCharacterId: string
	mainCharacterName: string | null
	characterCount: number
	is_admin: boolean
	discordUserId: string | null
	discordUsername: string | null
	matchedCharacterId: string | null
	matchedCharacterName: string | null
	matchedBy:
		| 'main_character_name'
		| 'character_name'
		| 'character_id'
		| 'user_id'
		| 'discord_user_id'
		| 'discord_username'
		| 'legacy_auth_username'
		| null
	createdAt: string
	updatedAt: string
}

export interface AdminUserCharacter {
	characterId: string
	characterName: string
	characterOwnerHash: string
	corporationId?: string | null
	corporationName?: string | null
	is_primary: boolean
	linkedAt: string
	hasValidToken: boolean
	isBlacklisted: boolean
}

export interface AdminDiscordStatus {
	userId: string
	username: string
	discriminator: string
	authRevoked: boolean
	authRevokedAt: string | null
	lastSuccessfulAuth: string | null
}

export interface AdminDiscordRoleInspectionItem {
	roleId: string
	roleName: string | null
	nameSource: 'discord' | 'configured' | 'unknown'
}

export interface AdminDiscordGuildInspection {
	guildId: string
	guildName: string
	isMember: boolean
	membershipError?: string
	expectedManagedRoles: AdminDiscordRoleInspectionItem[]
	currentManagedRoles: AdminDiscordRoleInspectionItem[]
	currentUnmanagedRoles: AdminDiscordRoleInspectionItem[]
	missingExpectedManagedRoles: AdminDiscordRoleInspectionItem[]
	unexpectedManagedRoles: AdminDiscordRoleInspectionItem[]
}

export interface AdminDiscordAccessInspection {
	userId: string
	discordUserId: string
	inspectedAt: string
	guilds: AdminDiscordGuildInspection[]
	summary: {
		guildsInspected: number
		memberGuilds: number
		guildsWithDrift: number
		totalMissingExpectedManagedRoles: number
		totalUnexpectedManagedRoles: number
		totalUnmanagedCurrentRoles: number
	}
}

export interface AdminOAuthResolverInspection {
	userId: string
	inspectedAt: string
	scopes: Array<'profile' | 'groups' | 'permissions'>
	response: {
		sub: string
		clientId: string
		scope: Array<'profile' | 'groups' | 'permissions'>
		mainCharacterId?: string
		isAdmin?: boolean
		email?: string
		emailVerified?: boolean
		characters?: Array<{
			characterId: string
			characterName: string
			isPrimary: boolean
			hasValidToken: boolean
		}>
		groupMemberships?: Array<{
			groupId: string
			groupName: string
			membershipLevel: 'member' | 'admin' | 'owner'
			joinedAt: string
		}>
		groups?: string[]
		permissionUrns?: string[]
	}
}

export interface AdminUserDetail {
	id: string
	mainCharacterId: string
	is_admin: boolean
	discordUserId: string | null
	discord: AdminDiscordStatus | null
	characters: AdminUserCharacter[]
	groupMemberships: Array<{
		groupId: string
		groupName: string
		membershipLevel: 'member' | 'admin' | 'owner'
		joinedAt: string
	}>
	permissionGrants: Array<{
		permissionId?: string | null
		urn: string
		name: string
		description: string | null
		groupId: string
		groupName: string
		targetType: 'all_members' | 'all_admins' | 'owner_only' | 'owner_and_admins'
		source: 'global' | 'group_scoped'
	}>
	createdAt: string
	updatedAt: string
}

export interface UserIpHistoryEntry {
	ipAddressHash: string
	firstSeenAt: string
	lastSeenAt: string
	seenCount: number
	distinctUserCount: number
}

export interface UserIpHistoryResponse {
	entries: UserIpHistoryEntry[]
}

export interface IpHashUserMatch {
	userId: string
	mainCharacterId: string
	mainCharacterName: string | null
	isAdmin: boolean
	seenCount: number
	firstSeenAt: string
	lastSeenAt: string
}

export interface IpHashMatchesResponse {
	matches: IpHashUserMatch[]
}

export interface AdminActivityLog {
	id: string
	userId: string
	characterId: string | null
	action: string
	metadata: Record<string, unknown> | null
	ipAddress: string | null
	userAgent: string | null
	createdAt: string
	characterName?: string | null
	userName?: string | null
}

export interface AdminUsersFilters {
	search?: string
	isAdmin?: boolean
	page?: number
	pageSize?: number
}

export interface AdminActivityLogFilters {
	userId?: string
	characterId?: string
	action?: string
	startDate?: string
	endDate?: string
	page?: number
	pageSize?: number
}

export type LegacyMigrationStatus =
	| 'pending'
	| 'partially_applied'
	| 'applied'
	| 'dismissed'
	| 'error'

export interface LegacyMigrationQueueItem {
	id: string
	modernUserId: string
	modernUserMainCharacterName?: string | null
	legacyAuthUserId: string
	status: LegacyMigrationStatus
	candidateSnapshot: Record<string, unknown>
	conflicts: Record<string, unknown>
	lastError: string | null
	lastMatchedAt: string
	lastReviewedAt: string | null
	createdAt: string
	updatedAt: string
}

export interface LegacyMigrationAction {
	id: string
	queueId: string
	action: 'create' | 'update' | 'recheck' | 'apply' | 'dismiss'
	performedByUserId: string | null
	payload: Record<string, unknown>
	createdAt: string
}

export interface LegacyMigrationCandidateCharacter {
	characterId: string
	characterName: string
	source: 'legacy_primary' | 'esi_owner' | 'xml_account'
	corporationId: string | null
	corporationName: string | null
	allianceId: string | null
	allianceName: string | null
	isDeleted: boolean
	alreadyLinkedToModernUser: boolean
	linkedToOtherUserId: string | null
}

export interface LegacyMigrationCandidateNote {
	legacyNoteId: string
	note: string
	legacyCreatedByUserId: string | null
	legacyCreatedByCharacterName: string | null
	legacyDateCreated: string | null
	alreadyImported: boolean
}

export interface LegacyHistoryApplication {
	id: string
	legacyApplicationId: string
	legacyAuthUserId: string | null
	characterId: string | null
	characterName: string | null
	corporationId: string | null
	corporationName: string | null
	status: string | null
	applicationDate: string | null
	metadata: Record<string, unknown> | null
	createdAt: string
	updatedAt: string
}

export interface LegacyHistoryEvent {
	id: string
	legacyEventId: string
	legacyApplicationId: string
	legacyAuthUserId: string | null
	eventType: string
	eventCode: number | null
	message: string | null
	legacyActorUserId: string | null
	eventAt: string | null
	metadata: Record<string, unknown> | null
	createdAt: string
	updatedAt: string
}

export interface LegacyHistoryModernUserMatch {
	userId: string
	characterId: string
}

export interface LegacyHistoryActorMatch {
	userId: string
	mainCharacterName: string | null
}

export interface ApplyLegacyMigrationPayload {
	applyBlacklistToUser?: boolean
	blacklistReason?: string
	blacklistMetadata?: Record<string, unknown>
	importCharacterLinks?: boolean
	importNotes?: boolean
	importIpAssociations?: boolean
	markSkipped?: boolean
	characterIds?: string[]
	noteIds?: string[]
}

/**
 * Admin Blacklist Management API Types
 */

export type BlacklistTargetType =
	| 'user'
	| 'character_id'
	| 'character_name'
	| 'discord_id'
	| 'corporation_id'
	| 'corporation_name'
	| 'alliance_id'
	| 'alliance_name'

export interface BlacklistEntry {
	id: string
	targetType: BlacklistTargetType
	targetValue: string
	reason: string
	blacklistedBy: string
	triggeredBy: string | null
	isAutoBlacklist: boolean
	metadata: Record<string, unknown> | null
	createdAt: string
}

export interface CreateUserBlacklistRequest {
	userId: string
	reason: string
	metadata?: Record<string, unknown>
}

export interface CreateCharacterBlacklistRequest {
	characterId?: string
	characterName?: string
	reason: string
	metadata?: Record<string, unknown>
}

export interface CreateDiscordBlacklistRequest {
	discordUserId: string
	reason: string
	metadata?: Record<string, unknown>
}

export interface BlacklistFilters {
	targetType?: BlacklistTargetType
	isAutoBlacklist?: boolean
	search?: string
	page?: number
	pageSize?: number
}

export interface BlacklistResults {
	entries: BlacklistEntry[]
	total: number
	limit: number
	offset: number
}

export interface PaginatedResponse<T> {
	data: T[]
	pagination: {
		page: number
		pageSize: number
		totalCount: number
		totalPages: number
	}
}

/**
 * Broadcasts API Types
 */

export type TargetType = 'discord_channel'
export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'rescinded'
export type DeliveryStatus = 'pending' | 'sent' | 'failed'

export interface BroadcastTarget {
	id: string
	name: string
	description: string | null
	type: TargetType
	sendPermissionId: string
	managePermissionId: string
	displayOrder: number
	config: Record<string, unknown> // { guildId, channelId } for Discord
	createdBy: string
	createdAt: string
	updatedAt: string
}

export interface BroadcastTemplate {
	id: string
	name: string
	description: string | null
	targetType: string
	displayOrder: number
	targetIds: string[]
	fieldSchema: Array<{
		name: string
		label: string
		type: string
		required?: boolean
		placeholder?: string
		options?: string[]
		allowCustom?: boolean
	}>
	messageTemplate: string
	createdBy: string
	createdAt: string
	updatedAt: string
}

export interface Broadcast {
	id: string
	templateId: string | null
	targetId: string
	title: string
	content: Record<string, unknown>
	status: BroadcastStatus
	scheduledFor: string | null
	sentAt: string | null
	errorMessage: string | null
	permissionId: string
	createdBy: string
	createdByCharacterName: string
	srpMode?: 'blanket' | 'military' | 'coalition' | 'disabled' | null
	srpToken?: string | null
	doctrineId?: string | null
	fleetSessionId?: string | null
	createdAt: string
	updatedAt: string
}

export interface BroadcastWithDetails extends Broadcast {
	target: BroadcastTarget
	template?: BroadcastTemplate
	deliveries?: BroadcastDelivery[]
}

export interface BroadcastDelivery {
	id: string
	broadcastId: string
	targetId: string
	status: DeliveryStatus
	discordMessageId: string | null
	errorMessage: string | null
	sentAt: string | null
	createdAt: string
	target?: BroadcastTarget
}

export interface BroadcastListResponse {
	rows: Broadcast[]
	rowCount: number
}

export interface CreateBroadcastTargetRequest {
	name: string
	description?: string
	type: TargetType
	permissionEntityNamespace: string
	permissionTargetName: string
	displayOrder?: number
	sendPermissionId?: string
	managePermissionId?: string
	config: {
		guildId: string
		channelId: string
	}
}

export interface UpdateBroadcastTargetRequest {
	name?: string
	description?: string
	displayOrder?: number
	sendPermissionId?: string
	managePermissionId?: string
	sendPermissionUrn?: string
	managePermissionUrn?: string
	config?: {
		guildId?: string
		channelId?: string
	}
}

export interface CreateBroadcastTemplateRequest {
	name: string
	description?: string
	targetType: string
	displayOrder?: number
	targetIds: string[]
	fieldSchema: Array<{
		name: string
		label: string
		type: string
		required?: boolean
		placeholder?: string
		options?: string[]
		allowCustom?: boolean
	}>
	messageTemplate: string
}

export interface UpdateBroadcastTemplateRequest {
	name?: string
	description?: string
	displayOrder?: number
	targetIds?: string[]
	fieldSchema?: Array<{
		name: string
		label: string
		type: string
		required?: boolean
		placeholder?: string
		options?: string[]
		allowCustom?: boolean
	}>
	messageTemplate?: string
}

export interface CreateBroadcastRequest {
	templateId?: string
	targetId: string
	title: string
	content: Record<string, unknown>
	scheduledFor?: string
}

export interface UpdateBroadcastRequest {
	content?: Record<string, unknown>
	scheduledFor?: string | null
}

export interface SendBroadcastResponse {
	success: boolean
	broadcast: Broadcast
	delivery: {
		status?: string
		discordMessageId?: string | null
		errorMessage?: string | null
	}
	/** Set when the broadcast started a fleet tracking session via system_fleet_tracking. */
	trackingSessionId?: string | null
	/** Set when the broadcast asked for tracking but it failed (e.g. not fleet boss). */
	trackingError?: string | null
}

/**
 * Doctrines API Types
 */

export interface DoctrineCategory {
	id: string
	name: string
	sortOrder: number
}

export interface StagingSystem {
	id: string
	solarSystemId: string
	solarSystemName: string
	sortOrder: number
}

export interface DoctrineStagingEntry {
	stagingSystem: StagingSystem
	note: string
}

export interface Doctrine {
	id: string
	name: string
	description: string | null
	shipTypeId: string | null
	categoryId: string | null
	categoryName: string | null
	categorySortOrder: number | null
	sortOrder: number
	updatedBy: string | null
	createdAt: string
	updatedAt: string
	stagingSystems: DoctrineStagingEntry[]
}

export interface Fitting {
	id: string
	name: string
	description: string | null
	shipTypeId: string
	shipName: string
	fitting: string
	category: string
	srpEligible: boolean
	srpValue: string
	createdAt: string
	updatedAt: string
}

export interface FittingItem {
	id: string
	fittingId: string
	typeId: string
	typeName: string
	quantity: string
	flagId: string
	flagName: string
	groupId: string
	groupName: string
	categoryId: string
}

export interface DoctrineFittingEntry {
	fitting: Fitting
	fittingCategory: string
	sortOrder: number
}

export interface DoctrineWithFittings extends Doctrine {
	fittings: DoctrineFittingEntry[]
	stagingSystems: DoctrineStagingEntry[]
	category: DoctrineCategory | null
}

export interface FittingWithItems extends Fitting {
	fittingItems: FittingItem[]
}

export interface FittingWithDoctrines extends Fitting {
	doctrines: Array<{ id: string; name: string }>
}

export interface SaveFittingIngameResponse {
	fitting_id: number
}

export interface ParsedFittingPreview {
	shipName: string
	shipTypeId: string
	fittingName: string
	items: FittingItem[]
	unresolvedItems: string[]
}

export interface CreateDoctrineRequest {
	name: string
	description?: string
	shipTypeId?: string
	categoryId?: string
	sortOrder?: number
}

export interface UpdateDoctrineRequest {
	name?: string
	description?: string
	shipTypeId?: string
	categoryId?: string
	sortOrder?: number
}

export interface CreateFittingRequest {
	fitting: string
	category: string
	srpEligible: boolean
	srpValue: string
	fittingItems: Array<Omit<FittingItem, 'id' | 'fittingId'>>
}

export interface UpdateFittingRequest {
	fitting?: string
	category?: string
	srpEligible?: boolean
	srpValue?: string
	fittingItems?: Array<Omit<FittingItem, 'id' | 'fittingId'>>
}

export interface AddFittingToDoctrineRequest {
	fittingId: string
	fittingCategory?: string
	sortOrder?: number
}

export interface UpdateDoctrineFittingRequest {
	fittingCategory?: string
	sortOrder?: number
}

export interface ListDoctrinesFilters {
	search?: string
}

export interface ListFittingsFilters {
	shipTypeId?: string
	category?: string
	srpEligible?: boolean
	search?: string
}

/**
 * Industry Admin API Types
 */

export enum IndustryEntityType {
	USER = 'user',
	CHARACTER = 'character',
	CORPORATION = 'corporation',
	ALLIANCE = 'alliance',
	SERVICE_PROVIDER = 'service_provider',
}

export enum ServiceType {
	GENERAL_MANUFACTURING = 'general_manufacturing',
	CAPITAL_SHIP_MANUFACTURING = 'capital_ship_manufacturing',
	SUPERCAPITAL_SHIP_MANUFACTURING = 'supercapital_ship_manufacturing',
	RESEARCHING = 'research',
	BLUEPRINT_COPYING = 'blueprint_copying',
	INVENTION = 'invention',
	REACTION = 'reaction',
	HAULING = 'hauling',
	CUSTOM_HAULING = 'custom_hauling',
	BUYBACK = 'buyback',
	ACQUISITION = 'acquisition',
	BOOKMARKS = 'bookmarks',
	OTHER_SERVICE = 'other_service',
}

export enum ServiceStatus {
	ACTIVE = 'active',
	INACTIVE = 'inactive',
	CLOSED = 'closed',
}

export interface ServiceProvider {
	id: string
	name: string
	description: string | null
	createdAt: string
	updatedAt: string
	ownerEntityId: string
	ownerEntityType: IndustryEntityType
	acceptingOrders: boolean
}

export interface ProviderServiceDTO {
	id: string
	providerId: string
	serviceType: ServiceType
	status: ServiceStatus
	createdAt: string
	updatedAt: string
}

export interface IndustryProviderFilters {
	ownerEntityId?: string
	ownerEntityType?: IndustryEntityType
	acceptingOrders?: boolean
	limit?: number
	offset?: number
}

export interface CreateIndustryProviderRequest {
	name: string
	description?: string | null
	ownerEntityId: string
	ownerEntityType: IndustryEntityType
	acceptingOrders?: boolean
}

export interface UpdateIndustryProviderRequest {
	name?: string
	description?: string | null
	acceptingOrders?: boolean
}

export interface IndustryProviderStatistics {
	totalProviders: number
	totalByEntityType: Record<IndustryEntityType, number>
	totalAcceptingOrders: number
	totalServices: number
	servicesByType: Record<ServiceType, number>
	servicesByStatus: Record<ServiceStatus, number>
}

/**
 * User Services API Types
 */

export interface UserService {
	id: string
	serviceId: string
	enabled: boolean
	createdAt: string
	updatedAt: string
	service: {
		id: string
		name: string
		slug: string
		icon: string | null
		description: string | null
		enabled: boolean
	}
}

export interface ResetServicePasswordResponse {
	success: boolean
	message: string
	newPassword?: string
}

export interface MumbleConnectionInfo {
	host: string
	port: number
}

export interface MumbleAccountStatus {
	subjectId: string
	loginName: string
	displayName: string
	enabled: boolean
	groups: string[]
	hasPassword: boolean
	lastAuthenticatedAt: string | null
}

export interface MumbleAccountResponse {
	account: MumbleAccountStatus | null
	connection: MumbleConnectionInfo
}

export interface MumbleProvisionResponse {
	account: MumbleAccountStatus
	password: string
	connection: MumbleConnectionInfo
}

export interface MumbleSyncGroupsResponse {
	synced: string[]
	skipped: string[]
}

/** A temp-op row as returned by the authed list endpoint. */
export interface TempopListItem {
	id: string
	shortCode: string
	creatorUserId: string
	creatorName: string | null
	groupName: string
	ttlSeconds: number
	status: string
	guestCount: number
	createdAt: string
	expiresAt: string
	deletedAt: string | null
	canDelete: boolean
}

export interface TempopCreatorOption {
	id: string
	name: string | null
}

export interface TempopListResponse {
	items: TempopListItem[]
	creators: TempopCreatorOption[]
	pagination: {
		page: number
		pageSize: number
		totalCount: number
		totalPages: number
		hasNextPage: boolean
		hasPreviousPage: boolean
	}
}

export interface CreateTempopResponse {
	tempopId: string
	shortCode: string
	/** One-time URL token — build the link client-side, then it's unrecoverable. */
	token: string
	expiresAt: string
}

export interface TempopListFilters {
	status?: 'active' | 'expired' | 'deleted' | 'all'
	creatorId?: string
	mine?: boolean
	page?: number
	pageSize?: number
}

/** Public temp-op metadata shown on the guest landing page. */
export interface TempopInfo {
	valid: boolean
	expired: boolean
	groupName?: string
	expiresAt?: string
}

export interface TempopCredentialsResponse {
	loginName: string
	password: string
	connection: MumbleConnectionInfo
}

export interface MumbleDeleteResponse {
	deleted: string[]
	notFound: string[]
	queued: string[]
}

export interface PasteRecord {
	id: string
	name: string
	createdByUserId: string
	createdByCharacterId: string | null
	createdByCharacterName: string | null
	visibility: 'alliance' | 'public'
	isPasswordProtected: boolean
	sizeBytes: number
	contentType: 'text/plain'
	expiresAt: string | null
	createdAt: string
	updatedAt: string
	lastAccessedAt: string | null
	encryptionVersion: string | null
	creatorDisplayName?: string | null
}

export interface PasteSettings {
	createRateLimitCount: number
	createRateLimitWindowMinutes: number
	maxActivePastesPerUser: number
	updatedByUserId: string | null
	updatedAt: string
}

export interface PasteViewerResponse {
	paste: PasteRecord
	content: string | null
	requiresPassword: boolean
}

export class ApiClient {
	private baseUrl: string
	private publicBaseUrl: string

	constructor(baseUrl: string = API_BASE_URL) {
		this.baseUrl = baseUrl
		this.publicBaseUrl = baseUrl.replace(/\/api$/, '')
	}

	private async readResponseBody<T>(response: Response): Promise<T | null> {
		const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
		if (!contentType.includes('application/json')) {
			return null
		}
		try {
			return (await response.json()) as T
		} catch {
			return null
		}
	}

	private toErrorMessage(value: unknown, fallback: string): string {
		if (typeof value === 'string' && value.trim()) {
			return value
		}
		if (value && typeof value === 'object' && 'message' in value) {
			const nested = (value as { message?: unknown }).message
			if (typeof nested === 'string' && nested.trim()) {
				return nested
			}
		}
		return fallback
	}

	private parseRequestPayload(body: RequestInit['body']): unknown {
		if (typeof body === 'string') {
			try {
				return JSON.parse(body) as unknown
			} catch {
				return body
			}
		}

		if (body instanceof URLSearchParams) {
			return Object.fromEntries(body.entries())
		}

		return body ?? undefined
	}

	private buildRequestDebugInfo(url: string, options?: RequestInit): ApiRequestDebugInfo {
		return {
			url,
			method: (options?.method ?? 'GET').toUpperCase(),
			payload: this.parseRequestPayload(options?.body),
		}
	}

	private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
		const url = `${this.baseUrl}${endpoint}`
		const requestInfo = this.buildRequestDebugInfo(url, options)
		const timeoutController = new AbortController()
		const timeout = setTimeout(() => timeoutController.abort(), API_REQUEST_TIMEOUT_MS)
		if (options?.signal) {
			options.signal.addEventListener('abort', () => timeoutController.abort(), { once: true })
		}

		try {
			const response = await fetch(url, {
				...(options ?? {}),
				credentials: 'include', // Send cookies with requests
				signal: timeoutController.signal,
				headers: {
					'Content-Type': 'application/json',
					'X-Requested-With': 'XMLHttpRequest', // Required for CSRF protection
					...options?.headers,
				},
			})

			if (!response.ok) {
				// Try to parse error response body
				const errorData = await this.readResponseBody<{
					error?: unknown
					message?: unknown
					fields?: Record<string, string[]>
				}>(response)

				// Backend may return { error: string } or { message: string } or { error: string, fields: {...} }
				const errorMessage = this.toErrorMessage(
					errorData?.error ?? errorData?.message,
					response.statusText || `Request failed (${response.status})`
				)
				const errorFields = errorData?.fields
				requestInfo.status = response.status
				requestInfo.responseBody = errorData

				// Throw appropriate error type based on status code
				switch (response.status) {
					case 400: {
						const error = new ValidationError(errorMessage, errorFields, requestInfo)
						logApiError(error)
						throw error
					}
					case 401: {
						const error = new AuthenticationError(errorMessage, requestInfo)
						logApiError(error)
						throw error
					}
					case 403: {
						const error = new AuthorizationError(errorMessage, requestInfo)
						logApiError(error)
						throw error
					}
					case 404: {
						const error = new NotFoundError(errorMessage, requestInfo)
						logApiError(error)
						throw error
					}
					case 500:
					case 502:
					case 503:
					case 504: {
						const error = new ServerError(errorMessage, requestInfo)
						logApiError(error)
						throw error
					}
					default: {
						const error = new BaseApiError(errorMessage, response.status, requestInfo)
						logApiError(error)
						throw error
					}
				}
			}

			const data = await this.readResponseBody<T>(response)
			if (data === null) {
				const error = new BaseApiError(
					`Expected JSON response but received ${response.headers.get('content-type') || 'unknown content-type'}`,
					response.status,
					{
						...requestInfo,
						status: response.status,
					}
				)
				logApiError(error)
				throw error
			}
			return data
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				const timeoutError = new NetworkError('Request timed out. Please try again.', requestInfo)
				logApiError(timeoutError)
				throw timeoutError
			}

			// Handle network errors (fetch failures, timeouts, etc.)
			if (error instanceof TypeError && error.message.includes('fetch')) {
				const networkError = new NetworkError(undefined, requestInfo)
				logApiError(networkError)
				throw networkError
			}

			// Re-throw API errors
			if (
				error instanceof BaseApiError ||
				error instanceof NetworkError ||
				error instanceof AuthenticationError ||
				error instanceof AuthorizationError ||
				error instanceof ValidationError ||
				error instanceof NotFoundError ||
				error instanceof ServerError
			) {
				logApiError(error)
				throw error
			}

			// Unknown error
			const unexpectedError = new NetworkError(
				'An unexpected error occurred. Please try again.',
				requestInfo
			)
			logApiError(unexpectedError)
			throw unexpectedError
		} finally {
			clearTimeout(timeout)
		}
	}

	async get<T>(endpoint: string): Promise<T> {
		return this.request<T>(endpoint, { method: 'GET' })
	}

	async post<T>(endpoint: string, data?: unknown): Promise<T> {
		return this.request<T>(endpoint, {
			method: 'POST',
			body: JSON.stringify(data),
		})
	}

	async put<T>(endpoint: string, data?: unknown): Promise<T> {
		return this.request<T>(endpoint, {
			method: 'PUT',
			body: JSON.stringify(data),
		})
	}

	async delete<T>(endpoint: string): Promise<T> {
		return this.request<T>(endpoint, { method: 'DELETE' })
	}

	async patch<T>(endpoint: string, data?: unknown): Promise<T> {
		return this.request<T>(endpoint, {
			method: 'PATCH',
			body: JSON.stringify(data),
		})
	}

	private async requestPublic<T>(endpoint: string, options?: RequestInit): Promise<T> {
		const url = `${this.publicBaseUrl}${endpoint}`
		const requestInfo = this.buildRequestDebugInfo(url, options)
		const timeoutController = new AbortController()
		const timeout = setTimeout(() => timeoutController.abort(), API_REQUEST_TIMEOUT_MS)
		if (options?.signal) {
			options.signal.addEventListener('abort', () => timeoutController.abort(), { once: true })
		}
		try {
			const response = await fetch(url, {
				...(options ?? {}),
				credentials: 'include',
				signal: timeoutController.signal,
				headers: {
					'Content-Type': 'application/json',
					'X-Requested-With': 'XMLHttpRequest',
					...options?.headers,
				},
			})
			if (!response.ok) {
				const data = await this.readResponseBody<{ error?: unknown; message?: unknown }>(response)
				const message = this.toErrorMessage(
					data?.error ?? data?.message,
					response.statusText || `Request failed (${response.status})`
				)
				const error = new BaseApiError(message, response.status, {
					...requestInfo,
					status: response.status,
					responseBody: data,
				})
				logApiError(error)
				throw error
			}
			const data = await this.readResponseBody<T>(response)
			if (data === null) {
				const error = new BaseApiError(
					`Expected JSON response but received ${response.headers.get('content-type') || 'unknown content-type'}`,
					response.status,
					{
						...requestInfo,
						status: response.status,
					}
				)
				logApiError(error)
				throw error
			}
			return data
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				const timeoutError = new NetworkError('Request timed out. Please try again.', requestInfo)
				logApiError(timeoutError)
				throw timeoutError
			}

			if (error instanceof TypeError && error.message.includes('fetch')) {
				const networkError = new NetworkError(undefined, requestInfo)
				logApiError(networkError)
				throw networkError
			}

			if (error instanceof BaseApiError || error instanceof NetworkError) {
				logApiError(error)
				throw error
			}

			const unexpectedError = new NetworkError(
				'An unexpected error occurred. Please try again.',
				requestInfo
			)
			logApiError(unexpectedError)
			throw unexpectedError
		} finally {
			clearTimeout(timeout)
		}
	}

	/**
	 * Get the public character overview used by list rows and summary cards.
	 * This endpoint intentionally omits private profile fields such as wallet,
	 * location, status, skills, and skill queue.
	 */
	async getCharacterDetail(characterId: string): Promise<{
		characterId: string
		isOwner: boolean
		viewedAsAdmin: boolean
		viewedAsCeoOrDirector: boolean
		viewedAsHrViewer: boolean
		viewerRole: 'CEO' | 'Director' | null
		canViewPrivateData: boolean
		public: {
			info: any
			corporationHistory: any[]
			attributes: any
		}
		owner?: {
			userId: string
			mainCharacterName: string
		}
		lastUpdated: string | null
	}> {
		return this.get(`/characters/${characterId}`)
	}

	/**
	 * Get the private character-profile hydration for explicit detail-page views.
	 * This is the only profile-data fetch that can trigger the private-profile alert.
	 */
	async getCharacterPrivateDetail(characterId: string): Promise<{
		characterId: string
		isOwner: boolean
		viewedAsAdmin: boolean
		viewedAsCeoOrDirector: boolean
		viewedAsHrViewer: boolean
		viewerRole: 'CEO' | 'Director' | null
		skills: any
		allSkills: any[]
		private?: {
			location?: any
			wallet?: any
			assets?: any
			status?: any
			sensitiveDataIsLive?: boolean
			skillQueue?: any[]
		}
		owner?: {
			userId: string
			mainCharacterName: string
		}
	}> {
		return this.get(`/characters/${characterId}/private`)
	}

	/**
	 * Get trained skill levels only for planner and skill-specific views.
	 * This route is separate from profile hydration and does not alert.
	 */
	async getCharacterSkillLevels(characterId: string): Promise<{
		characterId: string
		characterName: string
		skills: Array<{
			activeSkillLevel: number
			skillId: number | string
			skillpointsInSkill: number
			trainedSkillLevel: number
		}>
		totalSp: number
		unallocatedSp: number | null
	}> {
		return this.get(`/characters/${characterId}/skills`)
	}

	async getCharacterOwnerships(
		characterIds: string[]
	): Promise<Record<string, { userId: string }>> {
		return this.post('/characters/ownership', { characterIds })
	}

	async refreshCharacterById(characterId: string): Promise<{
		success: boolean
		message: string
		lastUpdated: string | null
		hasValidToken: boolean
	}> {
		return this.post(`/characters/${characterId}/refresh`)
	}

	async getSkillMetadata(skillIds: string): Promise<any[]> {
		// Call through core API which resolves skill metadata via Universe.
		return this.get(`/skills?ids=${skillIds}`)
	}

	async searchCharacters(query: string): Promise<CharacterSearchResult[]> {
		return this.get(`/characters/search?q=${encodeURIComponent(query)}`)
	}

	async startDiscordLinking(): Promise<{ state: string }> {
		return this.post('/discord/link/start')
	}

	async joinDiscordServers(): Promise<{
		results: Array<{
			guildId: string
			guildName: string
			corporationName: string
			success: boolean
			errorMessage?: string
			alreadyMember?: boolean
		}>
		totalInvited: number
		totalFailed: number
	}> {
		return this.post('/discord/join-servers')
	}

	// ===== Groups API Methods =====

	// Categories
	async getCategories(): Promise<Category[]> {
		return this.get('/groups/categories')
	}

	async getCategory(id: string): Promise<CategoryWithGroups> {
		return this.get(`/groups/categories/${id}`)
	}

	async createCategory(data: CreateCategoryRequest): Promise<Category> {
		return this.post('/groups/categories', data)
	}

	async updateCategory(id: string, data: UpdateCategoryRequest): Promise<Category> {
		return this.patch(`/groups/categories/${id}`, data)
	}

	async deleteCategory(id: string): Promise<void> {
		return this.delete(`/groups/categories/${id}`)
	}

	// Groups
	async getGroups(filters?: GroupsFilters): Promise<GroupWithDetails[]> {
		const params = new URLSearchParams()
		if (filters?.categoryId) params.set('categoryId', filters.categoryId)
		if (filters?.visibility) params.set('visibility', filters.visibility)
		if (filters?.joinMode) params.set('joinMode', filters.joinMode)
		if (filters?.search) params.set('search', filters.search)
		if (filters?.myGroups) params.set('myGroups', 'true')
		params.set('limit', String(filters?.limit ?? 100))
		if (filters?.offset !== undefined) params.set('offset', String(filters.offset))

		const query = params.toString()
		return this.get(`/groups${query ? `?${query}` : ''}`)
	}

	async getGroup(id: string): Promise<GroupWithDetails> {
		return this.get(`/groups/${id}`)
	}

	async createGroup(data: CreateGroupRequest): Promise<Group> {
		return this.post('/groups', data)
	}

	async updateGroup(id: string, data: UpdateGroupRequest): Promise<Group> {
		return this.patch(`/groups/${id}`, data)
	}

	async deleteGroup(id: string): Promise<void> {
		return this.delete(`/groups/${id}`)
	}

	// User-Facing Group Operations
	async joinGroup(id: string): Promise<void> {
		return this.post(`/groups/${id}/join`)
	}

	async addGroupMember(id: string, characterName: string): Promise<void> {
		return this.post(`/groups/${id}/members`, { characterName })
	}

	async leaveGroup(id: string): Promise<void> {
		return this.post(`/groups/${id}/leave`)
	}

	async getUserMemberships(): Promise<GroupMembershipSummary[]> {
		return this.get('/groups/my-groups')
	}

	// Join Requests
	async createJoinRequest(data: CreateJoinRequestRequest): Promise<GroupJoinRequest> {
		return this.post(`/groups/${data.groupId}/join-requests`, { reason: data.reason })
	}

	async getJoinRequests(groupId: string): Promise<GroupJoinRequestWithDetails[]> {
		return this.get(`/groups/${groupId}/join-requests`)
	}

	async approveJoinRequest(requestId: string): Promise<void> {
		return this.post(`/groups/join-requests/${requestId}/approve`)
	}

	async rejectJoinRequest(requestId: string): Promise<void> {
		return this.post(`/groups/join-requests/${requestId}/reject`)
	}

	// Invitations
	async getPendingInvitations(): Promise<GroupInvitationWithDetails[]> {
		return this.get('/groups/invitations')
	}

	async getGroupInvitations(groupId: string): Promise<GroupInvitationWithDetails[]> {
		return this.get(`/groups/${groupId}/invitations`)
	}

	async createInvitation(groupId: string, characterName: string): Promise<void> {
		return this.post(`/groups/${groupId}/invitations`, { characterName })
	}

	async acceptInvitation(id: string): Promise<void> {
		return this.post(`/groups/invitations/${id}/accept`)
	}

	async declineInvitation(id: string): Promise<void> {
		return this.post(`/groups/invitations/${id}/decline`)
	}

	async cancelInvitation(id: string): Promise<void> {
		return this.delete(`/groups/invitations/${id}`)
	}

	// Invite Codes
	async redeemInviteCode(code: string): Promise<RedeemInviteCodeResponse> {
		return this.post('/groups/invite-codes/redeem', { code })
	}

	// Group Members
	async getGroupMembers(groupId: string): Promise<GroupMember[]> {
		return this.get(`/groups/${groupId}/members`)
	}

	async removeGroupMember(groupId: string, userId: string): Promise<void> {
		return this.delete(`/groups/${groupId}/members/${userId}`)
	}

	// Group Admins
	async addGroupAdmin(groupId: string, userId: string): Promise<void> {
		return this.post(`/groups/${groupId}/admins`, { userId })
	}

	async removeGroupAdmin(groupId: string, userId: string): Promise<void> {
		return this.delete(`/groups/${groupId}/admins/${userId}`)
	}

	// Transfer Ownership
	async transferGroupOwnership(groupId: string, newOwnerId: string): Promise<void> {
		return this.post(`/groups/${groupId}/transfer`, { newOwnerId })
	}

	// Group Discord Servers (Registry-Based)
	async getGroupDiscordServers(groupId: string): Promise<GroupDiscordServer[]> {
		return this.get(`/groups/${groupId}/discord-servers`)
	}

	async attachDiscordServerToGroup(
		groupId: string,
		data: AttachDiscordServerRequest
	): Promise<GroupDiscordServer> {
		return this.post(`/groups/${groupId}/discord-servers`, data)
	}

	async updateGroupDiscordServer(
		groupId: string,
		attachmentId: string,
		data: UpdateDiscordServerAttachmentRequest
	): Promise<GroupDiscordServer> {
		return this.put(`/groups/${groupId}/discord-servers/${attachmentId}`, data)
	}

	async detachDiscordServerFromGroup(
		groupId: string,
		attachmentId: string
	): Promise<{ success: boolean }> {
		return this.delete(`/groups/${groupId}/discord-servers/${attachmentId}`)
	}

	async assignRoleToGroupDiscordServer(
		groupId: string,
		attachmentId: string,
		data: AssignRoleRequest
	): Promise<{ id: string; discordRoleId: string }> {
		return this.post(`/groups/${groupId}/discord-servers/${attachmentId}/roles`, data)
	}

	async unassignRoleFromGroupDiscordServer(
		groupId: string,
		attachmentId: string,
		roleAssignmentId: string
	): Promise<{ success: boolean }> {
		return this.delete(
			`/groups/${groupId}/discord-servers/${attachmentId}/roles/${roleAssignmentId}`
		)
	}

	async refreshGroupDiscordServerRoles(
		groupId: string,
		attachmentId: string
	): Promise<{
		success: number
		failed: number
		skipped: number
		totalMembers: number
		message?: string
	}> {
		return this.post(`/groups/${groupId}/discord-servers/${attachmentId}/refresh-roles`)
	}

	// Group Invite Codes

	async getGroupInviteCodes(groupId: string): Promise<GroupInviteCode[]> {
		return this.get(`/groups/${groupId}/invite-codes`)
	}

	async createGroupInviteCode(
		groupId: string,
		data: { maxUses?: number | null; expiresInDays?: number }
	): Promise<{ code: GroupInviteCode }> {
		return this.post(`/groups/${groupId}/invite-codes`, data)
	}

	async revokeGroupInviteCode(codeId: string): Promise<{ success: boolean }> {
		return this.delete(`/groups/invite-codes/${codeId}`)
	}

	// ===== Permissions API Methods =====

	// Permission Categories
	async getPermissionCategories(): Promise<PermissionCategory[]> {
		return this.get('/groups/permissions/categories')
	}

	async createPermissionCategory(
		data: CreatePermissionCategoryRequest
	): Promise<PermissionCategory> {
		return this.post('/groups/permissions/categories', data)
	}

	async updatePermissionCategory(
		id: string,
		data: UpdatePermissionCategoryRequest
	): Promise<PermissionCategory> {
		return this.patch(`/groups/permissions/categories/${id}`, data)
	}

	async deletePermissionCategory(id: string): Promise<void> {
		return this.delete(`/groups/permissions/categories/${id}`)
	}

	// Global Permissions
	async getGlobalPermissions(categoryId?: string): Promise<PermissionWithDetails[]> {
		const params = categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : ''
		return this.get(`/groups/permissions${params}`)
	}

	async getPermission(id: string): Promise<PermissionWithDetails | null> {
		return this.get(`/groups/permissions/${id}`)
	}

	async createPermission(data: CreatePermissionRequest): Promise<Permission> {
		return this.post('/groups/permissions', data)
	}

	async updatePermission(id: string, data: UpdatePermissionRequest): Promise<Permission> {
		return this.patch(`/groups/permissions/${id}`, data)
	}

	async deletePermission(id: string): Promise<void> {
		return this.delete(`/groups/permissions/${id}`)
	}

	// Group Permissions
	async getGroupPermissions(groupId: string): Promise<GroupPermissionWithDetails[]> {
		return this.get(`/groups/${groupId}/permissions`)
	}

	async attachPermissionToGroup(
		data: AttachPermissionRequest
	): Promise<GroupPermissionWithDetails> {
		return this.post(`/groups/${data.groupId}/permissions/attach`, {
			permissionId: data.permissionId,
			targetType: data.targetType,
		})
	}

	async createGroupScopedPermission(
		data: CreateGroupScopedPermissionRequest
	): Promise<GroupPermissionWithDetails> {
		return this.post(`/groups/${data.groupId}/permissions/custom`, {
			urn: data.urn,
			name: data.name,
			description: data.description,
			targetType: data.targetType,
		})
	}

	async updateGroupPermission(
		groupPermissionId: string,
		data: UpdateGroupPermissionRequest
	): Promise<GroupPermissionWithDetails> {
		return this.patch(`/groups/permissions/attachments/${groupPermissionId}`, data)
	}

	async removePermissionFromGroup(groupId: string, groupPermissionId: string): Promise<void> {
		return this.delete(`/groups/${groupId}/permissions/${groupPermissionId}`)
	}

	// Permission Queries
	async getUserPermissions(userId: string): Promise<UserPermission[]> {
		return this.get(`/groups/permissions/users/${userId}`)
	}

	async getGroupMemberPermissions(groupId: string): Promise<GetGroupMemberPermissionsResponse> {
		return this.get(`/groups/${groupId}/permissions/members`)
	}

	async getMultiGroupMemberPermissions(
		groupIds: string[]
	): Promise<GetMultiGroupMemberPermissionsResponse> {
		const params = new URLSearchParams()
		groupIds.forEach((id) => params.append('groupId', id))
		return this.get(`/groups/permissions/members?${params.toString()}`)
	}

	// ===== Corporations API Methods =====

	async getCorporations(filters?: CorporationsFilters): Promise<ManagedCorporation[]> {
		const params = new URLSearchParams()
		if (filters?.corporationType !== undefined)
			params.set('corporationType', filters.corporationType)

		const query = params.toString()
		return this.get(`/corporations${query ? `?${query}` : ''}`)
	}

	async searchManagedCorporations(query: string): Promise<ManagedCorporation[]> {
		return this.get(`/corporations/search?q=${encodeURIComponent(query)}`)
	}

	async getCorporation(corporationId: string): Promise<CorporationWithConfig> {
		return this.get(`/corporations/${corporationId}`)
	}

	/**
	 * Get public corporations (member corps only) for browsing/applying
	 * Uses public /corporations/browse endpoint (authenticated users, not admin-only)
	 */
	async getPublicCorporations(): Promise<ManagedCorporation[]> {
		return this.get('/corporations/browse')
	}

	/**
	 * Search corporations by name or ticker (member corps only)
	 * Uses public /corporations/browse/search endpoint (authenticated users, not admin-only)
	 */
	async searchCorporations(query: string): Promise<ManagedCorporation[]> {
		return this.get(`/corporations/browse/search?q=${encodeURIComponent(query)}`)
	}

	/**
	 * Get detailed information about a specific corporation
	 * Used for the corporation detail page
	 */
	async getCorporationDetail(corporationId: string): Promise<ManagedCorporation> {
		return this.get(`/corporations/browse/${corporationId}`)
	}

	/**
	 * Update corporation recruiting settings (CEO or admin only)
	 * Updates isRecruiting, shortDescription, and fullDescription
	 */
	async updateCorporationSettings(
		corporationId: string,
		settings: {
			isRecruiting?: boolean
			shortDescription?: string
			fullDescription?: string
		}
	): Promise<ManagedCorporation> {
		return this.patch(`/corporations/${corporationId}/settings`, settings)
	}

	async createCorporation(data: CreateCorporationRequest): Promise<ManagedCorporation> {
		return this.post('/corporations', data)
	}

	async updateCorporation(
		corporationId: string,
		data: UpdateCorporationRequest
	): Promise<ManagedCorporation> {
		return this.put(`/corporations/${corporationId}`, data)
	}

	async deleteCorporation(corporationId: string): Promise<{ success: boolean }> {
		return this.delete(`/corporations/${corporationId}`)
	}

	async verifyCorporationAccess(corporationId: string): Promise<CorporationAccessVerification> {
		return this.post(`/corporations/${corporationId}/verify`)
	}

	async fetchCorporationData(
		corporationId: string,
		data?: FetchCorporationDataRequest
	): Promise<{ success: boolean; category: string }> {
		return this.post(`/corporations/${corporationId}/fetch`, data)
	}

	async getCorporationDataSummary(corporationId: string): Promise<CorporationDataSummary> {
		return this.get(`/corporations/${corporationId}/data`)
	}

	async getCorporationAlertTypes(): Promise<CorporationAlertTypeDefinition[]> {
		return this.get('/corporations/alerts/types')
	}

	async getCorporationAlertDestinations(
		corporationId: string
	): Promise<CorporationAlertDestination[]> {
		return this.get(`/corporations/${corporationId}/alerts`)
	}

	async createCorporationAlertDestination(
		corporationId: string,
		data: CreateCorporationAlertDestinationRequest
	): Promise<CorporationAlertDestination> {
		return this.post(`/corporations/${corporationId}/alerts`, data)
	}

	async updateCorporationAlertDestination(
		corporationId: string,
		destinationId: string,
		data: UpdateCorporationAlertDestinationRequest
	): Promise<CorporationAlertDestination> {
		return this.put(`/corporations/${corporationId}/alerts/${destinationId}`, data)
	}

	async deleteCorporationAlertDestination(
		corporationId: string,
		destinationId: string
	): Promise<{ success: boolean }> {
		return this.delete(`/corporations/${corporationId}/alerts/${destinationId}`)
	}

	async getAdminStructureAlertTypes(): Promise<StructureAlertTypeDefinition[]> {
		return this.get('/admin/structures/alert-types')
	}

	async getAdminStructureGroupSettings(): Promise<StructureGroupSetting[]> {
		return this.get('/admin/structures/group-settings')
	}

	async updateAdminStructureGroupSetting(groupId: string): Promise<StructureGroupSetting> {
		return this.patch(`/admin/structures/group-settings/${groupId}`, {})
	}

	async deleteAdminStructureGroupSetting(groupId: string): Promise<{ success: boolean }> {
		return this.delete(`/admin/structures/group-settings/${groupId}`)
	}

	async getAdminStructureCorporationDefaults(): Promise<StructureCorporationGroupDefault[]> {
		return this.get('/admin/structures/corporation-defaults')
	}

	async updateAdminStructureCorporationDefault(
		corporationId: string,
		data: { groupId: string | null }
	): Promise<StructureCorporationGroupDefault> {
		return this.patch(`/admin/structures/corporation-defaults/${corporationId}`, data)
	}

	async getAdminStructureAlertDestinations(
		groupId: string
	): Promise<CorporationAlertDestination[]> {
		return this.get(`/admin/structures/groups/${groupId}/destinations`)
	}

	async createAdminStructureAlertDestination(
		groupId: string,
		data: CreateStructureAlertDestinationRequest
	): Promise<CorporationAlertDestination> {
		return this.post(`/admin/structures/groups/${groupId}/destinations`, data)
	}

	async updateAdminStructureAlertDestination(
		groupId: string,
		destinationId: string,
		data: UpdateStructureAlertDestinationRequest
	): Promise<CorporationAlertDestination> {
		return this.put(`/admin/structures/groups/${groupId}/destinations/${destinationId}`, data)
	}

	async deleteAdminStructureAlertDestination(
		groupId: string,
		destinationId: string
	): Promise<{ success: boolean }> {
		return this.delete(`/admin/structures/groups/${groupId}/destinations/${destinationId}`)
	}

	async getAdminStructureAlertConfigs(groupId: string): Promise<StructureGroupAlertConfig[]> {
		return this.get(`/admin/structures/groups/${groupId}/alert-configs`)
	}

	async createAdminStructureAlertConfig(
		groupId: string,
		data: CreateStructureGroupAlertConfigRequest
	): Promise<StructureGroupAlertConfig> {
		return this.post(`/admin/structures/groups/${groupId}/alert-configs`, data)
	}

	async updateAdminStructureAlertConfig(
		groupId: string,
		configId: string,
		data: UpdateStructureGroupAlertConfigRequest
	): Promise<StructureGroupAlertConfig> {
		return this.put(`/admin/structures/groups/${groupId}/alert-configs/${configId}`, data)
	}

	async deleteAdminStructureAlertConfig(
		groupId: string,
		configId: string
	): Promise<{ success: boolean }> {
		return this.delete(`/admin/structures/groups/${groupId}/alert-configs/${configId}`)
	}

	async getSidebarExternalLinks(): Promise<SidebarExternalLinkSummary[]> {
		return this.get('/navigation/external-links')
	}

	async getAdminSidebarExternalLinks(): Promise<SidebarExternalLinkSummary[]> {
		return this.get('/admin/navigation/external-links')
	}

	async createAdminSidebarExternalLink(
		data: SidebarExternalLinkCreateInput
	): Promise<SidebarExternalLinkSummary> {
		return this.post('/admin/navigation/external-links', data)
	}

	async updateAdminSidebarExternalLink(
		id: string,
		data: SidebarExternalLinkUpdateInput
	): Promise<SidebarExternalLinkSummary> {
		return this.patch(`/admin/navigation/external-links/${id}`, data)
	}

	async deleteAdminSidebarExternalLink(id: string): Promise<{ success: boolean }> {
		return this.delete(`/admin/navigation/external-links/${id}`)
	}

	async getCitadelStructures(
		query: StructureCitadelListQuery = {}
	): Promise<StructureCitadelListResponse> {
		const params = new URLSearchParams()
		if (query.page) params.set('page', String(query.page))
		if (query.pageSize) params.set('pageSize', String(query.pageSize))
		if (query.sortBy) params.set('sortBy', query.sortBy)
		if (query.sortDirection) params.set('sortDirection', query.sortDirection)
		if (query.corporationId) params.set('corporationId', query.corporationId)
		if (query.assignedGroupId) params.set('assignedGroupId', query.assignedGroupId)
		if (query.lowPower) params.set('lowPower', query.lowPower)
		if (query.lowPowerAllowed) params.set('lowPowerAllowed', query.lowPowerAllowed)
		if (query.regionId) params.set('regionId', query.regionId)
		if (query.systemId) params.set('systemId', query.systemId)
		if (query.state) params.set('state', query.state)
		if (query.typeId) params.set('typeId', query.typeId)
		const queryString = params.toString()
		return this.get(`/structures/citadels${queryString ? `?${queryString}` : ''}`)
	}

	async getNavigationStructures(
		query: StructureNavigationListQuery = {}
	): Promise<StructureNavigationListResponse> {
		const params = new URLSearchParams()
		if (query.page) params.set('page', String(query.page))
		if (query.pageSize) params.set('pageSize', String(query.pageSize))
		if (query.sortBy) params.set('sortBy', query.sortBy)
		if (query.sortDirection) params.set('sortDirection', query.sortDirection)
		if (query.corporationId) params.set('corporationId', query.corporationId)
		if (query.systemId) params.set('systemId', query.systemId)
		if (query.state) params.set('state', query.state)
		if (query.typeId) params.set('typeId', query.typeId)
		const queryString = params.toString()
		return this.get(`/structures/navigation${queryString ? `?${queryString}` : ''}`)
	}

	async getSovereigntyStructures(
		query: StructureSovereigntyListQuery = {}
	): Promise<StructureSovereigntyListResponse> {
		const params = new URLSearchParams()
		if (query.page) params.set('page', String(query.page))
		if (query.pageSize) params.set('pageSize', String(query.pageSize))
		if (query.sortBy) params.set('sortBy', query.sortBy)
		if (query.sortDirection) params.set('sortDirection', query.sortDirection)
		if (query.corporationId) params.set('corporationId', query.corporationId)
		if (query.assignedGroupId) params.set('assignedGroupId', query.assignedGroupId)
		if (query.regionId) params.set('regionId', query.regionId)
		if (query.systemId) params.set('systemId', query.systemId)
		if (query.controllerAllianceId) params.set('controllerAllianceId', query.controllerAllianceId)
		if (query.vulnerabilityState) params.set('vulnerabilityState', query.vulnerabilityState)
		const queryString = params.toString()
		return this.get(`/structures/sovereignty${queryString ? `?${queryString}` : ''}`)
	}

	async getSkyhookStructures(
		query: StructureSkyhookListQuery = {}
	): Promise<StructureSkyhookListResponse> {
		const params = new URLSearchParams()
		if (query.page) params.set('page', String(query.page))
		if (query.pageSize) params.set('pageSize', String(query.pageSize))
		if (query.sortBy) params.set('sortBy', query.sortBy)
		if (query.sortDirection) params.set('sortDirection', query.sortDirection)
		if (query.corporationId) params.set('corporationId', query.corporationId)
		if (query.systemId) params.set('systemId', query.systemId)
		if (query.planetId) params.set('planetId', query.planetId)
		if (query.state) params.set('state', query.state)
		if (query.isRaidable) params.set('isRaidable', query.isRaidable)
		const queryString = params.toString()
		return this.get(`/structures/skyhooks${queryString ? `?${queryString}` : ''}`)
	}

	async getMoonDrillStructures(
		query: StructureMoonDrillListQuery = {}
	): Promise<StructureMoonDrillListResponse> {
		const params = new URLSearchParams()
		if (query.page) params.set('page', String(query.page))
		if (query.pageSize) params.set('pageSize', String(query.pageSize))
		if (query.sortBy) params.set('sortBy', query.sortBy)
		if (query.sortDirection) params.set('sortDirection', query.sortDirection)
		if (query.corporationId) params.set('corporationId', query.corporationId)
		if (query.systemId) params.set('systemId', query.systemId)
		if (query.planetId) params.set('planetId', query.planetId)
		if (query.typeId) params.set('typeId', query.typeId)
		const queryString = params.toString()
		return this.get(`/structures/moon-drills${queryString ? `?${queryString}` : ''}`)
	}

	async getMiningCitadelStructures(
		query: StructureMiningCitadelListQuery = {}
	): Promise<StructureMiningCitadelListResponse> {
		const params = new URLSearchParams()
		if (query.page) params.set('page', String(query.page))
		if (query.pageSize) params.set('pageSize', String(query.pageSize))
		if (query.sortBy) params.set('sortBy', query.sortBy)
		if (query.sortDirection) params.set('sortDirection', query.sortDirection)
		if (query.corporationId) params.set('corporationId', query.corporationId)
		if (query.systemId) params.set('systemId', query.systemId)
		if (query.planetId) params.set('planetId', query.planetId)
		if (query.typeId) params.set('typeId', query.typeId)
		const queryString = params.toString()
		return this.get(`/structures/mining-citadels${queryString ? `?${queryString}` : ''}`)
	}

	async getStructures(
		query: StructureCitadelListQuery = {}
	): Promise<StructureCitadelListResponse> {
		return this.getCitadelStructures(query)
	}

	async getStructure(structureId: string): Promise<StructureDetailResult> {
		return this.get(`/structures/${structureId}`)
	}

	async requestStructureAssetsDebug(structureId: string): Promise<{
		workflowInstanceId: string
		exportId: string
		fileName: string
		status: 'queued'
	}> {
		return this.post(`/structures/${structureId}/assets-debug`, {})
	}

	async requestStructureInventoryRebuild(structureId: string): Promise<{
		structureId: string
		corporationId: string
		inventoryCount: number
	}> {
		return this.post(`/structures/${structureId}/inventory-rebuild`, {})
	}

	async getStructureAssetsDebugStatus(
		structureId: string,
		workflowInstanceId: string
	): Promise<{
		workflowInstanceId: string
		status: 'queued' | 'running' | 'completed' | 'failed' | 'unknown'
		rawStatus?: string
		output: unknown | null
	}> {
		return this.get(`/structures/${structureId}/assets-debug/${workflowInstanceId}`)
	}

	async downloadStructureAssetsDebug(
		structureId: string,
		workflowInstanceId: string
	): Promise<StructureAssetsDebugResult> {
		const response = await fetch(
			`/api/structures/${structureId}/assets-debug/${workflowInstanceId}/download`,
			{
				credentials: 'include',
				headers: {
					'X-Requested-With': 'XMLHttpRequest',
				},
			}
		)
		if (!response.ok) {
			const message = await response.text()
			throw new Error(message || 'Failed to download structure assets debug data')
		}

		return (await response.json()) as StructureAssetsDebugResult
	}

	async updateStructureConfig(
		structureId: string,
		data: UpdateStructureConfigRequest
	): Promise<StructureDetailResult> {
		return this.patch(`/structures/${structureId}/config`, data)
	}

	async getStructureModuleConfig(): Promise<StructureModuleConfig> {
		return this.get('/structures/config')
	}

	async updateStructureModuleConfig(
		data: UpdateStructureModuleConfigRequest
	): Promise<StructureModuleConfig> {
		return this.patch('/structures/config', data)
	}

	// ===== Directors API Methods =====

	async getDirectors(corporationId: string): Promise<DirectorHealth[]> {
		return this.get(`/corporations/${corporationId}/directors`)
	}

	async addDirector(
		corporationId: string,
		data: AddDirectorRequest
	): Promise<{ success: boolean; characterId: string; characterName: string; priority: number }> {
		return this.post(`/corporations/${corporationId}/directors`, data)
	}

	async removeDirector(corporationId: string, characterId: string): Promise<{ success: boolean }> {
		return this.delete(`/corporations/${corporationId}/directors/${characterId}`)
	}

	async updateDirectorPriority(
		corporationId: string,
		characterId: string,
		data: UpdateDirectorPriorityRequest
	): Promise<{ success: boolean; characterId: string; priority: number }> {
		return this.put(`/corporations/${corporationId}/directors/${characterId}`, data)
	}

	async verifyDirector(corporationId: string, directorId: string): Promise<VerifyDirectorResponse> {
		return this.post(`/corporations/${corporationId}/directors/${directorId}/verify`)
	}

	async verifyAllDirectors(corporationId: string): Promise<VerifyAllDirectorsResponse> {
		return this.post(`/corporations/${corporationId}/directors/verify-all`)
	}

	// ===== Discord Registry API Methods =====

	async getDiscordServers(): Promise<DiscordServerWithRoles[]> {
		return this.get('/discord-servers')
	}

	async getDiscordServer(serverId: string): Promise<DiscordServerWithRoles> {
		return this.get(`/discord-servers/${serverId}`)
	}

	async createDiscordServer(data: CreateDiscordServerRequest): Promise<DiscordServer> {
		return this.post('/discord-servers', data)
	}

	async updateDiscordServer(
		serverId: string,
		data: UpdateDiscordServerRequest
	): Promise<DiscordServer> {
		return this.put(`/discord-servers/${serverId}`, data)
	}

	async deleteDiscordServer(serverId: string): Promise<{ success: boolean }> {
		return this.delete(`/discord-servers/${serverId}`)
	}

	async createDiscordRole(serverId: string, data: CreateDiscordRoleRequest): Promise<DiscordRole> {
		return this.post(`/discord-servers/${serverId}/roles`, data)
	}

	async updateDiscordRole(
		serverId: string,
		roleId: string,
		data: UpdateDiscordRoleRequest
	): Promise<DiscordRole> {
		return this.put(`/discord-servers/${serverId}/roles/${roleId}`, data)
	}

	async deleteDiscordRole(serverId: string, roleId: string): Promise<{ success: boolean }> {
		return this.delete(`/discord-servers/${serverId}/roles/${roleId}`)
	}

	async refreshDiscordServerMembers(
		serverId: string
	): Promise<RefreshDiscordServerMembersResponse> {
		return this.post(`/discord-servers/${serverId}/refresh-members`)
	}

	async resyncDiscordServerCommands(
		serverId: string
	): Promise<ResyncDiscordServerCommandsResponse> {
		return this.post(`/discord-servers/${serverId}/resync-commands`)
	}

	async getDiscordGuildAudit(
		serverId: string,
		params: {
			tab: 'linked' | 'unlinked'
			filter?:
				| 'all'
				| 'member_corp'
				| 'external'
				| 'roles_without_member_corp'
				| 'drifted'
				| 'unmanaged_roles'
				| 'with_roles'
				| 'without_roles'
			page?: number
			pageSize?: number
		}
	): Promise<DiscordGuildAuditResponse> {
		const query = new URLSearchParams()
		query.set('tab', params.tab)
		if (params.filter) query.set('filter', params.filter)
		if (params.page) query.set('page', String(params.page))
		if (params.pageSize) query.set('pageSize', String(params.pageSize))
		return this.get(`/discord-servers/${serverId}/audit?${query.toString()}`)
	}

	async startDiscordGuildAudit(serverId: string): Promise<StartDiscordGuildAuditResponse> {
		return this.post(`/discord-servers/${serverId}/audit/runs`)
	}

	async cleanupDiscordGuildAudit(serverId: string): Promise<CleanupDiscordGuildAuditResponse> {
		return this.post(`/discord-servers/${serverId}/audit/cleanup`)
	}

	// --- Service access audit (READ-ONLY; no enforce method exists on purpose) ---

	async getServicesAuditRuns(): Promise<{ items: ServicesAuditRunSummary[] }> {
		return this.get('/services-audit/runs')
	}

	async getServicesAuditRun(runId: string): Promise<ServicesAuditRunDetail> {
		return this.get(`/services-audit/runs/${runId}`)
	}

	async getServicesAuditRunRows(
		runId: string,
		params: {
			reason?: ServiceEligibilityReasonCode
			eligible?: boolean
			page?: number
			pageSize?: number
		} = {}
	): Promise<ServicesAuditRowsResponse> {
		const query = new URLSearchParams()
		if (params.reason) query.set('reason', params.reason)
		if (typeof params.eligible === 'boolean') query.set('eligible', String(params.eligible))
		if (params.page) query.set('page', String(params.page))
		if (params.pageSize) query.set('pageSize', String(params.pageSize))
		return this.get(`/services-audit/runs/${runId}/rows?${query.toString()}`)
	}

	async startServicesAuditScan(): Promise<StartServicesAuditScanResponse> {
		return this.post('/services-audit/runs')
	}

	async cancelServicesAuditScan(runId: string): Promise<{ runId: string; status: string }> {
		return this.post(`/services-audit/runs/${runId}/cancel`)
	}

	async stripDiscordGuildRoles(
		serverId: string,
		discordUserIds: string[],
		runId?: string | null
	): Promise<DiscordGuildAuditStripRolesResponse> {
		return this.post(`/discord-servers/${serverId}/audit/strip-roles`, { discordUserIds, runId })
	}

	async kickDiscordGuildUsers(
		serverId: string,
		discordUserIds: string[],
		runId?: string | null
	): Promise<DiscordGuildAuditKickUsersResponse> {
		return this.post(`/discord-servers/${serverId}/audit/kick-users`, { discordUserIds, runId })
	}

	// ===== Discord Slash Commands API Methods =====

	async getDiscordCommandCategories(): Promise<DiscordCommandCategory[]> {
		return this.get('/discord-commands/categories')
	}

	async createDiscordCommandCategory(
		data: CreateDiscordCommandCategoryRequest
	): Promise<DiscordCommandCategory> {
		return this.post('/discord-commands/categories', data)
	}

	async updateDiscordCommandCategory(
		id: string,
		data: UpdateDiscordCommandCategoryRequest
	): Promise<DiscordCommandCategory> {
		return this.patch(`/discord-commands/categories/${id}`, data)
	}

	async deleteDiscordCommandCategory(id: string): Promise<{ success: boolean }> {
		return this.delete(`/discord-commands/categories/${id}`)
	}

	async getDiscordCommands(): Promise<DiscordCommand[]> {
		return this.get('/discord-commands')
	}

	async createDiscordCommand(data: CreateDiscordCommandRequest): Promise<DiscordCommand> {
		return this.post('/discord-commands', data)
	}

	async updateDiscordCommand(
		id: string,
		data: UpdateDiscordCommandRequest
	): Promise<DiscordCommand> {
		return this.patch(`/discord-commands/${id}`, data)
	}

	async deleteDiscordCommand(id: string): Promise<{ success: boolean }> {
		return this.delete(`/discord-commands/${id}`)
	}

	async getDiscordCommandServers(commandId: string): Promise<DiscordServerCommand[]> {
		return this.get(`/discord-commands/${commandId}/servers`)
	}

	async attachDiscordCommandToServer(
		commandId: string,
		data: AttachDiscordCommandToServerRequest
	): Promise<DiscordServerCommand> {
		return this.post(`/discord-commands/${commandId}/servers`, data)
	}

	async detachDiscordCommandFromServer(
		commandId: string,
		serverId: string
	): Promise<{ success: boolean }> {
		return this.delete(`/discord-commands/${commandId}/servers/${serverId}`)
	}

	async syncDiscordCommand(commandId: string): Promise<DiscordCommandSyncResponse> {
		return this.post(`/discord-commands/${commandId}/sync`)
	}

	async registerDiscordCommand(commandId: string): Promise<DiscordCommandSyncResponse> {
		return this.post(`/discord-commands/${commandId}/register`)
	}

	// ===== Corporation Discord Server Attachments API Methods =====

	async getCorporationDiscordServers(corporationId: string): Promise<CorporationDiscordServer[]> {
		return this.get(`/corporations/${corporationId}/discord-servers`)
	}

	async getCorporationDiscordServer(
		corporationId: string,
		attachmentId: string
	): Promise<CorporationDiscordServer> {
		return this.get(`/corporations/${corporationId}/discord-servers/${attachmentId}`)
	}

	async attachDiscordServerToCorporation(
		corporationId: string,
		data: AttachDiscordServerRequest
	): Promise<CorporationDiscordServer> {
		return this.post(`/corporations/${corporationId}/discord-servers`, data)
	}

	async updateCorporationDiscordServer(
		corporationId: string,
		attachmentId: string,
		data: UpdateDiscordServerAttachmentRequest
	): Promise<CorporationDiscordServer> {
		return this.put(`/corporations/${corporationId}/discord-servers/${attachmentId}`, data)
	}

	async updateCorporationDiscordServerNicknameConfig(
		corporationId: string,
		attachmentId: string,
		data: UpdateDiscordServerNicknameConfigRequest
	): Promise<CorporationDiscordServer> {
		return this.put(
			`/corporations/${corporationId}/discord-servers/${attachmentId}/nickname-config`,
			data
		)
	}

	async detachDiscordServerFromCorporation(
		corporationId: string,
		attachmentId: string
	): Promise<{ success: boolean }> {
		return this.delete(`/corporations/${corporationId}/discord-servers/${attachmentId}`)
	}

	async assignRoleToCorporationDiscordServer(
		corporationId: string,
		attachmentId: string,
		data: AssignRoleRequest
	): Promise<{ id: string; discordRoleId: string }> {
		return this.post(`/corporations/${corporationId}/discord-servers/${attachmentId}/roles`, data)
	}

	async unassignRoleFromCorporationDiscordServer(
		corporationId: string,
		attachmentId: string,
		roleAssignmentId: string
	): Promise<{ success: boolean }> {
		return this.delete(
			`/corporations/${corporationId}/discord-servers/${attachmentId}/roles/${roleAssignmentId}`
		)
	}

	// ===== Corporation Permissions API Methods =====

	async getCorporationPermissions(
		corporationId: string
	): Promise<{ permissions: CorporationPermissionWithDetails[] }> {
		return this.get(`/corporations/${corporationId}/permissions`)
	}

	async attachPermissionToCorporation(
		corporationId: string,
		permissionId: string
	): Promise<{ permission: CorporationPermissionWithDetails }> {
		return this.post(`/corporations/${corporationId}/permissions`, { permissionId })
	}

	async removePermissionFromCorporation(
		corporationId: string,
		permissionId: string
	): Promise<{ success: boolean }> {
		return this.delete(`/corporations/${corporationId}/permissions/${permissionId}`)
	}

	// ===== Admin User Management API Methods =====

	async getAdminUsers(filters?: AdminUsersFilters): Promise<PaginatedResponse<AdminUser>> {
		const params = new URLSearchParams()
		if (filters?.search) params.set('search', filters.search)
		if (filters?.isAdmin !== undefined) params.set('isAdmin', String(filters.isAdmin))
		if (filters?.page !== undefined)
			params.set('offset', String((filters.page - 1) * (filters.pageSize || 25)))
		if (filters?.pageSize !== undefined) params.set('limit', String(filters.pageSize))

		const query = params.toString()
		const response = await this.get<{
			users: AdminUser[]
			total: number
			limit: number
			offset: number
		}>(`/admin/users${query ? `?${query}` : ''}`)

		// Transform backend response to frontend pagination format
		const pageSize = response.limit
		const currentPage = Math.floor(response.offset / pageSize) + 1
		const totalPages = Math.ceil(response.total / pageSize)

		return {
			data: response.users,
			pagination: {
				page: currentPage,
				pageSize: pageSize,
				totalCount: response.total,
				totalPages: totalPages,
			},
		}
	}

	async getAdminUser(userId: string): Promise<AdminUserDetail> {
		return this.get(`/admin/users/${userId}`)
	}

	async getAdminMumbleAccount(userId: string): Promise<MumbleAccountResponse> {
		return this.get(`/admin/users/${userId}/mumble`)
	}

	async getAdminUserIpHistory(userId: string): Promise<UserIpHistoryResponse> {
		return this.get(`/admin/users/${userId}/ip-history`)
	}

	async getAdminIpHashMatches(ipAddressHash: string): Promise<IpHashMatchesResponse> {
		return this.get(`/admin/ip-history/${encodeURIComponent(ipAddressHash)}/matches`)
	}

	async getHrAuditorUserIpHistory(userId: string): Promise<UserIpHistoryResponse> {
		return this.get(`/hr/audit/users/${userId}/ip-history`)
	}

	async getHrAuditorIpHashMatches(ipAddressHash: string): Promise<IpHashMatchesResponse> {
		return this.get(`/hr/audit/ip-history/${encodeURIComponent(ipAddressHash)}/matches`)
	}

	async setUserAdmin(userId: string, isAdmin: boolean): Promise<{ success: boolean }> {
		return this.post(`/admin/users/${userId}/admin`, { isAdmin })
	}

	async revokeDiscordLink(userId: string): Promise<{ success: boolean }> {
		return this.post(`/admin/users/${userId}/discord/revoke`, {})
	}

	async unlinkDiscordAccount(userId: string): Promise<{ success: boolean }> {
		return this.delete(`/admin/users/${userId}/discord/unlink`)
	}

	async clearUserSessions(userId: string): Promise<{ success: boolean }> {
		return this.post(`/admin/users/${userId}/clear-sessions`, {})
	}

	async syncUser(userId: string): Promise<{ success: boolean; message: string }> {
		return this.post(`/admin/users/${userId}/sync`, {})
	}

	async syncAdminMumbleGroups(userId: string): Promise<MumbleSyncGroupsResponse> {
		return this.post(`/admin/users/${userId}/mumble/sync-groups`)
	}

	async deleteAdminMumbleAccount(userId: string): Promise<MumbleDeleteResponse> {
		return this.delete(`/admin/users/${userId}/mumble`)
	}

	async deleteUserCharacter(userId: string, characterId: string): Promise<{ success: boolean }> {
		return this.delete(`/admin/users/${userId}/characters/${characterId}`)
	}

	async setUserPrimaryCharacter(
		userId: string,
		characterId: string
	): Promise<{ success: boolean }> {
		return this.post(`/admin/users/${userId}/characters/${characterId}/set-primary`)
	}

	async getActivityLogs(
		filters?: AdminActivityLogFilters
	): Promise<PaginatedResponse<AdminActivityLog>> {
		const params = new URLSearchParams()
		if (filters?.userId) params.set('userId', filters.userId)
		if (filters?.characterId) params.set('characterId', filters.characterId)
		if (filters?.action) params.set('action', filters.action)
		if (filters?.startDate) params.set('startDate', filters.startDate)
		if (filters?.endDate) params.set('endDate', filters.endDate)
		if (filters?.page !== undefined) params.set('page', String(filters.page))
		if (filters?.pageSize !== undefined) params.set('pageSize', String(filters.pageSize))

		const query = params.toString()
		return this.get(`/admin/activity-log${query ? `?${query}` : ''}`)
	}

	async triggerDiscordJoin(userId: string): Promise<{
		results: Array<{
			guildId: string
			guildName: string
			corporationName: string
			success: boolean
			errorMessage?: string
			alreadyMember?: boolean
			rolesAdded?: string[]
			roleNamesAdded?: string[]
			rolesRemoved?: string[]
			roleNamesRemoved?: string[]
			attemptedRoleIds?: string[]
			attemptedRoleNames?: string[]
			operation?: 'invite' | 'update' | 'revoke-ban'
		}>
		totalInvited: number
		totalUpdated: number
		totalFailed: number
	}> {
		return this.post(`/admin/users/${userId}/discord/join-servers`)
	}

	async inspectDiscordAccess(userId: string): Promise<AdminDiscordAccessInspection> {
		return this.get(`/admin/users/${userId}/discord/inspect`)
	}

	async inspectOAuthResolver(userId: string): Promise<AdminOAuthResolverInspection> {
		return this.get(`/admin/users/${userId}/oauth/inspect`)
	}

	async refreshCorporationDiscord(
		corporationId: string,
		options?: { allowRemoval?: boolean; force?: boolean }
	): Promise<{
		success: boolean
		message: string
		usersMatched?: number
		usersQueued: number
		usersSkipped?: number
		pendingCount?: number
	}> {
		return this.post(`/admin/corporations/${corporationId}/discord/refresh`, {
			allowRemoval: options?.allowRemoval ?? true,
			force: options?.force ?? true,
		})
	}

	async triggerManualEveCharacterSyncBatch(): Promise<ManualEveCharacterSyncBatchRunResponse> {
		return this.post('/admin/eve-character-sync/manual-run')
	}

	async getManualEveCharacterSyncBatchStatus(
		batchId: string
	): Promise<ManualEveCharacterSyncBatchStatusResponse> {
		return this.get(`/admin/eve-character-sync/manual-run/${batchId}`)
	}

	async getLegacyMigrationQueue(filters?: {
		page?: number
		pageSize?: number
		status?: LegacyMigrationStatus
		modernUserId?: string
		legacyAuthUserId?: string
	}): Promise<{
		items: LegacyMigrationQueueItem[]
		pagination: {
			page: number
			pageSize: number
			total: number
			totalPages: number
		}
	}> {
		const params = new URLSearchParams()
		if (filters?.page) params.set('page', String(filters.page))
		if (filters?.pageSize) params.set('pageSize', String(filters.pageSize))
		if (filters?.status) params.set('status', filters.status)
		if (filters?.modernUserId) params.set('modernUserId', filters.modernUserId)
		if (filters?.legacyAuthUserId) params.set('legacyAuthUserId', filters.legacyAuthUserId)
		const query = params.toString()
		return this.get(`/admin/legacy/migrations${query ? `?${query}` : ''}`)
	}

	async getLegacyMigrationPendingUserCount(): Promise<{ count: number }> {
		return this.get('/admin/legacy/migrations/pending-user-count')
	}

	async getLegacyMigrationQueueItem(id: string): Promise<{
		item: LegacyMigrationQueueItem
		actions: LegacyMigrationAction[]
		candidates: {
			characters: LegacyMigrationCandidateCharacter[]
			notes: LegacyMigrationCandidateNote[]
			ipAddressCount: number
		}
	}> {
		return this.get(`/admin/legacy/migrations/${id}`)
	}

	async applyLegacyMigrationQueueItem(
		id: string,
		payload?: ApplyLegacyMigrationPayload
	): Promise<{ item: LegacyMigrationQueueItem }> {
		return this.post(`/admin/legacy/migrations/${id}/apply`, payload ? { payload } : {})
	}

	async dismissLegacyMigrationQueueItem(
		id: string,
		payload?: Record<string, unknown>
	): Promise<{ item: LegacyMigrationQueueItem }> {
		return this.post(`/admin/legacy/migrations/${id}/dismiss`, payload ? { payload } : {})
	}

	async resolveLegacyMigrationQueueItem(
		id: string,
		payload: { decision: 'accept' | 'reject' | 'needs_review'; note?: string }
	): Promise<{ item: LegacyMigrationQueueItem }> {
		return this.post(`/admin/legacy/migrations/${id}/resolve`, payload)
	}

	async recheckLegacyMigrationQueueUser(modernUserId: string): Promise<{
		ok: boolean
		modernUserId: string
		legacyAuthUserIds?: string[]
		created: number
		updated: number
		dismissed: number
	}> {
		return this.post(`/admin/legacy/migrations/recheck/${modernUserId}`)
	}

	async getLegacyHistory(filters?: {
		page?: number
		pageSize?: number
		corporationId?: string
		characterIds?: string
		characterName?: string
		corporationName?: string
	}): Promise<{
		items: LegacyHistoryApplication[]
		pagination: {
			page: number
			pageSize: number
			total: number
			totalPages: number
		}
	}> {
		const params = new URLSearchParams()
		if (filters?.page) params.set('page', String(filters.page))
		if (filters?.pageSize) params.set('pageSize', String(filters.pageSize))
		if (filters?.corporationId) params.set('corporationId', filters.corporationId)
		if (filters?.characterIds) params.set('characterIds', filters.characterIds)
		if (filters?.characterName) params.set('characterName', filters.characterName)
		if (filters?.corporationName) params.set('corporationName', filters.corporationName)
		const query = params.toString()
		return this.get(`/hr/legacy/history${query ? `?${query}` : ''}`)
	}

	async getLegacyHistoryApplication(legacyApplicationId: string): Promise<{
		application: LegacyHistoryApplication
		events: LegacyHistoryEvent[]
		modernUserMatch: LegacyHistoryModernUserMatch | null
		actorMatches: Record<string, LegacyHistoryActorMatch>
		actorLegacyCharacterNames: Record<string, string>
	}> {
		return this.get(`/hr/legacy/history/${legacyApplicationId}`)
	}

	// ===== Admin Blacklist Management API Methods =====

	async createUserBlacklist(request: CreateUserBlacklistRequest): Promise<{
		userId: string
		autoBlacklisted: {
			characters: string[]
			users: string[]
			totalCount: number
		}
	}> {
		return this.post('/admin/blacklist/user', request)
	}

	async createCharacterBlacklist(request: CreateCharacterBlacklistRequest): Promise<{
		entry: BlacklistEntry
		autoBlacklistedUsers: string[]
		autoBlacklistedCount: number
	}> {
		return this.post('/admin/blacklist/character', request)
	}

	async createDiscordBlacklist(request: CreateDiscordBlacklistRequest): Promise<{
		entry: BlacklistEntry
	}> {
		return this.post('/admin/blacklist/discord', request)
	}

	async getBlacklists(filters?: BlacklistFilters): Promise<PaginatedResponse<BlacklistEntry>> {
		const params = new URLSearchParams()
		if (filters?.targetType) params.set('targetType', filters.targetType)
		if (filters?.isAutoBlacklist !== undefined)
			params.set('isAutoBlacklist', String(filters.isAutoBlacklist))
		if (filters?.search?.trim()) params.set('search', filters.search.trim())
		if (filters?.page !== undefined)
			params.set('offset', String((filters.page - 1) * (filters.pageSize || 50)))
		if (filters?.pageSize !== undefined) params.set('limit', String(filters.pageSize))

		const query = params.toString()
		const response = await this.get<BlacklistResults>(`/admin/blacklist${query ? `?${query}` : ''}`)

		// Transform backend response to frontend pagination format
		const pageSize = response.limit
		const currentPage = Math.floor(response.offset / pageSize) + 1
		const totalPages = Math.ceil(response.total / pageSize)

		return {
			data: response.entries,
			pagination: {
				page: currentPage,
				pageSize: pageSize,
				totalCount: response.total,
				totalPages: totalPages,
			},
		}
	}

	async getUserBlacklists(userId: string): Promise<BlacklistEntry[]> {
		return this.get(`/admin/blacklist/user/${userId}`)
	}

	async getCharacterBlacklists(characterId: string): Promise<BlacklistEntry[]> {
		return this.get(`/admin/blacklist/character/${characterId}`)
	}

	async getBlacklistEntry(id: string): Promise<BlacklistEntry | null> {
		return this.get(`/admin/blacklist/${id}`)
	}

	async removeBlacklistEntry(id: string): Promise<{ success: boolean; removedCount: number }> {
		return this.delete(`/admin/blacklist/${id}`)
	}

	// ===== Broadcasts API =====

	// Broadcast Targets
	async getBroadcastTargets(): Promise<BroadcastTarget[]> {
		return this.get('/broadcasts/targets')
	}

	async getBroadcastTarget(id: string): Promise<BroadcastTarget> {
		return this.get(`/broadcasts/targets/${id}`)
	}

	async createBroadcastTarget(data: CreateBroadcastTargetRequest): Promise<BroadcastTarget> {
		return this.post('/broadcasts/targets', data)
	}

	async updateBroadcastTarget(
		id: string,
		data: UpdateBroadcastTargetRequest
	): Promise<BroadcastTarget> {
		return this.patch(`/broadcasts/targets/${id}`, data)
	}

	async deleteBroadcastTarget(id: string): Promise<{ success: boolean }> {
		return this.delete(`/broadcasts/targets/${id}`)
	}

	// Broadcast Templates
	async getBroadcastTemplates(
		targetType?: string,
		targetId?: string
	): Promise<BroadcastTemplate[]> {
		const params = new URLSearchParams()
		if (targetType) params.set('targetType', targetType)
		if (targetId) params.set('targetId', targetId)
		const query = params.toString()
		return this.get(`/broadcasts/templates${query ? `?${query}` : ''}`)
	}

	async getBroadcastTemplate(id: string): Promise<BroadcastTemplate> {
		return this.get(`/broadcasts/templates/${id}`)
	}

	async createBroadcastTemplate(data: CreateBroadcastTemplateRequest): Promise<BroadcastTemplate> {
		return this.post('/broadcasts/templates', data)
	}

	async updateBroadcastTemplate(
		id: string,
		data: UpdateBroadcastTemplateRequest
	): Promise<BroadcastTemplate> {
		return this.patch(`/broadcasts/templates/${id}`, data)
	}

	async deleteBroadcastTemplate(id: string): Promise<{ success: boolean }> {
		return this.delete(`/broadcasts/templates/${id}`)
	}

	// Broadcasts
	async getBroadcasts(
		permissionId?: string,
		status?: BroadcastStatus,
		options?: { limit?: number; offset?: number; mine?: boolean; targetId?: string }
	): Promise<BroadcastListResponse> {
		const params = new URLSearchParams()
		if (permissionId) params.set('permissionId', permissionId)
		if (status) params.set('status', status)
		if (options?.limit !== undefined) params.set('limit', String(options.limit))
		if (options?.offset !== undefined) params.set('offset', String(options.offset))
		if (options?.mine) params.set('mine', 'true')
		if (options?.targetId) params.set('targetId', options.targetId)
		const query = params.toString()
		return this.get(`/broadcasts${query ? `?${query}` : ''}`)
	}

	async getBroadcast(id: string): Promise<BroadcastWithDetails> {
		return this.get(`/broadcasts/${id}`)
	}

	async createBroadcast(data: CreateBroadcastRequest): Promise<Broadcast> {
		return this.post('/broadcasts', data)
	}

	async updateBroadcast(id: string, data: UpdateBroadcastRequest): Promise<Broadcast> {
		return this.patch(`/broadcasts/${id}`, data)
	}

	async sendBroadcast(id: string): Promise<SendBroadcastResponse> {
		return this.post(`/broadcasts/${id}/send`)
	}

	async deleteBroadcast(id: string): Promise<{ success: boolean }> {
		return this.delete(`/broadcasts/${id}`)
	}

	async rescindBroadcast(id: string, rescindMessage?: string): Promise<{ success: boolean }> {
		return this.post(`/broadcasts/${id}/rescind`, { rescindMessage })
	}

	async addBroadcastAddendum(id: string, addendumMessage: string): Promise<{ success: boolean }> {
		return this.post(`/broadcasts/${id}/addendum`, { addendumMessage })
	}

	async getBroadcastDeliveries(broadcastId: string): Promise<BroadcastDelivery[]> {
		return this.get(`/broadcasts/${broadcastId}/deliveries`)
	}

	// ===== Fleet API Methods =====

	async getCharacterFleetInfo(characterId: string): Promise<{
		isInFleet: boolean
		fleet_id: string
		fleet_boss_id: string
		role: string
		squad_id: number
		wing_id: number
		activeSession?: TrackingSession | null
		existingSession?: TrackingSession | null
	}> {
		return this.get(`/fleets/character/${characterId}`)
	}

	async createFleetQuickJoin(
		characterId: string,
		fleetId: string
	): Promise<{
		token: string
		url: string
		expiresAt: Date
	}> {
		return this.post('/fleets/quick-join/create', {
			characterId,
			fleetId,
			expiresInHours: 24,
		})
	}

	// ===== SRP (Ship Replacement Program) API Methods =====

	/**
	 * Get recent losses for all user's characters with SRP status
	 */
	async getRecentLosses(params?: { limit?: number; offset?: number }): Promise<RecentLossesResponse> {
		const searchParams = new URLSearchParams()
		if (params?.limit !== undefined) searchParams.set('limit', String(params.limit))
		if (params?.offset !== undefined) searchParams.set('offset', String(params.offset))
		const query = searchParams.toString()
		return this.get(`/srp/losses${query ? `?${query}` : ''}`)
	}

	async dismissRecentLoss(killmailId: string): Promise<{ success: true }> {
		return this.post(`/srp/losses/${encodeURIComponent(killmailId)}/dismiss`, {})
	}

	/**
	 * Create a new SRP request
	 */
	async getKillmailPreview(
		killmailId: string,
		killmailHash: string,
		characterId: string
	): Promise<any> {
		const params = new URLSearchParams({ killmailId, killmailHash, characterId })
		return this.get(`/srp/losses/preview?${params}`)
	}

	async createSRPRequest(data: {
		characterId: string
		killmailId: string
		killmailHash: string
		contextText: string
	}): Promise<any> {
		return this.post('/srp/requests', data)
	}

	/**
	 * Get user's own SRP requests (paginated)
	 */
	async getMyRequests(params?: { limit?: number; offset?: number; status?: string }): Promise<RequestListResponse> {
		const searchParams = new URLSearchParams()
		if (params?.limit) searchParams.set('limit', String(params.limit))
		if (params?.offset) searchParams.set('offset', String(params.offset))
		if (params?.status) searchParams.set('status', params.status)

		const query = searchParams.toString()
		return this.get(`/srp/requests${query ? `?${query}` : ''}`)
	}

	/**
	 * Get single SRP request by ID
	 */
	async getRequest(id: string): Promise<any> {
		return this.get(`/srp/requests/${id}`)
	}

	/**
	 * Get pending requests for review (paginated)
	 */
	async getPendingRequests(params?: {
		corporationId?: string
		limit?: number
		offset?: number
	}): Promise<{
		requests: any[]
		total: number
		limit: number
		offset: number
	}> {
		const searchParams = new URLSearchParams()
		if (params?.corporationId) searchParams.set('corporationId', params.corporationId)
		if (params?.limit) searchParams.set('limit', String(params.limit))
		if (params?.offset) searchParams.set('offset', String(params.offset))

		const query = searchParams.toString()
		return this.get(`/srp/pending${query ? `?${query}` : ''}`)
	}

	/**
	 * Approve an SRP request
	 */
	async approveRequest(
		id: string,
		data: {
			approvedAmount: string
			reviewNotes?: string
		}
	): Promise<any> {
		return this.post(`/srp/requests/${id}/approve`, data)
	}

	/**
	 * Partially approve an SRP request
	 */
	async partiallyApproveRequest(
		id: string,
		data: {
			approvedAmount: string
			rejectionReason: string
			reviewNotes?: string
		}
	): Promise<any> {
		return this.post(`/srp/requests/${id}/partially-approve`, data)
	}

	/**
	 * Reject an SRP request
	 */
	async rejectRequest(
		id: string,
		data: {
			rejectionReason: string
			reviewNotes?: string
		}
	): Promise<any> {
		return this.post(`/srp/requests/${id}/reject`, data)
	}

	/**
	 * Get comments for a request
	 */
	async getRequestComments(requestId: string, includeInternal: boolean = false): Promise<any[]> {
		return this.get(`/srp/requests/${requestId}/comments?includeInternal=${includeInternal}`)
	}

	/**
	 * Add a comment to a request
	 */
	async addComment(
		requestId: string,
		data: {
			content: string
			visibility: 'public' | 'internal'
		}
	): Promise<any> {
		return this.post(`/srp/requests/${requestId}/comments`, data)
	}

	/**
	 * Update a comment
	 */
	async updateComment(commentId: string, content: string): Promise<any> {
		return this.patch(`/srp/comments/${commentId}`, { content })
	}

	/**
	 * Delete a comment
	 */
	async deleteComment(commentId: string): Promise<void> {
		return this.delete(`/srp/comments/${commentId}`)
	}

	/**
	 * Get pending payments (approved requests awaiting payment)
	 */
	async getPendingPayments(params?: {
		corporationId?: string
		limit?: number
		offset?: number
	}): Promise<{
		requests: any[]
		total: number
		limit: number
		offset: number
	}> {
		const searchParams = new URLSearchParams()
		if (params?.corporationId) searchParams.set('corporationId', params.corporationId)
		if (params?.limit) searchParams.set('limit', String(params.limit))
		if (params?.offset) searchParams.set('offset', String(params.offset))

		const query = searchParams.toString()
		return this.get(`/srp/payments/pending${query ? `?${query}` : ''}`)
	}

	async getRequestCountByStatus(
		status: 'pending' | 'needs_context' | 'approved' | 'payment_pending' | 'rejected' | 'paid',
		params?: {
			characterName?: string
			shipTypeName?: string
			solarSystemName?: string
			dateFrom?: string
			dateTo?: string
		}
	): Promise<{ total: number }> {
		const searchParams = new URLSearchParams()
		searchParams.set('status', status)
		if (params?.characterName) searchParams.set('characterName', params.characterName)
		if (params?.shipTypeName) searchParams.set('shipTypeName', params.shipTypeName)
		if (params?.solarSystemName) searchParams.set('solarSystemName', params.solarSystemName)
		if (params?.dateFrom) searchParams.set('dateFrom', params.dateFrom)
		if (params?.dateTo) searchParams.set('dateTo', params.dateTo)

		return this.get(`/srp/requests/by-status/count?${searchParams.toString()}`)
	}

	async getPendingPayoutTotal(params?: {
		corporationId?: string
	}): Promise<{ pendingPayoutTotal: string }> {
		const searchParams = new URLSearchParams()
		if (params?.corporationId) searchParams.set('corporationId', params.corporationId)

		const query = searchParams.toString()
		return this.get(`/srp/payments/pending-total${query ? `?${query}` : ''}`)
	}

	async getSrpWalletHistory(params?: {
		reason?: string
		recipientId?: string
		alertsOnly?: boolean
		dateFrom?: string
		dateTo?: string
		limit?: number
		offset?: number
	}): Promise<{
		items: Array<{
			linkedRequestId?: string | null
			hasRecipientMismatch?: boolean
			hasMissingReasonWarning?: boolean
			journalId: string
			refType?: string | null
			amount: string
			reason?: string | null
			recipientId?: string | null
			recipientName?: string | null
			entryDate: string
			matchingAlertKinds?: string[]
			alertDetail?: {
				expectedAmount?: string | null
				observedAmount?: string | null
				expectedRecipientCharacterId?: string | null
				expectedRecipientCharacterName?: string | null
				actualRecipientCharacterId?: string | null
				actualRecipientCharacterName?: string | null
			} | null
			hasOpenAlert?: boolean
		}>
		total: number
		limit: number
		offset: number
	}> {
		const searchParams = new URLSearchParams()
		if (params?.reason) searchParams.set('reason', params.reason)
		if (params?.recipientId) searchParams.set('recipientId', params.recipientId)
		if (params?.alertsOnly) searchParams.set('alertsOnly', 'true')
		if (params?.dateFrom) searchParams.set('dateFrom', params.dateFrom)
		if (params?.dateTo) searchParams.set('dateTo', params.dateTo)
		if (params?.limit !== undefined) searchParams.set('limit', String(params.limit))
		if (params?.offset !== undefined) searchParams.set('offset', String(params.offset))

		const query = searchParams.toString()
		return this.get(`/srp/payments/wallet-history${query ? `?${query}` : ''}`)
	}

	async searchSrpWalletHistoryValues(params: {
		field: 'reason' | 'recipient'
		query: string
	}): Promise<Array<{ value: string; label: string; description?: string }>> {
		const searchParams = new URLSearchParams()
		searchParams.set('field', params.field)
		searchParams.set('q', params.query)
		const result = await this.get<{
			values: Array<{ value: string; label: string; description?: string }>
		}>(`/srp/payments/wallet-history/search-values?${searchParams.toString()}`)
		return result.values ?? []
	}

	async requestSrpWalletHistoryCsvExport(params?: {
		reason?: string
		recipientId?: string
		alertsOnly?: boolean
		dateFrom?: string
		dateTo?: string
	}): Promise<{
		workflowInstanceId: string
		exportId: string
		fileName: string
		status: 'queued'
	}> {
		if (
			!params?.dateFrom ||
			!params?.dateTo ||
			!isDateRangeWithinOneYear(params.dateFrom, params.dateTo)
		) {
			throw new Error(
				'Entry date range is required for wallet history export and must not exceed 1 year'
			)
		}

		const searchParams = new URLSearchParams()
		if (params.reason) searchParams.set('reason', params.reason)
		if (params.recipientId) searchParams.set('recipientId', params.recipientId)
		if (params.alertsOnly) searchParams.set('alertsOnly', 'true')
		searchParams.set('dateFrom', params.dateFrom)
		searchParams.set('dateTo', params.dateTo)

		const response = await fetch(
			`/api/srp/payments/wallet-history/export?${searchParams.toString()}`,
			{
				method: 'POST',
				credentials: 'include',
				headers: {
					'X-Requested-With': 'XMLHttpRequest',
				},
			}
		)
		if (!response.ok) {
			const message = await response.text()
			throw new Error(message || 'Failed to request SRP wallet history export')
		}

		return (await response.json()) as {
			workflowInstanceId: string
			exportId: string
			fileName: string
			status: 'queued'
		}
	}

	async getSrpWalletHistoryCsvExportStatus(workflowInstanceId: string): Promise<{
		workflowInstanceId: string
		status: 'queued' | 'running' | 'completed' | 'failed' | 'unknown'
		rawStatus?: string
		output: unknown | null
	}> {
		return this.get(`/srp/payments/wallet-history/export/${workflowInstanceId}`)
	}

	async downloadSrpWalletHistoryCsv(workflowInstanceId: string, fileName: string): Promise<void> {
		const response = await fetch(
			`/api/srp/payments/wallet-history/export/${workflowInstanceId}/download`,
			{
				credentials: 'include',
				headers: {
					'X-Requested-With': 'XMLHttpRequest',
				},
			}
		)
		if (!response.ok) {
			const message = await response.text()
			throw new Error(message || 'Failed to export SRP wallet history')
		}

		const csv = await response.text()
		downloadTextFile(fileName, 'text/csv; charset=utf-8', csv)
	}

	async requestSrpPaidRequestsCsvExport(params: {
		characterName?: string
		shipTypeName?: string
		solarSystemName?: string
		dateFrom: string
		dateTo: string
	}): Promise<{
		workflowInstanceId: string
		exportId: string
		fileName: string
		status: 'queued'
	}> {
		if (!isDateRangeWithinOneYear(params.dateFrom, params.dateTo)) {
			throw new Error('Paid SRP export requires a date range of no more than 1 year')
		}

		const searchParams = new URLSearchParams()
		if (params.characterName) searchParams.set('characterName', params.characterName)
		if (params.shipTypeName) searchParams.set('shipTypeName', params.shipTypeName)
		if (params.solarSystemName) searchParams.set('solarSystemName', params.solarSystemName)
		searchParams.set('dateFrom', params.dateFrom)
		searchParams.set('dateTo', params.dateTo)

		const query = searchParams.toString()
		const response = await fetch(`/api/srp/requests/paid/export${query ? `?${query}` : ''}`, {
			method: 'POST',
			credentials: 'include',
			headers: {
				'X-Requested-With': 'XMLHttpRequest',
			},
		})
		if (!response.ok) {
			const message = await response.text()
			throw new Error(message || 'Failed to request paid SRP export')
		}

		return (await response.json()) as {
			workflowInstanceId: string
			exportId: string
			fileName: string
			status: 'queued'
		}
	}

	async getSrpPaidRequestsCsvExportStatus(workflowInstanceId: string): Promise<{
		workflowInstanceId: string
		status: 'queued' | 'running' | 'completed' | 'failed' | 'unknown'
		rawStatus?: string
		output: unknown | null
	}> {
		return this.get(`/srp/requests/paid/export/${workflowInstanceId}`)
	}

	async downloadSrpPaidRequestsCsv(workflowInstanceId: string, fileName: string): Promise<void> {
		const response = await fetch(`/api/srp/requests/paid/export/${workflowInstanceId}/download`, {
			credentials: 'include',
			headers: {
				'X-Requested-With': 'XMLHttpRequest',
			},
		})
		if (!response.ok) {
			const message = await response.text()
			throw new Error(message || 'Failed to download paid SRP requests')
		}

		const csv = await response.text()
		downloadTextFile(fileName, 'text/csv; charset=utf-8', csv)
	}

	async getSrpPaymentMismatchAlerts(params?: {
		includeAcknowledged?: boolean
		limit?: number
		offset?: number
	}): Promise<{ alerts: any[]; total: number }> {
		const searchParams = new URLSearchParams()
		if (params?.includeAcknowledged !== undefined) {
			searchParams.set('includeAcknowledged', String(params.includeAcknowledged))
		}
		if (params?.limit !== undefined) searchParams.set('limit', String(params.limit))
		if (params?.offset !== undefined) searchParams.set('offset', String(params.offset))

		const query = searchParams.toString()
		return this.get(`/srp/alerts/payment-mismatches${query ? `?${query}` : ''}`)
	}

	async acknowledgeSrpPaymentMismatchAlert(alertId: string): Promise<any> {
		return this.post(`/srp/alerts/payment-mismatches/${alertId}/acknowledge`, {})
	}

	/**
	 * Mark request as fully paid
	 */
	async markPaid(id: string): Promise<any> {
		return this.post(`/srp/requests/${id}/mark-paid`, {})
	}

	async verifyPaid(id: string): Promise<any> {
		return this.post(`/srp/requests/${id}/verify-paid`, {})
	}

	/**
	 * Get active SRP configuration
	 */
	async getSRPConfig(): Promise<any> {
		return this.get('/srp/config')
	}

	async getSRPDiscordGuilds(): Promise<Array<{ id: string; guildId: string; guildName: string }>> {
		return this.get('/srp/config/discord-guilds')
	}

	async searchSRPPaymentProcessorCorporations(
		query: string
	): Promise<Array<{ corporationId: string; name: string }>> {
		return this.get(
			`/srp/config/payment-processor-corporations/search?q=${encodeURIComponent(query)}`
		)
	}

	/**
	 * Update SRP configuration (admin only)
	 */
	async updateSRPConfig(data: UpdateSRPConfig): Promise<unknown> {
		return this.patch('/srp/config', data)
	}

	/**
	 * Get SRP statistics (admin only)
	 */
	async getSRPStats(params?: {
		startDate?: string
		endDate?: string
		corporationId?: string
	}): Promise<any> {
		const searchParams = new URLSearchParams()
		if (params?.startDate) searchParams.set('startDate', params.startDate)
		if (params?.endDate) searchParams.set('endDate', params.endDate)
		if (params?.corporationId) searchParams.set('corporationId', params.corporationId)

		const query = searchParams.toString()
		return this.get(`/srp/stats${query ? `?${query}` : ''}`)
	}

	async refreshLosses(): Promise<{
		allowed: boolean
		retryAfterMs: number
		cooldownUntil: string
		workflowInstanceId?: string
		status?: 'queued' | 'running' | 'completed' | 'failed'
		totalCharacters?: number
	}> {
		return this.post('/srp/losses/refresh', {})
	}

	async getRecentLossRefreshStatus(): Promise<{
		status: {
			userId: string
			workflowInstanceId: string
			status: 'queued' | 'running' | 'completed' | 'failed'
			totalCharacters: number
			processedCharacters: number
			successfulCharacters: number
			failedCharacters: number
			queuedAt: string
			updatedAt: string
			startedAt?: string
			completedAt?: string
			currentCharacterId?: string
			currentCharacterName?: string
			lastError?: string
			failures: Array<{
				characterId: string
				characterName: string
				reason: 'invalid_token' | 'cache_missing' | 'cache_incomplete' | 'fetch_failed'
				message: string
				error?: string
			}>
			maxLossAgeDays: number
		} | null
		cooldownUntil: string | null
	} | null> {
		return this.get('/srp/losses/refresh/status')
	}

	async getRequestsByStatus(params: {
		status: string
		limit?: number
		offset?: number
		characterName?: string
		shipTypeName?: string
		solarSystemName?: string
		dateFrom?: string
		dateTo?: string
	}): Promise<any> {
		const searchParams = new URLSearchParams()
		searchParams.set('status', params.status)
		if (params.limit !== undefined) searchParams.set('limit', String(params.limit))
		if (params.offset !== undefined) searchParams.set('offset', String(params.offset))
		if (params.characterName) searchParams.set('characterName', params.characterName)
		if (params.shipTypeName) searchParams.set('shipTypeName', params.shipTypeName)
		if (params.solarSystemName) searchParams.set('solarSystemName', params.solarSystemName)
		if (params.dateFrom) searchParams.set('dateFrom', params.dateFrom)
		if (params.dateTo) searchParams.set('dateTo', params.dateTo)
		return this.get(`/srp/requests/by-status?${searchParams.toString()}`)
	}

	async getSrpReviewSearchValues(params: {
		status: string
		field: 'character' | 'ship' | 'system'
		query: string
	}): Promise<Array<{ value: string }>> {
		const searchParams = new URLSearchParams()
		searchParams.set('status', params.status)
		searchParams.set('field', params.field)
		searchParams.set('query', params.query)
		return this.get(`/srp/requests/search-values?${searchParams.toString()}`)
	}

	async submitReview(id: string, data: any): Promise<any> {
		return this.post(`/srp/requests/${id}/review`, data)
	}

	async updateReviewState(id: string, data: { newState: string; notes?: string }): Promise<any> {
		return this.patch(`/srp/requests/${id}/state`, data)
	}

	async withdrawSRPRequest(id: string, data?: { notes?: string }): Promise<any> {
		return this.post(`/srp/requests/${id}/withdraw`, data ?? {})
	}

	async getSRPPolicies(): Promise<any[]> {
		return this.get('/srp/policies')
	}

	async createSRPPolicy(data: any): Promise<any> {
		return this.post('/srp/policies', data)
	}

	async updateSRPPolicy(id: string, data: any): Promise<any> {
		return this.patch(`/srp/policies/${id}`, data)
	}

	async deleteSRPPolicy(id: string): Promise<void> {
		return this.delete(`/srp/policies/${id}`)
	}

	// ===== Feature Flags =====

	async getFeatureFlags(): Promise<Record<string, boolean>> {
		return this.get('/flags')
	}

	// ===== Doctrines API Methods =====

	// Doctrines
	async getDoctrines(filters?: ListDoctrinesFilters): Promise<Doctrine[]> {
		const params = new URLSearchParams()
		if (filters?.search) params.set('search', filters.search)

		const query = params.toString()
		return this.get(`/doctrines${query ? `?${query}` : ''}`)
	}

	async getDoctrine(id: string): Promise<DoctrineWithFittings> {
		return this.get(`/doctrines/${id}`)
	}

	async createDoctrine(data: CreateDoctrineRequest): Promise<Doctrine> {
		return this.post('/doctrines', data)
	}

	async updateDoctrine(id: string, data: UpdateDoctrineRequest): Promise<Doctrine> {
		return this.patch(`/doctrines/${id}`, data)
	}

	async deleteDoctrine(id: string): Promise<void> {
		return this.delete(`/doctrines/${id}`)
	}

	async addFittingToDoctrine(doctrineId: string, data: AddFittingToDoctrineRequest): Promise<void> {
		return this.post(`/doctrines/${doctrineId}/fittings`, data)
	}

	async updateDoctrineFitting(
		doctrineId: string,
		fittingId: string,
		data: UpdateDoctrineFittingRequest
	): Promise<void> {
		return this.patch(`/doctrines/${doctrineId}/fittings/${fittingId}`, data)
	}

	async removeFittingFromDoctrine(doctrineId: string, fittingId: string): Promise<void> {
		return this.delete(`/doctrines/${doctrineId}/fittings/${fittingId}`)
	}

	// Ship Type Search
	async searchShipTypes(query: string): Promise<Array<{ typeId: string; typeName: string }>> {
		const params = new URLSearchParams({ q: query })
		return this.get(`/doctrines/search/types?${params.toString()}`)
	}

	async searchUniverseSystems(
		query: string
	): Promise<Array<{ id: string; name: string; systemId: string; systemName: string }>> {
		const params = new URLSearchParams({ q: query })
		return this.get(`/universe/search/systems?${params.toString()}`)
	}

	// Categories
	async getDoctrineCategories(): Promise<DoctrineCategory[]> {
		return this.get('/doctrines/categories')
	}

	async createDoctrineCategory(data: {
		name: string
		sortOrder?: number
	}): Promise<DoctrineCategory> {
		return this.post('/doctrines/categories', data)
	}

	async updateDoctrineCategory(
		id: string,
		data: { name?: string; sortOrder?: number }
	): Promise<DoctrineCategory> {
		return this.patch(`/doctrines/categories/${id}`, data)
	}

	async deleteDoctrineCategory(id: string): Promise<void> {
		return this.delete(`/doctrines/categories/${id}`)
	}

	// Staging Systems
	async getStagingSystems(): Promise<StagingSystem[]> {
		return this.get('/doctrines/staging-systems')
	}

	async createStagingSystem(data: {
		solarSystemId: string
		solarSystemName: string
		sortOrder?: number
	}): Promise<StagingSystem> {
		return this.post('/doctrines/staging-systems', data)
	}

	async updateStagingSystem(
		id: string,
		data: { solarSystemId?: string; solarSystemName?: string; sortOrder?: number }
	): Promise<StagingSystem> {
		return this.patch(`/doctrines/staging-systems/${id}`, data)
	}

	async deleteStagingSystem(id: string): Promise<void> {
		return this.delete(`/doctrines/staging-systems/${id}`)
	}

	// Doctrine-Staging
	async setDoctrineStagingSystem(
		doctrineId: string,
		data: { stagingSystemId: string; note: string }
	): Promise<void> {
		return this.put(`/doctrines/${doctrineId}/staging-systems`, data)
	}

	async removeDoctrineStagingSystem(doctrineId: string, stagingSystemId: string): Promise<void> {
		return this.delete(`/doctrines/${doctrineId}/staging-systems/${stagingSystemId}`)
	}

	// Fittings
	async getFittings(filters?: ListFittingsFilters): Promise<Fitting[]> {
		const params = new URLSearchParams()
		if (filters?.shipTypeId) params.set('shipTypeId', filters.shipTypeId)
		if (filters?.category) params.set('category', filters.category)
		if (filters?.srpEligible !== undefined) params.set('srpEligible', String(filters.srpEligible))
		if (filters?.search) params.set('search', filters.search)

		const query = params.toString()
		return this.get(`/doctrines/fittings${query ? `?${query}` : ''}`)
	}

	async getFitting(id: string): Promise<FittingWithItems> {
		return this.get(`/doctrines/fittings/${id}`)
	}

	async createFitting(data: CreateFittingRequest): Promise<Fitting> {
		return this.post('/doctrines/fittings', data)
	}

	async updateFitting(id: string, data: UpdateFittingRequest): Promise<Fitting> {
		return this.patch(`/doctrines/fittings/${id}`, data)
	}

	async deleteFitting(id: string): Promise<void> {
		return this.delete(`/doctrines/fittings/${id}`)
	}

	async getFittingsWithDoctrines(): Promise<FittingWithDoctrines[]> {
		return this.get('/doctrines/fittings/with-doctrines')
	}

	async saveFittingIngame(
		fittingId: string,
		characterId: string
	): Promise<SaveFittingIngameResponse> {
		return this.post(`/doctrines/fittings/${fittingId}/save-ingame`, { characterId })
	}

	async previewEft(eftString: string): Promise<ParsedFittingPreview> {
		return this.post('/doctrines/fittings/preview', { eftString })
	}

	// ===== Industry Admin API Methods =====

	/**
	 * List industry providers with optional filters
	 */
	async getIndustryProviders(filters?: IndustryProviderFilters): Promise<ServiceProvider[]> {
		const params = new URLSearchParams()
		if (filters?.ownerEntityId) params.set('ownerEntityId', filters.ownerEntityId)
		if (filters?.ownerEntityType) params.set('ownerEntityType', filters.ownerEntityType)
		if (filters?.acceptingOrders !== undefined)
			params.set('acceptingOrders', String(filters.acceptingOrders))
		if (filters?.limit) params.set('limit', String(filters.limit))
		if (filters?.offset) params.set('offset', String(filters.offset))

		const query = params.toString()
		return this.get(`/admin/industry/providers${query ? `?${query}` : ''}`)
	}

	/**
	 * Get a specific industry provider by ID
	 */
	async getIndustryProvider(providerId: string): Promise<ServiceProvider> {
		return this.get(`/admin/industry/providers/${providerId}`)
	}

	/**
	 * Create a new industry provider
	 */
	async createIndustryProvider(data: CreateIndustryProviderRequest): Promise<ServiceProvider> {
		return this.post('/admin/industry/providers', data)
	}

	/**
	 * Update an existing industry provider
	 */
	async updateIndustryProvider(
		providerId: string,
		data: UpdateIndustryProviderRequest
	): Promise<ServiceProvider> {
		return this.patch(`/admin/industry/providers/${providerId}`, data)
	}

	/**
	 * Delete an industry provider
	 */
	async deleteIndustryProvider(providerId: string): Promise<{ message: string }> {
		return this.delete(`/admin/industry/providers/${providerId}`)
	}

	/**
	 * Set provider accepting orders status
	 */
	async setProviderAcceptingOrders(
		providerId: string,
		acceptingOrders: boolean
	): Promise<ServiceProvider> {
		return this.post(`/admin/industry/providers/${providerId}/accepting-orders`, {
			acceptingOrders,
		})
	}

	/**
	 * List services for a provider
	 */
	async getProviderServices(providerId: string): Promise<ProviderServiceDTO[]> {
		return this.get(`/admin/industry/providers/${providerId}/services`)
	}

	/**
	 * Add a service to a provider
	 */
	async addProviderService(
		providerId: string,
		serviceType: ServiceType
	): Promise<ProviderServiceDTO> {
		return this.post(`/admin/industry/providers/${providerId}/services`, { serviceType })
	}

	/**
	 * Remove a service from a provider
	 */
	async removeProviderService(
		providerId: string,
		serviceType: ServiceType
	): Promise<{ message: string }> {
		return this.delete(`/admin/industry/providers/${providerId}/services/${serviceType}`)
	}

	/**
	 * Update a service's status
	 */
	async updateProviderServiceStatus(
		providerId: string,
		serviceType: ServiceType,
		status: ServiceStatus
	): Promise<ProviderServiceDTO> {
		return this.patch(`/admin/industry/providers/${providerId}/services/${serviceType}/status`, {
			status,
		})
	}

	/**
	 * Get industry statistics
	 */
	async getIndustryStats(): Promise<IndustryProviderStatistics> {
		return this.get('/admin/industry/stats')
	}

	// ===== User Services API Methods =====

	/**
	 * Get current user's services
	 */
	async getUserServices(): Promise<UserService[]> {
		return this.get('/users/me/services')
	}

	/**
	 * Reset password for a service
	 */
	async resetServicePassword(slug: string): Promise<ResetServicePasswordResponse> {
		return this.post(`/services/${slug}/reset`)
	}

	// ===== Mumble API Methods =====

	/**
	 * Get current user's Mumble account status and connection info
	 */
	async getMumbleAccount(): Promise<MumbleAccountResponse> {
		return this.get('/mumble/account')
	}

	/**
	 * Provision a Mumble account. The returned password is shown exactly once.
	 */
	async createMumbleAccount(): Promise<MumbleProvisionResponse> {
		return this.post('/mumble/account')
	}

	/**
	 * Rotate the Mumble password. The returned password is shown exactly once.
	 */
	async resetMumblePassword(): Promise<{ password: string; connection: MumbleConnectionInfo }> {
		return this.post('/mumble/account/reset-password')
	}

	// ===== Mumble Temp-Op API Methods =====

	/** Create a temp-op. The returned token is shown exactly once. */
	async createTempop(input: {
		ttlPreset?: '1h' | '4h' | '6h'
		customHours?: number
	}): Promise<CreateTempopResponse> {
		return this.post('/mumble-tempop', input)
	}

	/** List temp-ops with optional filters. */
	async listTempops(filters: TempopListFilters = {}): Promise<TempopListResponse> {
		const params = new URLSearchParams()
		if (filters.status) params.set('status', filters.status)
		if (filters.creatorId) params.set('creatorId', filters.creatorId)
		if (filters.mine) params.set('mine', 'true')
		if (filters.page != null) params.set('page', String(filters.page))
		if (filters.pageSize != null) params.set('pageSize', String(filters.pageSize))
		const qs = params.toString()
		return this.get(`/mumble-tempop${qs ? `?${qs}` : ''}`)
	}

	/** Delete a temp-op, disconnecting all of its guests. */
	async deleteTempop(id: string): Promise<{ success: boolean; disconnected: number }> {
		return this.delete(`/mumble-tempop/${encodeURIComponent(id)}`)
	}

	/** Public: resolve a temp-op by its URL token (no auth). */
	async getTempopInfo(key: string): Promise<TempopInfo> {
		return this.requestPublic(`/api/public/mumble-tempop/${encodeURIComponent(key)}`, {
			method: 'GET',
		})
	}

	/** Public: begin the guest publicData SSO; returns the authorization URL. */
	async startTempopSso(key: string): Promise<{ authorizationUrl: string }> {
		return this.requestPublic(`/api/public/mumble-tempop/${encodeURIComponent(key)}/start-sso`, {
			method: 'POST',
		})
	}

	/** Public: exchange a single-use handoff token for the guest credentials. */
	async getTempopCredentials(key: string, handoff: string): Promise<TempopCredentialsResponse> {
		return this.requestPublic(
			`/api/public/mumble-tempop/${encodeURIComponent(key)}/credentials?h=${encodeURIComponent(handoff)}`,
			{ method: 'GET' }
		)
	}

	// ===== Freight API Methods =====

	/**
	 * Get active freight routes (available to all authenticated users)
	 */
	async getActiveFreightRoutes(): Promise<FreightRoute[]> {
		return this.get('/freight/routes/active')
	}

	// ===== Pastes API =====
	async createPaste(input: {
		name: string
		content: string
		visibility: 'alliance' | 'public'
		expiration: number | 'indefinite'
		password?: string
	}): Promise<PasteRecord> {
		return this.post('/pastes', input)
	}

	async getMyPastes(
		limit = 50,
		offset = 0
	): Promise<{
		items: PasteRecord[]
		total: number
		activeCount: number
		maxActivePastesPerUser: number
	}> {
		return this.get(`/pastes/mine?limit=${limit}&offset=${offset}`)
	}

	async getPasteForAlliance(id: string): Promise<PasteViewerResponse> {
		return this.get(`/pastes/${encodeURIComponent(id)}`)
	}

	async decryptPasteForAlliance(id: string, password: string): Promise<PasteViewerResponse> {
		return this.post(`/pastes/${encodeURIComponent(id)}/decrypt`, { password })
	}

	async updatePaste(
		id: string,
		input: {
			name?: string
			content?: string
			visibility?: 'alliance' | 'public'
			expiration?: number | 'indefinite'
			isPasswordProtected?: boolean
			password?: string
		}
	): Promise<PasteRecord> {
		return this.patch(`/pastes/${encodeURIComponent(id)}`, input)
	}

	async rotatePastePassword(
		id: string,
		input: { currentPassword: string; newPassword: string }
	): Promise<PasteRecord> {
		return this.post(`/pastes/${encodeURIComponent(id)}/rotate-password`, input)
	}

	async deletePaste(id: string): Promise<{ success: boolean }> {
		return this.delete(`/pastes/${encodeURIComponent(id)}`)
	}

	async getPasteSettings(): Promise<PasteSettings> {
		return this.get('/pastes/settings')
	}

	async getAdminPastes(input?: {
		limit?: number
		offset?: number
		visibility?: 'alliance' | 'public'
		creatorUserId?: string
		createdFrom?: string
		createdTo?: string
		expiresFrom?: string
		expiresTo?: string
	}): Promise<{ items: PasteRecord[]; total: number }> {
		const params = new URLSearchParams()
		params.set('limit', String(input?.limit ?? 50))
		params.set('offset', String(input?.offset ?? 0))
		if (input?.visibility) params.set('visibility', input.visibility)
		if (input?.creatorUserId) params.set('creatorUserId', input.creatorUserId)
		if (input?.createdFrom) params.set('createdFrom', input.createdFrom)
		if (input?.createdTo) params.set('createdTo', input.createdTo)
		if (input?.expiresFrom) params.set('expiresFrom', input.expiresFrom)
		if (input?.expiresTo) params.set('expiresTo', input.expiresTo)
		return this.get(`/pastes/admin/list?${params.toString()}`)
	}

	async updatePasteSettings(input: {
		createRateLimitCount: number
		createRateLimitWindowMinutes: number
		maxActivePastesPerUser: number
	}): Promise<PasteSettings> {
		return this.put('/pastes/admin/settings', input)
	}

	async adminDeletePaste(id: string): Promise<{ success: boolean }> {
		return this.delete(`/pastes/admin/${encodeURIComponent(id)}`)
	}

	async getPasteForPublic(id: string): Promise<PasteViewerResponse> {
		return this.requestPublic(`/api/public/paste/${encodeURIComponent(id)}`, { method: 'GET' })
	}

	async decryptPasteForPublic(id: string, password: string): Promise<PasteViewerResponse> {
		return this.requestPublic(`/api/public/paste/${encodeURIComponent(id)}/decrypt`, {
			method: 'POST',
			body: JSON.stringify({ password }),
		})
	}
}

export const apiClient = new ApiClient()

// Export the full API client as api
export const api = apiClient
