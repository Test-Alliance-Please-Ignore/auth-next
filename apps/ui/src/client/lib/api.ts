/**
 * API client for making requests to the core worker
 */

const API_BASE_URL = import.meta.env.PROD ? '/api' : 'http://localhost:8787/api'

export interface ApiError {
	message: string
	status: number
}

/**
 * Base error class for API errors
 */
export class BaseApiError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message)
		this.name = 'BaseApiError'
	}
}

/**
 * Network-related errors (fetch failures, timeouts, etc.)
 */
export class NetworkError extends Error {
	constructor(message: string = 'Unable to connect. Please check your internet connection.') {
		super(message)
		this.name = 'NetworkError'
	}
}

/**
 * Authentication errors (401)
 */
export class AuthenticationError extends BaseApiError {
	constructor(message: string = 'Your session has expired. Please log in again.') {
		super(message, 401)
		this.name = 'AuthenticationError'
	}
}

/**
 * Authorization errors (403)
 */
export class AuthorizationError extends BaseApiError {
	constructor(message: string = 'You do not have permission to perform this action.') {
		super(message, 403)
		this.name = 'AuthorizationError'
	}
}

/**
 * Validation errors (400)
 */
export class ValidationError extends BaseApiError {
	constructor(
		message: string,
		public fields?: Record<string, string[]>
	) {
		super(message, 400)
		this.name = 'ValidationError'
	}
}

/**
 * Not found errors (404)
 */
export class NotFoundError extends BaseApiError {
	constructor(message: string = 'The requested resource was not found.') {
		super(message, 404)
		this.name = 'NotFoundError'
	}
}

/**
 * Server errors (500+)
 */
export class ServerError extends BaseApiError {
	constructor(message: string = 'Something went wrong on the server. Please try again later.') {
		super(message, 500)
		this.name = 'ServerError'
	}
}

/**
 * Groups API Types
 */

export type Visibility = 'public' | 'hidden' | 'system'
export type CategoryPermission = 'anyone' | 'admin_only'
export type JoinMode = 'open' | 'approval' | 'invitation_only'

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
}

export interface UpdateGroupRequest {
	name?: string
	description?: string
	visibility?: Visibility
	joinMode?: JoinMode
	categoryId?: string
}

export interface GroupsFilters {
	categoryId?: string
	visibility?: Visibility
	joinMode?: JoinMode
	search?: string
	myGroups?: boolean
}

export interface GroupMembershipSummary {
	groupId: string
	groupName: string
	categoryName: string
	isOwner: boolean
	isAdmin: boolean
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
	} | null
}

export interface CreateCorporationRequest {
	corporationId: string
	name: string
	ticker: string
	assignedCharacterId?: string
	assignedCharacterName?: string
	includeInBackgroundRefresh?: boolean
}

export interface UpdateCorporationRequest {
	assignedCharacterId?: string
	assignedCharacterName?: string
	isActive?: boolean
	includeInBackgroundRefresh?: boolean
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
	createdAt: string
	updatedAt: string
	discordServer?: DiscordServerWithRoles
	roles?: Array<{
		id: string
		discordRoleId: string
		discordRole: DiscordRole
	}>
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
}

export interface UpdateDiscordServerAttachmentRequest {
	autoInvite?: boolean
	autoAssignRoles?: boolean
}

export interface AssignRoleRequest {
	discordRoleId: string
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

/**
 * Directors API Types
 */

export interface DirectorHealth {
	directorId: string
	characterId: string
	characterName: string
	isHealthy: boolean
	lastHealthCheck: string | null
	lastUsed: string | null
	failureCount: number
	lastFailureReason: string | null
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
	createdAt: string
	updatedAt: string
}

export interface AdminUserCharacter {
	characterId: string
	characterName: string
	characterOwnerHash: string
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

export interface AdminUserDetail {
	id: string
	mainCharacterId: string
	is_admin: boolean
	discordUserId: string | null
	discord: AdminDiscordStatus | null
	characters: AdminUserCharacter[]
	createdAt: string
	updatedAt: string
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

/**
 * Admin Blacklist Management API Types
 */

export type BlacklistTargetType = 'user' | 'character'

export interface BlacklistEntry {
	id: string
	targetType: BlacklistTargetType
	userId: string | null
	characterId: string | null
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
	characterId: string
	reason: string
	metadata?: Record<string, unknown>
}

export interface BlacklistFilters {
	targetType?: BlacklistTargetType
	isAutoBlacklist?: boolean
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
export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed'
export type DeliveryStatus = 'pending' | 'sent' | 'failed'

export interface BroadcastTarget {
	id: string
	name: string
	description: string | null
	type: TargetType
	groupId: string
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
	groupId: string
	fieldSchema: Array<{
		name: string
		label: string
		type: string
		required?: boolean
		placeholder?: string
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
	groupId: string
	createdBy: string
	createdByCharacterName: string
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

export interface CreateBroadcastTargetRequest {
	name: string
	description?: string
	type: TargetType
	groupId: string
	config: {
		guildId: string
		channelId: string
	}
}

export interface UpdateBroadcastTargetRequest {
	name?: string
	description?: string
	config?: {
		guildId?: string
		channelId?: string
	}
}

export interface CreateBroadcastTemplateRequest {
	name: string
	description?: string
	targetType: string
	groupId: string
	fieldSchema: Array<{
		name: string
		label: string
		type: string
		required?: boolean
		placeholder?: string
	}>
	messageTemplate: string
}

export interface UpdateBroadcastTemplateRequest {
	name?: string
	description?: string
	fieldSchema?: Array<{
		name: string
		label: string
		type: string
		required?: boolean
		placeholder?: string
	}>
	messageTemplate?: string
}

export interface CreateBroadcastRequest {
	templateId?: string
	targetId: string
	title: string
	content: Record<string, unknown>
	groupId: string
	scheduledFor?: string
}

export interface SendBroadcastResponse {
	broadcast: Broadcast
	delivery: {
		success: boolean
		messageId?: string
		error?: string
		retryAfter?: number
	}
}

/**
 * Doctrines API Types
 */

export interface Doctrine {
	id: string
	name: string
	category: string
	maintainer: string
	createdAt: string
	updatedAt: string
}

export interface Fitting {
	id: string
	shipTypeId: string
	shipName: string
	fitting: string
	category: string
	maintainer: string
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

export interface DoctrineWithFittings extends Doctrine {
	fittings: Fitting[]
}

export interface FittingWithItems extends Fitting {
	fittingItems: FittingItem[]
}

export interface CreateDoctrineRequest {
	name: string
	category: string
	maintainer: string
}

export interface UpdateDoctrineRequest {
	name?: string
	category?: string
	maintainer?: string
}

export interface CreateFittingRequest {
	fitting: string
	category: string
	maintainer: string
	srpEligible: boolean
	srpValue: string
	fittingItems: Array<Omit<FittingItem, 'id' | 'fittingId'>>
}

export interface UpdateFittingRequest {
	fitting?: string
	category?: string
	maintainer?: string
	srpEligible?: boolean
	srpValue?: string
	fittingItems?: Array<Omit<FittingItem, 'id' | 'fittingId'>>
}

export interface ListDoctrinesFilters {
	category?: string
	maintainer?: string
	search?: string
}

export interface ListFittingsFilters {
	shipTypeId?: string
	category?: string
	maintainer?: string
	srpEligible?: boolean
	search?: string
}

export class ApiClient {
	private baseUrl: string

	constructor(baseUrl: string = API_BASE_URL) {
		this.baseUrl = baseUrl
	}

	private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
		const url = `${this.baseUrl}${endpoint}`

		try {
			const response = await fetch(url, {
				...options,
				credentials: 'include', // Send cookies with requests
				headers: {
					'Content-Type': 'application/json',
					'X-Requested-With': 'XMLHttpRequest', // Required for CSRF protection
					...options?.headers,
				},
			})

			if (!response.ok) {
				// Try to parse error response body
				let errorMessage: string
				let errorFields: Record<string, string[]> | undefined

				try {
					const errorData = (await response.json()) as {
						error?: string
						message?: string
						fields?: Record<string, string[]>
					}
					// Backend may return { error: string } or { message: string } or { error: string, fields: {...} }
					errorMessage =
						errorData.error || errorData.message || `Request failed: ${response.statusText}`
					errorFields = errorData.fields
				} catch {
					// If response body is not JSON, use status text
					errorMessage = response.statusText || 'Request failed'
				}

				// Throw appropriate error type based on status code
				switch (response.status) {
					case 400:
						throw new ValidationError(errorMessage, errorFields)
					case 401:
						throw new AuthenticationError(errorMessage)
					case 403:
						throw new AuthorizationError(errorMessage)
					case 404:
						throw new NotFoundError(errorMessage)
					case 500:
					case 502:
					case 503:
					case 504:
						throw new ServerError(errorMessage)
					default:
						throw new BaseApiError(errorMessage, response.status)
				}
			}

			return response.json()
		} catch (error) {
			// Handle network errors (fetch failures, timeouts, etc.)
			if (error instanceof TypeError && error.message.includes('fetch')) {
				throw new NetworkError()
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
				throw error
			}

			// Unknown error
			throw new NetworkError('An unexpected error occurred. Please try again.')
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

	async getCharacterDetail(characterId: string): Promise<{
		characterId: string
		isOwner: boolean
		viewedAsAdmin: boolean
		viewedAsCeoOrDirector: boolean
		viewerRole: 'CEO' | 'Director' | null
		public: {
			info: any
			portrait: any
			corporationHistory: any[]
			skills: any
			attributes: any
		}
		private?: {
			location?: any
			wallet?: any
			assets?: any
			status?: any
			skillQueue?: any[]
		}
		owner?: {
			userId: string
			mainCharacterName: string
		}
		lastUpdated: string | null
	}> {
		return this.get(`/characters/${characterId}`)
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
		// Call through core API which proxies to eve-static-data service
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

	async removePermissionFromGroup(groupPermissionId: string): Promise<void> {
		return this.delete(`/groups/permissions/attachments/${groupPermissionId}`)
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
		return this.patch(`/my-corporations/${corporationId}/settings`, settings)
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

	async setUserAdmin(userId: string, isAdmin: boolean): Promise<{ success: boolean }> {
		return this.post(`/admin/users/${userId}/admin`, { isAdmin })
	}

	async revokeDiscordLink(userId: string): Promise<{ success: boolean }> {
		return this.post(`/admin/users/${userId}/discord/revoke`, {})
	}

	async clearUserSessions(userId: string): Promise<{ success: boolean }> {
		return this.post(`/admin/users/${userId}/clear-sessions`, {})
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
		}>
		totalInvited: number
		totalFailed: number
	}> {
		return this.post(`/admin/users/${userId}/discord/join-servers`)
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

	async getBlacklists(filters?: BlacklistFilters): Promise<PaginatedResponse<BlacklistEntry>> {
		const params = new URLSearchParams()
		if (filters?.targetType) params.set('targetType', filters.targetType)
		if (filters?.isAutoBlacklist !== undefined)
			params.set('isAutoBlacklist', String(filters.isAutoBlacklist))
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

	async removeBlacklistEntry(id: string): Promise<{ success: boolean; removedCount: number }> {
		return this.delete(`/admin/blacklist/${id}`)
	}

	// ===== Broadcasts API =====

	// Broadcast Targets
	async getBroadcastTargets(groupId?: string): Promise<BroadcastTarget[]> {
		const params = groupId ? `?groupId=${groupId}` : ''
		return this.get(`/broadcasts/targets${params}`)
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
	async getBroadcastTemplates(targetType?: string, groupId?: string): Promise<BroadcastTemplate[]> {
		const params = new URLSearchParams()
		if (targetType) params.set('targetType', targetType)
		if (groupId) params.set('groupId', groupId)
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
	async getBroadcasts(groupId?: string, status?: BroadcastStatus): Promise<BroadcastWithDetails[]> {
		const params = new URLSearchParams()
		if (groupId) params.set('groupId', groupId)
		if (status) params.set('status', status)
		const query = params.toString()
		return this.get(`/broadcasts${query ? `?${query}` : ''}`)
	}

	async getBroadcast(id: string): Promise<BroadcastWithDetails> {
		return this.get(`/broadcasts/${id}`)
	}

	async createBroadcast(data: CreateBroadcastRequest): Promise<Broadcast> {
		return this.post('/broadcasts', data)
	}

	async sendBroadcast(id: string): Promise<SendBroadcastResponse> {
		return this.post(`/broadcasts/${id}/send`)
	}

	async deleteBroadcast(id: string): Promise<{ success: boolean }> {
		return this.delete(`/broadcasts/${id}`)
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
	async getRecentLosses(daysBack: number = 30): Promise<
		Array<{
			killmailId: string
			killmailHash: string
			killmailTime: string
			shipTypeId: string
			shipTypeName?: string
			totalValue: string
			solarSystemId: string
			solarSystemName?: string
			victimCharacterId: string
			hasSRPRequest: boolean
			srpRequestId?: string
			srpRequestStatus?: string
		}>
	> {
		return this.get(`/srp/losses?daysBack=${daysBack}`)
	}

	/**
	 * Create a new SRP request
	 */
	async createSRPRequest(data: {
		characterId: string
		killmailId: string
		killmailHash: string
		requestedAmount?: string
	}): Promise<any> {
		return this.post('/srp/requests', data)
	}

	/**
	 * Get user's own SRP requests (paginated)
	 */
	async getMyRequests(params?: { limit?: number; offset?: number; status?: string }): Promise<{
		requests: any[]
		total: number
		limit: number
		offset: number
	}> {
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

	/**
	 * Mark request as fully paid
	 */
	async markPaid(
		id: string,
		data: {
			paidAmount: string
			paymentToken: string
		}
	): Promise<any> {
		return this.post(`/srp/requests/${id}/mark-paid`, data)
	}

	/**
	 * Mark request as partially paid
	 */
	async markPartiallyPaid(
		id: string,
		data: {
			paidAmount: string
			paymentToken: string
			notes?: string
		}
	): Promise<any> {
		return this.post(`/srp/requests/${id}/mark-partially-paid`, data)
	}

	/**
	 * Get active SRP configuration
	 */
	async getSRPConfig(): Promise<any> {
		return this.get('/srp/config')
	}

	/**
	 * Update SRP configuration (admin only)
	 */
	async updateSRPConfig(data: any): Promise<any> {
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

	// ===== Doctrines API Methods =====

	// Doctrines
	async getDoctrines(filters?: ListDoctrinesFilters): Promise<Doctrine[]> {
		const params = new URLSearchParams()
		if (filters?.category) params.set('category', filters.category)
		if (filters?.maintainer) params.set('maintainer', filters.maintainer)
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

	async addFittingToDoctrine(doctrineId: string, fittingId: string): Promise<void> {
		return this.post(`/doctrines/${doctrineId}/fittings`, { fittingId })
	}

	async removeFittingFromDoctrine(doctrineId: string, fittingId: string): Promise<void> {
		return this.delete(`/doctrines/${doctrineId}/fittings/${fittingId}`)
	}

	// Fittings
	async getFittings(filters?: ListFittingsFilters): Promise<Fitting[]> {
		const params = new URLSearchParams()
		if (filters?.shipTypeId) params.set('shipTypeId', filters.shipTypeId)
		if (filters?.category) params.set('category', filters.category)
		if (filters?.maintainer) params.set('maintainer', filters.maintainer)
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
}

export const apiClient = new ApiClient()

// Export the full API client as api
export const api = apiClient
