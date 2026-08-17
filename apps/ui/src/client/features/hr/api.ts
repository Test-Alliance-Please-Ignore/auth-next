import { apiClient } from '../../lib/api'

/**
 * HR Role Types
 */
export type HrRoleType = 'hr_admin' | 'hr_reviewer' | 'hr_viewer'

/**
 * HR Role Grant (database record)
 */
export interface HrRoleGrant {
	id: string
	corporationId: string
	userId: string
	characterId: string
	characterName: string
	role: HrRoleType
	grantedBy: string
	grantedAt: string
	expiresAt: string | null
	isActive: boolean
	createdAt: string
	updatedAt: string
}

/**
 * Request to grant an HR role
 */
export interface GrantHrRoleRequest {
	corporationId: string
	userId: string
	characterId: string
	characterName: string
	role: HrRoleType
}

/**
 * Request to revoke an HR role
 */
export interface RevokeHrRoleRequest {
	roleId: string
	corporationId: string // For cache invalidation in UI
}

/**
 * HR permission check request
 * Note: userId is derived from authenticated session, not passed as parameter
 */
export interface CheckHrPermissionRequest {
	corporationId: string
	requiredRole?: HrRoleType
}

/**
 * HR permission check result
 */
export interface CheckHrPermissionResult {
	hasPermission: boolean
	currentRole: HrRoleType | null
}

/**
 * Corporation where the current user has HR access
 */
export interface HrAccessibleCorporation {
	corporationId: string
	name: string
	ticker: string
	currentRole: HrRoleType
	isMemberCorporation: boolean
	isAltCorp: boolean
	isSpecialPurpose: boolean
}

export interface HrUserSearchCharacter {
	characterId: string
	characterName: string
	corporationId: string | null
	corporationName: string | null
	allianceId: string | null
	allianceName: string | null
	is_primary: boolean
	hasValidToken: boolean
	isBlacklisted: boolean
}

export interface HrUserSearchSummary {
	id: string
	mainCharacterId: string
	mainCharacterName: string | null
	characterCount: number
	is_admin: boolean
	discordUserId: string | null
	discordUsername: string | null
	matchedCharacterId: string | null
	matchedCharacterName: string | null
	isBlacklisted: boolean
	matchedBy: string | null
	createdAt: string
	updatedAt: string
}

export interface HrUserSearchResult {
	users: Array<{
		summary: HrUserSearchSummary
		characters: HrUserSearchCharacter[]
	}>
	total: number
	limit: number
	offset: number
}

/**
 * HR Role capabilities for UI display
 */
export const HR_ROLE_DESCRIPTIONS: Record<HrRoleType, string> = {
	hr_admin: 'Full HR system access. Can manage applications, recommendations, notes, and HR roles.',
	hr_reviewer:
		'Can review and process applications. Can add recommendations and notes. Cannot manage HR roles.',
	hr_viewer: 'Read-only access. Can view applications and recommendations. Cannot make changes.',
}

/**
 * HR Role display names
 */
export const HR_ROLE_NAMES: Record<HrRoleType, string> = {
	hr_admin: 'HR Admin',
	hr_reviewer: 'HR Reviewer',
	hr_viewer: 'HR Viewer',
}

/**
 * HR API methods
 */
export const hrApi = {
	/** Search surface-level users within the authenticated user's HR scope. */
	async searchUsers(query: { search?: string; limit?: number; offset?: number } = {}) {
		const params = new URLSearchParams()
		if (query.search) params.set('search', query.search)
		if (query.limit !== undefined) params.set('limit', String(query.limit))
		if (query.offset !== undefined) params.set('offset', String(query.offset))
		return apiClient.get<HrUserSearchResult>(
			`/hr/users/search${params.toString() ? `?${params.toString()}` : ''}`
		)
	},

	/**
	 * Grant an HR role to a user
	 */
	async grantHrRole(request: GrantHrRoleRequest): Promise<HrRoleGrant> {
		const { corporationId, characterName, ...rest } = request
		const params = new URLSearchParams({ characterName })
		return apiClient.post(`/hr/${corporationId}/roles?${params.toString()}`, rest)
	},

	/**
	 * Revoke an HR role from a user
	 */
	async revokeHrRole(request: RevokeHrRoleRequest): Promise<{ success: boolean }> {
		const { corporationId, roleId } = request
		return apiClient.delete(`/hr/${corporationId}/roles/${roleId}`)
	},

	/**
	 * List all HR roles for a corporation
	 */
	async listHrRoles(corporationId: string): Promise<HrRoleGrant[]> {
		return apiClient.get(`/hr/${corporationId}/roles`)
	},

	/**
	 * Check if the current authenticated user has HR permission
	 * Note: userId is derived from session on the backend
	 */
	async checkHrPermission(request: CheckHrPermissionRequest): Promise<CheckHrPermissionResult> {
		const { corporationId, requiredRole } = request
		const params = new URLSearchParams({ corporationId })
		if (requiredRole) {
			params.append('requiredRole', requiredRole)
		}
		return apiClient.get(`/hr/roles/check?${params.toString()}`)
	},

	/**
	 * List corporations where the current user has at least HR Viewer access
	 */
	async listAccessibleCorporations(): Promise<HrAccessibleCorporation[]> {
		return apiClient.get('/hr/corporations')
	},
}
