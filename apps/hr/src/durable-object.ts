import { DurableObject } from 'cloudflare:workers'

import { createDb } from './db'
import { ApplicationService } from './services/application.service'
import { HrNotesService } from './services/hr-notes.service'
import { HrRoleService } from './services/hr-role.service'
import { RecommendationService } from './services/recommendation.service'

import type {
	Application,
	ApplicationDetail,
	ApplicationFilters,
	ApplicationStatus,
	Hr,
	HrNote,
	HrNotePriority,
	HrNoteType,
	HrRole,
	HrRoleType,
	NoteFilters,
	Recommendation,
	RecommendationSentiment,
} from '@repo/hr'

/**
 * Environment bindings for Hr Durable Object
 */
interface Env {
	DATABASE_URL: string
	EVE_CORPORATION_DATA: DurableObjectNamespace
}

/**
 * Hr Durable Object
 *
 * Singleton instance that manages all HR functionality for the application.
 * Uses Neon PostgreSQL for data storage and delegates to service classes.
 */
export class HrDO extends DurableObject implements Hr {
	private db: ReturnType<typeof createDb>
	private applicationService: ApplicationService
	private recommendationService: RecommendationService
	private hrNotesService: HrNotesService
	private hrRoleService: HrRoleService

	// Cache for corporation roles (in-memory)
	private roleCache = new Map<string, { data: HrRole[], timestamp: number }>()
	private readonly CACHE_TTL = 5 * 60 * 1000 // 5 minutes

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)

		// Initialize database client
		this.db = createDb(env.DATABASE_URL)

		// Initialize services
		this.applicationService = new ApplicationService(this.db)
		this.recommendationService = new RecommendationService(this.db)
		this.hrNotesService = new HrNotesService(this.db)
		this.hrRoleService = new HrRoleService(this.db)
	}

	// ==================== Application Methods ====================

	/**
	 * Submit a new application to a corporation
	 */
	async submitApplication(
		userId: string,
		characterId: string,
		corporationId: string,
		applicationText: string,
		characterName: string
	): Promise<Application> {
		// Check for existing pending application
		const hasPending = await this.applicationService.hasPendingApplication(userId, corporationId)
		if (hasPending) {
			throw new Error('You already have a pending or under review application for this corporation')
		}

		return await this.applicationService.submitApplication(
			userId,
			characterId,
			characterName,
			corporationId,
			applicationText
		)
	}

	/**
	 * List applications with optional filters
	 */
	async listApplications(
		filters: ApplicationFilters,
		userId: string,
		isAdmin: boolean
	): Promise<Application[]> {
		// Get user's HR corporations for authorization
		const userHrCorporations = await this.hrRoleService.getUserHrCorporations(userId)

		return await this.applicationService.listApplications(
			filters,
			userId,
			isAdmin,
			userHrCorporations
		)
	}

	/**
	 * Get a single application with recommendations
	 */
	async getApplication(
		applicationId: string,
		userId: string,
		isAdmin: boolean
	): Promise<ApplicationDetail> {
		// Get user's HR corporations for authorization
		const userHrCorporations = await this.hrRoleService.getUserHrCorporations(userId)

		return await this.applicationService.getApplication(
			applicationId,
			userId,
			isAdmin,
			userHrCorporations,
			true // Include activity log for HR/admin
		)
	}

	/**
	 * Update application status
	 */
	async updateApplicationStatus(
		applicationId: string,
		status: ApplicationStatus,
		userId: string,
		characterId: string,
		reviewNotes?: string
	): Promise<void> {
		await this.applicationService.updateApplicationStatus(
			applicationId,
			status,
			userId,
			characterId,
			reviewNotes
		)
	}

	/**
	 * Withdraw an application
	 */
	async withdrawApplication(
		applicationId: string,
		userId: string,
		characterId: string
	): Promise<void> {
		await this.applicationService.withdrawApplication(applicationId, userId, characterId)
	}

	/**
	 * Delete an application permanently (admin only)
	 */
	async deleteApplication(applicationId: string): Promise<void> {
		await this.applicationService.deleteApplication(applicationId)
	}

	// ==================== Recommendation Methods ====================

	/**
	 * Add a recommendation for an application
	 */
	async addRecommendation(
		applicationId: string,
		userId: string,
		characterId: string,
		characterName: string,
		recommendationText: string,
		sentiment: RecommendationSentiment
	): Promise<Recommendation> {
		return await this.recommendationService.addRecommendation(
			applicationId,
			userId,
			characterId,
			characterName,
			recommendationText,
			sentiment
		)
	}

	/**
	 * Update a recommendation
	 */
	async updateRecommendation(
		recommendationId: string,
		userId: string,
		characterId: string,
		recommendationText: string,
		sentiment: RecommendationSentiment,
		isAdmin: boolean
	): Promise<void> {
		await this.recommendationService.updateRecommendation(
			recommendationId,
			userId,
			characterId,
			recommendationText,
			sentiment,
			isAdmin
		)
	}

	/**
	 * Delete a recommendation
	 */
	async deleteRecommendation(
		recommendationId: string,
		userId: string,
		characterId: string,
		isAdmin: boolean
	): Promise<void> {
		await this.recommendationService.deleteRecommendation(
			recommendationId,
			userId,
			characterId,
			isAdmin
		)
	}

	// ==================== HR Notes Methods (Admin Only) ====================

	/**
	 * Create an HR note about a user (admin only)
	 */
	async createNote(
		subjectUserId: string,
		subjectCharacterId: string | null,
		authorId: string,
		authorCharacterId: string | null,
		authorCharacterName: string | null,
		noteText: string,
		noteType: HrNoteType,
		priority: HrNotePriority,
		metadata?: Record<string, unknown>
	): Promise<HrNote> {
		return await this.hrNotesService.createNote(
			subjectUserId,
			subjectCharacterId,
			authorId,
			authorCharacterId,
			authorCharacterName,
			noteText,
			noteType,
			priority,
			metadata
		)
	}

	/**
	 * List HR notes with optional filters (admin only)
	 */
	async listNotes(filters: NoteFilters): Promise<HrNote[]> {
		return await this.hrNotesService.listNotes(filters)
	}

	/**
	 * Get all HR notes for a specific user (admin only)
	 */
	async getUserNotes(subjectUserId: string): Promise<HrNote[]> {
		return await this.hrNotesService.getUserNotes(subjectUserId)
	}

	/**
	 * Update an HR note (admin only)
	 */
	async updateNote(noteId: string, updates: Partial<HrNote>): Promise<void> {
		await this.hrNotesService.updateNote(noteId, updates)
	}

	/**
	 * Delete an HR note (admin only)
	 */
	async deleteNote(noteId: string): Promise<void> {
		await this.hrNotesService.deleteNote(noteId)
	}

	// ==================== HR Roles Methods ====================

	/**
	 * Grant an HR role to a user for a corporation
	 * Validates that the character is a member of the corporation
	 */
	async grantRole(
		corporationId: string,
		userId: string,
		characterId: string,
		characterName: string,
		role: HrRoleType,
		grantedBy: string,
		expiresAt?: Date
	): Promise<HrRole> {
		const hrRole = await this.hrRoleService.grantRole(
			corporationId,
			userId,
			characterId,
			characterName,
			role,
			grantedBy,
			this.env.EVE_CORPORATION_DATA,
			expiresAt
		)

		// Invalidate cache for this corporation
		this.invalidateRoleCache(corporationId)

		return hrRole
	}

	/**
	 * Revoke an HR role
	 */
	async revokeRole(roleId: string): Promise<void> {
		// Get the role first to know which corporation cache to invalidate
		const role = await this.hrRoleService.getRole(roleId)

		await this.hrRoleService.revokeRole(roleId)

		// Invalidate cache if role was found
		if (role) {
			this.invalidateRoleCache(role.corporationId)
		}
	}

	/**
	 * Get a single HR role by ID
	 */
	async getRole(roleId: string): Promise<HrRole | null> {
		return await this.hrRoleService.getRole(roleId)
	}

	/**
	 * Get HR roles for a user
	 */
	async getUserRoles(userId: string, corporationId?: string): Promise<HrRole[]> {
		return await this.hrRoleService.getUserRoles(userId, corporationId)
	}

	/**
	 * Get all HR roles for a corporation (cached)
	 */
	async getCorporationRoles(corporationId: string, activeOnly = true): Promise<HrRole[]> {
		const cacheKey = `${corporationId}:${activeOnly}`
		const cached = this.roleCache.get(cacheKey)

		// Return cached data if still valid
		if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
			return cached.data
		}

		// Fetch fresh data from database
		const roles = await this.hrRoleService.getCorporationRoles(corporationId, activeOnly)

		// Store in cache
		this.roleCache.set(cacheKey, { data: roles, timestamp: Date.now() })

		return roles
	}

	/**
	 * Invalidate role cache for a corporation
	 */
	private invalidateRoleCache(corporationId: string): void {
		// Remove both active and inactive cache entries
		this.roleCache.delete(`${corporationId}:true`)
		this.roleCache.delete(`${corporationId}:false`)
	}

	/**
	 * Check if a user has permission for a corporation
	 */
	async checkPermission(
		userId: string,
		corporationId: string,
		requiredRole: HrRoleType
	): Promise<boolean> {
		return await this.hrRoleService.checkPermission(userId, corporationId, requiredRole)
	}
}
