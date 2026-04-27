/**
 * Corporations Feature API Client
 *
 * Provides typed API methods and interfaces for corporation management
 * functionality, including member lists and access control.
 */

import { apiClient } from '../../lib/api'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Represents a corporation member with comprehensive information
 */
export interface CorporationMember {
	characterId: string
	characterName: string
	corporationId: string
	corporationName: string
	role: 'CEO' | 'Director' | 'Member'
	hasAuthAccount: boolean
	hasValidToken?: boolean | null
	authUserId?: string
	mainCharacterName?: string
	status?: 'active' | 'emeritus'
	joinDate: string
	lastEsiUpdate: string
	lastLogin?: string
	allianceId?: string
	allianceName?: string
	locationSystem?: string
	locationRegion?: string
	activityStatus: 'active' | 'inactive' | 'unknown'
	hrRole?: import('../hr/api').HrRoleGrant
	isBlacklisted: boolean
}

export type CorporationMembersAuthFilter =
	| 'all'
	| 'linked'
	| 'unlinked'
	| 'linked_valid'
	| 'linked_invalid'
	| 'linked_unknown'
export type CorporationMembersActivityFilter = 'all' | 'active' | 'inactive' | 'unknown'
export type CorporationMembersRoleFilter = 'all' | 'CEO' | 'Director' | 'Member'
export type CorporationMembersSortField = 'name' | 'role' | 'auth' | 'activity' | 'lastLogin' | 'joinDate'
export type CorporationMembersSortOrder = 'asc' | 'desc'

export interface CorporationMembersQuery {
	page?: number
	limit?: number
	search?: string
	authFilter?: CorporationMembersAuthFilter
	activityFilter?: CorporationMembersActivityFilter
	roleFilter?: CorporationMembersRoleFilter
	sortField?: CorporationMembersSortField
	sortOrder?: CorporationMembersSortOrder
}

export interface CorporationMembersResponse {
	items: CorporationMember[]
	pagination: {
		page: number
		limit: number
		totalItems: number
		totalPages: number
		hasNextPage: boolean
		hasPreviousPage: boolean
	}
	summary: {
		total: number
		linked: number
		active: number
		inactive: number
		directors: number
	}
}

/**
 * Corporation with user's leadership role and member statistics
 */
export interface MyCorporation {
	corporationId: string
	name: string
	ticker: string
	userRole: 'CEO' | 'Director' | 'Both' | 'admin'
	memberCount: number
	linkedMemberCount: number
	unlinkedMemberCount: number
	allianceId?: string
	allianceName?: string
}

/**
 * Corporation access check result
 */
export interface CorporationAccessResult {
	hasAccess: boolean
	corporations: Array<{
		corporationId: string
		name: string
		ticker: string
		userRole: 'CEO' | 'Director' | 'admin' | 'hr_admin' | 'hr_reviewer' | 'hr_viewer'
		characterId: string | null
		characterName: string | null
	}>
}

/**
 * Quick access check result (for UI navigation)
 */
export interface QuickAccessResult {
	hasAccess: boolean
}

// ============================================================================
// API Client Methods
// ============================================================================

/**
 * Corporations API methods
 */
export const myCorporationsApi = {
	/**
	 * Quick check if user has any CEO/director access (for UI navigation)
	 */
	async hasAccess(): Promise<QuickAccessResult> {
		return apiClient.get('/users/has-corporation-access')
	},

	/**
	 * Full check if the current user has CEO/director access to any managed corporations
	 * Returns the complete list of accessible corporations
	 */
	async checkAccess(): Promise<CorporationAccessResult> {
		return apiClient.get('/users/corporation-access')
	},

	/**
	 * Get list of managed corporations where current user is CEO/director
	 */
	async getMyCorporations(): Promise<MyCorporation[]> {
		return apiClient.get('/users/my-corporations')
	},

	/**
	 * Get all members of a specific corporation
	 * Requires CEO/director access
	 */
	async getCorporationMembers(
		corporationId: string,
		query: CorporationMembersQuery = {}
	): Promise<CorporationMembersResponse> {
		const params = new URLSearchParams()
		if (query.page) params.set('page', String(query.page))
		if (query.limit) params.set('limit', String(query.limit))
		if (query.search) params.set('search', query.search)
		if (query.authFilter && query.authFilter !== 'all') params.set('authFilter', query.authFilter)
		if (query.activityFilter && query.activityFilter !== 'all') {
			params.set('activityFilter', query.activityFilter)
		}
		if (query.roleFilter && query.roleFilter !== 'all') params.set('roleFilter', query.roleFilter)
		if (query.sortField) params.set('sortField', query.sortField)
		if (query.sortOrder) params.set('sortOrder', query.sortOrder)
		const queryString = params.toString()
		return apiClient.get(
			`/corporations/${corporationId}/members${queryString ? `?${queryString}` : ''}`
		)
	},

	/**
	 * Force refresh of corporation member data from ESI-backed core data
	 * Requires CEO/director/admin access
	 */
	async refreshCorporationMembers(corporationId: string): Promise<{ success: boolean }> {
		return apiClient.post(`/corporations/${corporationId}/members/refresh`)
	},

	/**
	 * Update a member's status (active/emeritus)
	 * Requires CEO or admin access
	 */
	async updateMemberStatus(
		corporationId: string,
		characterId: string,
		status: 'active' | 'emeritus'
	): Promise<{ success: boolean; characterId: string; characterName: string; status: string }> {
		return apiClient.patch(`/corporations/${corporationId}/members/${characterId}/status`, {
			status,
		})
	},
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sort members by role and name
 */
export function sortMembers(members: CorporationMember[]): CorporationMember[] {
	const roleOrder = { CEO: 0, Director: 1, Member: 2 }

	return [...members].sort((a, b) => {
		const roleDiff = roleOrder[a.role] - roleOrder[b.role]
		if (roleDiff !== 0) return roleDiff
		return a.characterName.localeCompare(b.characterName)
	})
}

/**
 * Filter members by auth status
 */
export function filterMembersByAuthStatus(
	members: CorporationMember[],
	status: 'linked' | 'unlinked' | 'all'
): CorporationMember[] {
	switch (status) {
		case 'linked':
			return members.filter((m) => m.hasAuthAccount)
		case 'unlinked':
			return members.filter((m) => !m.hasAuthAccount)
		case 'all':
		default:
			return members
	}
}

/**
 * Filter members by activity status
 */
export function filterMembersByActivity(
	members: CorporationMember[],
	status: 'active' | 'inactive' | 'unknown' | 'all'
): CorporationMember[] {
	if (status === 'all') return members
	return members.filter((m) => m.activityStatus === status)
}

/**
 * Get member statistics for a corporation
 */
export function getMemberStatistics(members: CorporationMember[]) {
	const total = members.length
	const linked = members.filter((m) => m.hasAuthAccount).length
	const unlinked = total - linked
	const active = members.filter((m) => m.activityStatus === 'active').length
	const inactive = members.filter((m) => m.activityStatus === 'inactive').length
	const ceos = members.filter((m) => m.role === 'CEO').length
	const directors = members.filter((m) => m.role === 'Director').length

	return {
		total,
		linked,
		unlinked,
		active,
		inactive,
		ceos,
		directors,
		linkPercentage: total > 0 ? Math.round((linked / total) * 100) : 0,
		activePercentage: total > 0 ? Math.round((active / total) * 100) : 0,
	}
}
