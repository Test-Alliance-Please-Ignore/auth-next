/**
 * API client for making requests to the core worker
 */

const API_BASE_URL = import.meta.env.PROD ? '/api' : 'http://localhost:8787/api'

export interface ApiError {
	message: string
	status: number
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

export interface CharacterSearchResult {
	userId: string
	characterId: string
	characterName: string
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
	lastSync: string | null
	lastVerified: string | null
	isVerified: boolean
	healthyDirectorCount: number
	discordGuildId: string | null
	discordGuildName: string | null
	discordAutoInvite: boolean
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
}

export interface UpdateCorporationRequest {
	assignedCharacterId?: string
	assignedCharacterName?: string
	isActive?: boolean
	discordGuildId?: string | null
	discordGuildName?: string | null
	discordAutoInvite?: boolean
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
}

export interface AdminUserDetail {
	id: string
	mainCharacterId: string
	is_admin: boolean
	discordUserId: string | null
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

export interface PaginatedResponse<T> {
	data: T[]
	pagination: {
		page: number
		pageSize: number
		totalCount: number
		totalPages: number
	}
}

export class ApiClient {
	private baseUrl: string

	constructor(baseUrl: string = API_BASE_URL) {
		this.baseUrl = baseUrl
	}

	private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
		const url = `${this.baseUrl}${endpoint}`

		// Get session token from localStorage
		const sessionToken = typeof window !== 'undefined' ? localStorage.getItem('sessionToken') : null

		const response = await fetch(url, {
			...options,
			headers: {
				'Content-Type': 'application/json',
				...(sessionToken && { Authorization: `Bearer ${sessionToken}` }),
				...options?.headers,
			},
		})

		if (!response.ok) {
			const error: ApiError = {
				message: `API request failed: ${response.statusText}`,
				status: response.status,
			}
			throw error
		}

		return response.json()
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

	async startDiscordLinking(): Promise<{ url: string }> {
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

	async getJoinRequests(groupId: string): Promise<GroupJoinRequest[]> {
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

	// ===== Corporations API Methods =====

	async getCorporations(): Promise<ManagedCorporation[]> {
		return this.get('/corporations')
	}

	async getCorporation(corporationId: string): Promise<CorporationWithConfig> {
		return this.get(`/corporations/${corporationId}`)
	}

	async searchCorporations(query: string): Promise<ManagedCorporation[]> {
		return this.get(`/corporations/search?q=${encodeURIComponent(query)}`)
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

	async verifyCorporationAccess(
		corporationId: string
	): Promise<CorporationAccessVerification> {
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

	async addDirector(corporationId: string, data: AddDirectorRequest): Promise<{ success: boolean; characterId: string; characterName: string; priority: number }> {
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

	// ===== Admin User Management API Methods =====

	async getAdminUsers(filters?: AdminUsersFilters): Promise<PaginatedResponse<AdminUser>> {
		const params = new URLSearchParams()
		if (filters?.search) params.set('search', filters.search)
		if (filters?.page !== undefined) params.set('offset', String((filters.page - 1) * (filters.pageSize || 25)))
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

	async deleteUserCharacter(userId: string, characterId: string): Promise<{ success: boolean }> {
		return this.delete(`/admin/users/${userId}/characters/${characterId}`)
	}

	async getActivityLogs(filters?: AdminActivityLogFilters): Promise<PaginatedResponse<AdminActivityLog>> {
		const params = new URLSearchParams()
		if (filters?.userId) params.set('userId', filters.userId)
		if (filters?.characterId) params.set('characterId', filters.characterId)
		if (filters?.action) params.set('action', filters.action)
		if (filters?.startDate) params.set('startDate', filters.startDate)
		if (filters?.endDate) params.set('endDate', filters.endDate)
		if (filters?.page !== undefined) params.set('page', String(filters.page))
		if (filters?.pageSize !== undefined) params.set('pageSize', String(filters.pageSize))

		const query = params.toString()
		return this.get(`/admin/activity-logs${query ? `?${query}` : ''}`)
	}
}

export const apiClient = new ApiClient()

// Export the full API client as api
export const api = apiClient
