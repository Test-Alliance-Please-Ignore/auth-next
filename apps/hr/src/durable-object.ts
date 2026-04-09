import { DurableObject } from 'cloudflare:workers'

import { createDb } from './db'
import { ApplicationService } from './services/application.service'
import { BlacklistService } from './services/blacklist.service'
import { HrNotesService } from './services/hr-notes.service'
import { HrRoleService } from './services/hr-role.service'
import { MessageService } from './services/message.service'
import { RecommendationService } from './services/recommendation.service'
import { TemplateService } from './services/template.service'

import type {
	Application,
	ApplicationDetail,
	ApplicationFilters,
	ApplicationMessage,
	ApplicationStatus,
	BlacklistEntry,
	BlacklistFilters,
	BlacklistResults,
	CreateCharacterBlacklistParams,
	CreateUserBlacklistParams,
	Hr,
	HrNote,
	HrNotePriority,
	HrNoteType,
	HrRole,
	HrRoleType,
	NoteFilters,
	RecommendableApplication,
	Recommendation,
	RecommendationSentiment,
	RecommenderApplicationDetail,
} from '@repo/hr'
import type { Env } from './context'
import type { MessageTemplate } from './services/template.service'

/**
 * Hr Durable Object
 *
 * Singleton instance that manages all HR functionality for the application.
 * Uses Neon PostgreSQL for data storage and delegates to service classes.
 */
export class HrDO extends DurableObject<Env> implements Hr {
	private db: ReturnType<typeof createDb>
	private applicationService: ApplicationService
	private recommendationService: RecommendationService
	private hrNotesService: HrNotesService
	private hrRoleService: HrRoleService
	private blacklistService: BlacklistService
	private messageService: MessageService
	private templateService: TemplateService

	// Cache for corporation roles (in-memory)
	private roleCache = new Map<string, { data: HrRole[]; timestamp: number }>()
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
		this.applicationService = new ApplicationService({ db: this.db, env })
		this.recommendationService = new RecommendationService({ db: this.db, env })
		this.hrNotesService = new HrNotesService({ db: this.db, env })
		this.hrRoleService = new HrRoleService({ db: this.db, env })
		this.blacklistService = new BlacklistService({ db: this.db, env })
		this.messageService = new MessageService({ db: this.db, env })
		this.templateService = new TemplateService({ db: this.db, env })

		void this.state.blockConcurrencyWhile(async () => {
			void this.hrRoleService.ensureRolesExist()
		})
	}

	/**
	 * HTTP fetch handler (required by DurableObject interface)
	 * This DO is used purely for RPC, so HTTP access is not supported
	 */
	async fetch(_request: Request): Promise<Response> {
		return new Response('Hr Durable Object - RPC only', { status: 404 })
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
		// Check total open applications (max 2 across all corporations)
		const openCount = await this.applicationService.countOpenApplications(userId)
		if (openCount >= 2) {
			throw new Error(
				'You cannot have more than 2 open applications at a time. Please wait for your existing applications to be processed or withdraw one before submitting a new application.'
			)
		}

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
		const userHrAdminCorporations = isAdmin ? [] : await this.hrRoleService.getUserHrAdminCorporations(userId)

		return await this.applicationService.listApplications(
			filters,
			userId,
			isAdmin,
			userHrCorporations,
			userHrAdminCorporations
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
		const userHrAdminCorporations = isAdmin ? [] : await this.hrRoleService.getUserHrAdminCorporations(userId)

		return await this.applicationService.getApplication(
			applicationId,
			userId,
			isAdmin,
			userHrCorporations,
			true, // Include activity log for HR/admin
			userHrAdminCorporations
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
		const application = await this.applicationService.getApplicationById(applicationId)
		if (!application) {
			throw new Error('Application not found')
		}

		const roles = await this.hrRoleService.getUserRoles(userId, application.corporationId)
		const activeRoles = roles.filter((role) => role.isActive)

		const hasReviewerAccess = activeRoles.some(
			(role) => role.role === 'hr_reviewer' || role.role === 'hr_admin'
		)
		const hasAdminAccess = activeRoles.some((role) => role.role === 'hr_admin')

		const requiresAdminAccess = status === 'accepted' || status === 'rejected'
		const hasPermission = requiresAdminAccess ? hasAdminAccess : hasReviewerAccess

		if (!hasPermission) {
			throw new Error('You do not have permission to update this application')
		}

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
	 * List pending/under_review applications for corp members to recommend
	 */
	async listCorpApplicationsForRecommendation(
		corporationIds: string[],
		userId: string
	): Promise<RecommendableApplication[]> {
		return await this.applicationService.listCorpApplicationsForRecommendation(
			corporationIds,
			userId
		)
	}

	/**
	 * Get an application for a corp member to view and recommend
	 */
	async getApplicationForRecommender(
		applicationId: string,
		userId: string,
		userCorporationIds: string[]
	): Promise<RecommenderApplicationDetail> {
		return await this.applicationService.getApplicationForRecommender(
			applicationId,
			userId,
			userCorporationIds
		)
	}

	/**
	 * Add a recommendation for an application
	 */
	async addRecommendation(
		applicationId: string,
		userId: string,
		characterId: string,
		characterName: string,
		recommendationText: string,
		sentiment: RecommendationSentiment,
		isPublic: boolean
	): Promise<Recommendation> {
		return await this.recommendationService.addRecommendation(
			applicationId,
			userId,
			characterId,
			characterName,
			recommendationText,
			sentiment,
			isPublic
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
		isPublic: boolean,
		isAdmin: boolean
	): Promise<void> {
		await this.recommendationService.updateRecommendation(
			recommendationId,
			userId,
			characterId,
			recommendationText,
			sentiment,
			isPublic,
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

	// ==================== Message Methods ====================

	/**
	 * Send a message from HR reviewer to applicant or vice versa.
	 * Route has already validated isApplicant and HR permission — context is passed through
	 * to avoid redundant RPC calls and application fetches.
	 */
	async sendMessage(
		applicationId: string,
		senderId: string,
		recipientId: string | null,
		message: string,
		characterId: string,
		context: { isApplicant: boolean; isAdmin: boolean; corporationId: string }
	): Promise<ApplicationMessage> {
		// Only fetch HR corps when an applicant is targeting a specific HR recipient
		let recipientHrCorporations: string[] = []
		if (context.isApplicant && recipientId) {
			recipientHrCorporations = await this.hrRoleService.getUserHrCorporations(recipientId)
		}

		return await this.messageService.sendMessage(
			applicationId,
			senderId,
			recipientId,
			message,
			characterId,
			context.isApplicant,
			recipientHrCorporations
		)
	}

	/**
	 * List all messages for an application
	 */
	async listMessages(
		applicationId: string,
		userId: string,
		isAdmin: boolean
	): Promise<ApplicationMessage[]> {
		// Get user's HR corporations for authorization
		const userHrCorporations = await this.hrRoleService.getUserHrCorporations(userId)

		return await this.messageService.listMessages(
			applicationId,
			userId,
			isAdmin,
			userHrCorporations
		)
	}

	/**
	 * Get count of messages for an application (for UI badges)
	 */
	async getMessageCount(applicationId: string, userId: string, isAdmin: boolean): Promise<number> {
		// Get user's HR corporations for authorization
		const userHrCorporations = await this.hrRoleService.getUserHrCorporations(userId)

		return await this.messageService.getMessageCount(
			applicationId,
			userId,
			isAdmin,
			userHrCorporations
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
		role: HrRoleType,
		grantedBy: string,
		expiresAt?: Date
	): Promise<HrRole> {
		const hrRole = await this.hrRoleService.grantRole(
			corporationId,
			userId,
			role,
			grantedBy,
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
	 * Get corporation IDs where a user has any HR role
	 */
	async getUserHrCorporations(userId: string): Promise<string[]> {
		return await this.hrRoleService.getUserHrCorporations(userId)
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

	// ==================== Blacklist Methods ====================

	/**
	 * Check if a user is blacklisted
	 * Fast lookup - used on every auth request
	 */
	async isUserBlacklisted(userId: string): Promise<boolean> {
		return await this.blacklistService.isUserBlacklisted(userId)
	}

	/**
	 * Check if a character is blacklisted
	 * Fast lookup - used on login and character linking
	 */
	async isCharacterBlacklisted(characterId: string): Promise<boolean> {
		return await this.blacklistService.isCharacterBlacklisted(characterId)
	}

	/**
	 * Bulk check if multiple characters are blacklisted
	 * Optimized for checking many characters at once (e.g., displaying member lists)
	 */
	async checkCharactersBlacklisted(characterIds: string[]): Promise<Record<string, boolean>> {
		return await this.blacklistService.checkCharactersBlacklisted(characterIds)
	}

	/**
	 * Create a user blacklist entry
	 * Used for both manual blacklists and auto-blacklists triggered by characters
	 */
	async createUserBlacklist(params: CreateUserBlacklistParams): Promise<BlacklistEntry> {
		return await this.blacklistService.createUserBlacklist(params)
	}

	/**
	 * Create a character blacklist entry
	 * The Core worker will handle finding users with this character and auto-blacklisting them
	 */
	async createCharacterBlacklist(params: CreateCharacterBlacklistParams): Promise<BlacklistEntry> {
		return await this.blacklistService.createCharacterBlacklist(params)
	}

	/**
	 * Remove a blacklist entry
	 * IMPORTANT: Removing a character blacklist does NOT remove user blacklists it triggered
	 */
	async removeBlacklistEntry(id: string): Promise<void> {
		return await this.blacklistService.removeBlacklistEntry(id)
	}

	/**
	 * Get all blacklist entries for a user (including auto-blacklists)
	 */
	async getBlacklistsForUser(userId: string): Promise<BlacklistEntry[]> {
		return await this.blacklistService.getBlacklistsForUser(userId)
	}

	/**
	 * Get all blacklist entries for a character
	 */
	async getBlacklistsForCharacter(characterId: string): Promise<BlacklistEntry[]> {
		return await this.blacklistService.getBlacklistsForCharacter(characterId)
	}

	/**
	 * Get a specific blacklist entry by ID
	 */
	async getBlacklistEntry(id: string): Promise<BlacklistEntry | null> {
		return await this.blacklistService.getBlacklistEntry(id)
	}

	/**
	 * Get user blacklists triggered by a character blacklist
	 * Used to show "N users auto-blacklisted from this character"
	 */
	async getTriggeredBlacklists(characterBlacklistId: string): Promise<BlacklistEntry[]> {
		return await this.blacklistService.getTriggeredBlacklists(characterBlacklistId)
	}

	/**
	 * Find ALL blacklist entries triggered by a specific entry (for cascading removal)
	 */
	async findTriggeredEntries(blacklistId: string): Promise<BlacklistEntry[]> {
		return await this.blacklistService.findTriggeredEntries(blacklistId)
	}

	/**
	 * List all blacklist entries with filters and pagination
	 */
	async getAllBlacklists(filters: BlacklistFilters): Promise<BlacklistResults> {
		return await this.blacklistService.getAllBlacklists(filters)
	}

	// ==================== Message Template Methods ====================

	/**
	 * Create a new message template for a corporation
	 */
	async createTemplate(
		corporationId: string,
		templateName: string,
		messageTemplate: string,
		description?: string,
		status?: 'draft' | 'active' | 'inactive'
	): Promise<MessageTemplate> {
		return await this.templateService.createTemplate(
			corporationId,
			templateName,
			messageTemplate,
			description,
			status
		)
	}

	/**
	 * List templates for a corporation
	 */
	async listTemplates(
		corporationId: string,
		status?: 'draft' | 'active' | 'inactive' | 'deleted'
	): Promise<MessageTemplate[]> {
		return await this.templateService.listTemplates(corporationId, status)
	}

	/**
	 * Get a single template by ID
	 */
	async getTemplate(templateId: string): Promise<MessageTemplate | null> {
		return await this.templateService.getTemplate(templateId)
	}

	/**
	 * Update a template
	 */
	async updateTemplate(
		templateId: string,
		updates: Partial<{
			templateName: string
			messageTemplate: string
			description: string | null
			status: 'draft' | 'active' | 'inactive' | 'deleted'
		}>
	): Promise<MessageTemplate> {
		return await this.templateService.updateTemplate(templateId, updates)
	}

	/**
	 * Delete a template (soft delete)
	 */
	async deleteTemplate(templateId: string): Promise<void> {
		return await this.templateService.deleteTemplate(templateId)
	}
}
