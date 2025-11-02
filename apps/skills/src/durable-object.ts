import { DurableObject } from 'cloudflare:workers'

import { and, eq, inArray, isNull, or, sql } from '@repo/db-utils'

import { createDb } from './db'
import {
	skillPlanCategories,
	skillPlanCategoryMappings,
	skillPlanSkills,
	skillPlans,
	skillRequirements,
	skills,
	skillGroups,
} from './db/schema'

import type { EveGroupId, EveSkillId } from '@repo/eve-types'
import type {
	AddSkillToPlanInput,
	BatchAddSkillsInput,
	BatchAddSkillsResult,
	CharacterPlanProgress,
	CharacterSkillReadiness,
	CreateSkillPlanInput,
	PaginatedResult,
	PaginationOptions,
	SkillInfo,
	SkillPlan,
	SkillPlanCategory,
	SkillPlanSummary,
	Skills,
} from '@repo/skills'
import type { Env } from './context'

export class SkillsDO extends DurableObject<Env, {}> implements Skills {
	private db: ReturnType<typeof createDb>

	// Cache for skill data (skills change rarely)
	private skillCache: Map<string, { skill: any; cachedAt: number }> = new Map()
	private allSkillsCache: { skills: any[]; cachedAt: number } | null = null
	private skillGroupCache: Map<string, { skills: any[]; cachedAt: number }> = new Map()
	private skillGroupsCache: { groups: any[]; cachedAt: number } | null = null

	// Cache TTL settings (in milliseconds)
	private readonly SKILL_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours for individual skills
	private readonly ALL_SKILLS_CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours for all skills
	private readonly SKILL_GROUP_CACHE_TTL = 12 * 60 * 60 * 1000 // 12 hours for skill groups

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)

		this.db = createDb(env.DATABASE_URL)
	}

	/**
	 * Alarm handler
	 * Called when a scheduled alarm triggers
	 */
	async alarm(): Promise<void> {
		console.log('SkillsDO alarm triggered at:', new Date().toISOString())
		// Schedule next alarm (optional)
		// await this.state.storage.setAlarm(Date.now() + 60000) // 1 minute
	}

	/**
	 * Fetch handler for HTTP requests to the Durable Object
	 */
	async fetch(request: Request): Promise<Response> {
		return new Response('Skills Durable Object', { status: 200 })
	}

	/**
	 * Check if a cached value is still valid
	 */
	private isCacheValid(cachedAt: number, ttl: number): boolean {
		return Date.now() - cachedAt < ttl
	}

	/**
	 * Clear all caches (useful for manual cache invalidation)
	 */
	async clearAllCaches(): Promise<void> {
		this.skillCache.clear()
		this.allSkillsCache = null
		this.skillGroupCache.clear()
		this.skillGroupsCache = null
		console.log('All skill caches cleared')
	}

	/**
	 * Get skill information by ID (with caching)
	 * @param skillId - The ID of the skill to get information for
	 * @returns The skill information or null if not found
	 */
	async getSkillInfo(skillId: EveSkillId): Promise<SkillInfo | null> {
		const cacheKey = String(skillId)

		// Check cache first
		const cached = this.skillCache.get(cacheKey)
		if (cached && this.isCacheValid(cached.cachedAt, this.SKILL_CACHE_TTL)) {
			return cached.skill
		}

		// Fetch from database
		const skill = await this.db.query.skills.findFirst({
			where: eq(skills.id, skillId),
		})

		if (!skill) {
			// Cache null result to avoid repeated DB queries
			this.skillCache.set(cacheKey, { skill: null, cachedAt: Date.now() })
			return null
		}

		const skillInfo = {
			id: skill.id as EveSkillId,
			name: skill.name,
			description: skill.description ?? '',
			rank: Number(skill.rank),
			primaryAttribute: skill.primaryAttribute ?? null,
			secondaryAttribute: skill.secondaryAttribute ?? null,
			published: skill.published,
			canNotBeTrained: skill.canNotBeTrained,
		}

		// Cache the result
		this.skillCache.set(cacheKey, { skill: skillInfo, cachedAt: Date.now() })

		return skillInfo
	}

	/**
	 * Get all available skills (with caching)
	 * @param includeUnpublished - Whether to include unpublished skills
	 * @returns All skills with group information
	 */
	async getAllSkills(includeUnpublished = false): Promise<any[]> {
		const cacheKey = includeUnpublished ? 'all-with-unpublished' : 'all-published'

		// Check cache first
		if (this.allSkillsCache &&
			this.isCacheValid(this.allSkillsCache.cachedAt, this.ALL_SKILLS_CACHE_TTL) &&
			(includeUnpublished || !this.allSkillsCache.skills.some(s => !s.published))) {
			return this.allSkillsCache.skills
		}

		// Fetch from database with group information
		const skillList = await this.db.query.skills.findMany({
			where: includeUnpublished ? undefined : eq(skills.published, true),
			with: {
				group: true, // Include the skill group
			},
		})

		const skillsWithGroups = skillList.map((skill) => ({
			id: skill.id as EveSkillId,
			skillId: skill.id, // For compatibility
			name: skill.name,
			description: skill.description ?? '',
			rank: Number(skill.rank),
			primaryAttribute: skill.primaryAttribute ?? null,
			secondaryAttribute: skill.secondaryAttribute ?? null,
			published: skill.published,
			canNotBeTrained: skill.canNotBeTrained,
			groupId: skill.groupId,
			groupName: skill.group?.name ?? 'Unknown',
		}))

		// Cache the result
		if (!includeUnpublished) {
			this.allSkillsCache = { skills: skillsWithGroups, cachedAt: Date.now() }
		}

		return skillsWithGroups
	}

	/**
	 * Search skills by name or partial match
	 * @param query - The search query
	 * @param limit - Maximum number of results to return
	 * @returns Skills matching the query
	 */
	async searchSkills(query: string, limit = 50): Promise<any[]> {
		if (!query || query.trim().length < 2) {
			return []
		}

		// For now, fetch all skills and filter in-memory (with caching benefit)
		// In future, could implement a proper search index
		const allSkills = await this.getAllSkills()

		const lowerQuery = query.toLowerCase()
		const filtered = allSkills
			.filter(skill =>
				skill.name.toLowerCase().includes(lowerQuery) ||
				skill.groupName.toLowerCase().includes(lowerQuery)
			)
			.slice(0, limit)

		return filtered
	}

	/**
	 * Get skills by group ID (with caching)
	 * @param groupId - The ID of the group to get skills for
	 * @returns The skills in the group
	 */
	async getSkillsByGroupId(groupId: EveGroupId): Promise<SkillInfo[]> {
		const cacheKey = String(groupId)

		// Check cache first
		const cached = this.skillGroupCache.get(cacheKey)
		if (cached && this.isCacheValid(cached.cachedAt, this.SKILL_GROUP_CACHE_TTL)) {
			return cached.skills
		}

		// Fetch from database
		const skillList = await this.db.query.skills.findMany({
			where: eq(skills.groupId, groupId),
		})

		const skillInfos = skillList.map((skill) => ({
			id: skill.id as EveSkillId,
			name: skill.name,
			description: skill.description ?? '',
			rank: Number(skill.rank),
			primaryAttribute: skill.primaryAttribute ?? null,
			secondaryAttribute: skill.secondaryAttribute ?? null,
			published: skill.published,
			canNotBeTrained: skill.canNotBeTrained,
		}))

		// Cache the result
		this.skillGroupCache.set(cacheKey, { skills: skillInfos, cachedAt: Date.now() })

		return skillInfos
	}

	/**
	 * Get metadata for multiple skills in a single batch (optimized for character skills)
	 * @param skillIds - Array of skill IDs to fetch metadata for
	 * @returns Array of skills with full metadata including group and category names
	 */
	async getSkillsMetadata(skillIds: (string | number)[]): Promise<any[]> {
		if (!skillIds || skillIds.length === 0) {
			return []
		}

		// Normalize IDs to strings
		const normalizedIds = skillIds.map(id => String(id))

		// Check cache for all skills first
		const cached: any[] = []
		const uncachedIds: string[] = []

		for (const id of normalizedIds) {
			const cacheKey = String(id)
			const cachedEntry = this.skillCache.get(cacheKey)

			if (cachedEntry && this.isCacheValid(cachedEntry.cachedAt, this.SKILL_CACHE_TTL) && cachedEntry.skill) {
				// We have basic skill info cached, but need to add group/category
				cached.push(cachedEntry.skill)
			} else {
				uncachedIds.push(id)
			}
		}

		// Fetch uncached skills from database with group and category info
		let fetchedSkills: any[] = []
		if (uncachedIds.length > 0) {
			const skillList = await this.db.query.skills.findMany({
				where: inArray(skills.id, uncachedIds),
				with: {
					group: {
						with: {
							category: true,
						},
					},
				},
			})

			fetchedSkills = skillList.map(skill => {
				const skillInfo = {
					id: skill.id as EveSkillId,
					name: skill.name,
					description: skill.description ?? '',
					rank: Number(skill.rank),
					primaryAttribute: skill.primaryAttribute ?? null,
					secondaryAttribute: skill.secondaryAttribute ?? null,
					published: skill.published,
					canNotBeTrained: skill.canNotBeTrained,
					groupId: skill.groupId,
					groupName: skill.group?.name ?? 'Unknown',
					categoryId: skill.group?.categoryId,
					categoryName: skill.group?.category?.name ?? 'Unknown',
				}

				// Cache the basic skill info
				this.skillCache.set(String(skill.id), {
					skill: {
						id: skillInfo.id,
						name: skillInfo.name,
						description: skillInfo.description,
						rank: skillInfo.rank,
						primaryAttribute: skillInfo.primaryAttribute,
						secondaryAttribute: skillInfo.secondaryAttribute,
						published: skillInfo.published,
						canNotBeTrained: skillInfo.canNotBeTrained,
					},
					cachedAt: Date.now()
				})

				return skillInfo
			})
		}

		// For cached skills, we need to fetch group/category info
		let enrichedCached: any[] = []
		if (cached.length > 0) {
			// Get unique group IDs from cached skills
			const groupIds = [...new Set(cached.map(s => s.groupId).filter(Boolean))]

			if (groupIds.length > 0) {
				// Fetch group and category info
				const groups = await this.db.query.skillGroups.findMany({
					where: inArray(skillGroups.id, groupIds),
					with: {
						category: true,
					},
				})

				// Create a map for quick lookup
				const groupMap = new Map(groups.map(g => [
					g.id,
					{
						groupName: g.name,
						categoryId: g.categoryId,
						categoryName: g.category?.name ?? 'Unknown'
					}
				]))

				// Enrich cached skills with group/category info
				enrichedCached = cached.map(skill => {
					const groupInfo = skill.groupId ? groupMap.get(skill.groupId) : null
					return {
						...skill,
						groupName: groupInfo?.groupName ?? 'Unknown',
						categoryId: groupInfo?.categoryId,
						categoryName: groupInfo?.categoryName ?? 'Unknown',
					}
				})
			} else {
				enrichedCached = cached.map(skill => ({
					...skill,
					groupName: 'Unknown',
					categoryName: 'Unknown',
				}))
			}
		}

		// Combine and return all skills in the order requested
		const allSkills = [...enrichedCached, ...fetchedSkills]
		const skillMap = new Map(allSkills.map(s => [String(s.id), s]))

		// Return in the same order as requested, with null for missing skills
		return normalizedIds.map(id => skillMap.get(id) || null).filter(Boolean)
	}

	/**
	 * Get required skills for a skill
	 * @param skillId - The ID of the skill to get required skills for
	 * @returns The required skills
	 */
	async getRequiredSkillsForSkill(skillId: EveSkillId): Promise<SkillInfo[]> {
		// First, get all skill requirements for this skill
		const requirements = await this.db.query.skillRequirements.findMany({
			where: eq(skillRequirements.skillId, skillId),
		})

		if (requirements.length === 0) {
			return []
		}

		// Extract the required skill IDs
		const requiredSkillIds = requirements.map((req) => req.requiredSkillId)

		// Query the skills table for all required skills
		const requiredSkills = await this.db.query.skills.findMany({
			where: inArray(skills.id, requiredSkillIds),
		})

		// Map to SkillInfo format
		return requiredSkills.map((skill) => ({
			id: skill.id as EveSkillId,
			name: skill.name,
			description: skill.description ?? '',
			rank: Number(skill.rank),
			primaryAttribute: skill.primaryAttribute ?? null,
			secondaryAttribute: skill.secondaryAttribute ?? null,
			published: skill.published,
			canNotBeTrained: skill.canNotBeTrained,
		}))
	}

	// ===== Skill Plan Methods =====

	/**
	 * Create a new skill plan
	 * @param input - The skill plan creation input
	 * @returns The created skill plan
	 */
	async createSkillPlan(input: CreateSkillPlanInput): Promise<SkillPlan> {
		// Create the skill plan
		const [plan] = await this.db
			.insert(skillPlans)
			.values({
				name: input.name,
				description: input.description,
				isPublished: input.isPublished ?? false,
				maintainerId: input.maintainerId ?? null,
				ownerCharacterId: input.ownerCharacterId ?? null,
			})
			.returning()

		// Add categories if provided
		if (input.categoryIds && input.categoryIds.length > 0) {
			await this.db.insert(skillPlanCategoryMappings).values(
				input.categoryIds.map((categoryId) => ({
					planId: plan.id,
					categoryId,
				}))
			)
		}

		// Fetch categories for the response
		const categories = await this.db.query.skillPlanCategoryMappings.findMany({
			where: eq(skillPlanCategoryMappings.planId, plan.id),
			with: {
				category: true,
			},
		})

		return {
			id: plan.id,
			name: plan.name,
			description: plan.description,
			isPublished: plan.isPublished,
			maintainerId: plan.maintainerId,
			ownerCharacterId: plan.ownerCharacterId,
			categories: categories
				.filter((c) => c.category !== null)
				.map((c) => ({
					id: c.category!.id,
					name: c.category!.name,
					description: c.category!.description,
					icon: c.category!.icon,
					displayOrder: c.category!.displayOrder,
				})),
			skills: [],
			createdAt: plan.createdAt,
			updatedAt: plan.updatedAt,
		}
	}

	/**
	 * Get a skill plan by ID
	 * @param planId - The ID of the skill plan
	 * @returns The skill plan or null if not found
	 */
	async getSkillPlan(planId: string): Promise<SkillPlan | null> {
		const plan = await this.db.query.skillPlans.findFirst({
			where: eq(skillPlans.id, planId),
		})

		if (!plan) {
			return null
		}

		// Get skills for this plan
		const planSkills = await this.db.query.skillPlanSkills.findMany({
			where: eq(skillPlanSkills.planId, planId),
			orderBy: (sps, { asc }) => [asc(sps.displayOrder)],
		})

		// Get skill details for each skill in the plan (with group information)
		const skillIds = planSkills.map((ps) => ps.skillId)
		const skillDetails = skillIds.length > 0
			? await this.db.query.skills.findMany({
					where: inArray(skills.id, skillIds),
					with: {
						group: true, // Include the skill group
					},
				})
			: []

		// Map skills with their details including group information
		const skillsWithDetails = planSkills.map((ps) => {
			// Ensure we're comparing strings to strings for skill ID matching
			const skill = skillDetails.find((s) => String(s.id) === String(ps.skillId))

			// Log if skill not found for debugging
			if (!skill) {
				console.warn(`Skill not found in database: ${ps.skillId}`)
			}

			return {
				skillId: ps.skillId as EveSkillId,
				skillName: skill?.name ?? `Unknown Skill #${ps.skillId}`,
				skillGroup: skill?.group?.name ?? 'Unknown Group',
				requiredLevel: ps.requiredLevel,
				recommendedLevel: ps.recommendedLevel,
				displayOrder: ps.displayOrder,
				notes: ps.notes,
			}
		})

		// Get categories
		const categories = await this.db.query.skillPlanCategoryMappings.findMany({
			where: eq(skillPlanCategoryMappings.planId, planId),
			with: {
				category: true,
			},
		})

		return {
			id: plan.id,
			name: plan.name,
			description: plan.description,
			isPublished: plan.isPublished,
			maintainerId: plan.maintainerId,
			ownerCharacterId: plan.ownerCharacterId,
			categories: categories
				.filter((c) => c.category !== null)
				.map((c) => ({
					id: c.category!.id,
					name: c.category!.name,
					description: c.category!.description,
					icon: c.category!.icon,
					displayOrder: c.category!.displayOrder,
				})),
			skills: skillsWithDetails,
			createdAt: plan.createdAt,
			updatedAt: plan.updatedAt,
		}
	}

	/**
	 * Update an existing skill plan
	 * @param planId - The ID of the skill plan to update
	 * @param input - The update input (partial)
	 * @returns The updated skill plan
	 */
	async updateSkillPlan(planId: string, input: Partial<CreateSkillPlanInput>): Promise<SkillPlan> {
		// Update the skill plan
		const [updatedPlan] = await this.db
			.update(skillPlans)
			.set({
				...(input.name !== undefined && { name: input.name }),
				...(input.description !== undefined && { description: input.description }),
				...(input.isPublished !== undefined && { isPublished: input.isPublished }),
				...(input.maintainerId !== undefined && { maintainerId: input.maintainerId }),
				...(input.ownerCharacterId !== undefined && { ownerCharacterId: input.ownerCharacterId }),
				updatedAt: new Date(),
			})
			.where(eq(skillPlans.id, planId))
			.returning()

		if (!updatedPlan) {
			throw new Error('Skill plan not found')
		}

		// Update categories if provided
		if (input.categoryIds !== undefined) {
			// Delete existing mappings
			await this.db.delete(skillPlanCategoryMappings).where(eq(skillPlanCategoryMappings.planId, planId))

			// Add new mappings
			if (input.categoryIds.length > 0) {
				await this.db.insert(skillPlanCategoryMappings).values(
					input.categoryIds.map((categoryId) => ({
						planId,
						categoryId,
					}))
				)
			}
		}

		// Return the updated plan
		const result = await this.getSkillPlan(planId)
		if (!result) {
			throw new Error('Failed to retrieve updated plan')
		}
		return result
	}

	/**
	 * Delete a skill plan
	 * @param planId - The ID of the skill plan to delete
	 * @returns Success status
	 */
	async deleteSkillPlan(planId: string): Promise<boolean> {
		const result = await this.db.delete(skillPlans).where(eq(skillPlans.id, planId)).returning()
		return result.length > 0
	}

	/**
	 * List published skill plans
	 * @param categoryId - Optional category ID to filter by
	 * @param options - Pagination options (limit and offset)
	 * @returns Paginated list of published skill plans
	 */
	async listPublishedPlans(
		categoryId?: string,
		options?: PaginationOptions
	): Promise<PaginatedResult<SkillPlanSummary>> {
		const limit = options?.limit ?? 50
		const offset = options?.offset ?? 0

		// Get total count first
		const countQuery = sql`
			SELECT COUNT(DISTINCT sp.id)::int as total
			FROM ${skillPlans} sp
			WHERE sp.is_published = true
			${categoryId ? sql`AND EXISTS (
				SELECT 1 FROM ${skillPlanCategoryMappings} cm2
				WHERE cm2.plan_id = sp.id AND cm2.category_id = ${categoryId}
			)` : sql``}
		`
		const countResult = await this.db.execute(countQuery)
		const total = (countResult.rows[0] as any)?.total || 0

		// Build the SQL query with aggregation to avoid N+1 queries
		// This query performs LEFT JOINs and aggregates data in a single database roundtrip
		const query = sql`
			SELECT
				sp.id,
				sp.name,
				sp.description,
				sp.is_published as "isPublished",
				sp.maintainer_id as "maintainerId",
				sp.owner_character_id as "ownerCharacterId",
				sp.created_at as "createdAt",
				sp.updated_at as "updatedAt",
				COUNT(DISTINCT sps.id)::int as "totalSkills",
				COALESCE(
					json_agg(
						DISTINCT jsonb_build_object(
							'id', c.id,
							'name', c.name,
							'description', c.description,
							'icon', c.icon,
							'displayOrder', c.display_order
						)
					) FILTER (WHERE c.id IS NOT NULL),
					'[]'
				) as categories
			FROM ${skillPlans} sp
			LEFT JOIN ${skillPlanSkills} sps ON sp.id = sps.plan_id
			LEFT JOIN ${skillPlanCategoryMappings} cm ON sp.id = cm.plan_id
			LEFT JOIN ${skillPlanCategories} c ON cm.category_id = c.id
			WHERE sp.is_published = true
			${categoryId ? sql`AND EXISTS (
				SELECT 1 FROM ${skillPlanCategoryMappings} cm2
				WHERE cm2.plan_id = sp.id AND cm2.category_id = ${categoryId}
			)` : sql``}
			GROUP BY sp.id
			ORDER BY sp.updated_at DESC
			LIMIT ${limit}
			OFFSET ${offset}
		`

		const results = await this.db.execute(query)

		const items = results.rows.map((row: any) => ({
			id: row.id,
			name: row.name,
			description: row.description,
			isPublished: row.isPublished,
			maintainerId: row.maintainerId,
			ownerCharacterId: row.ownerCharacterId,
			categories: row.categories || [],
			totalSkills: row.totalSkills || 0,
			createdAt: new Date(row.createdAt),
			updatedAt: new Date(row.updatedAt),
		}))

		return {
			items,
			total,
			limit,
			offset,
		}
	}

	/**
	 * List skill plans by owner
	 * @param ownerCharacterId - The character ID of the owner
	 * @param options - Pagination options (limit and offset)
	 * @returns Paginated list of skill plans owned by the character
	 */
	async listPlansByOwner(
		ownerCharacterId: string,
		options?: PaginationOptions
	): Promise<PaginatedResult<SkillPlanSummary>> {
		const limit = options?.limit ?? 50
		const offset = options?.offset ?? 0

		// Get total count first
		const countQuery = sql`
			SELECT COUNT(DISTINCT sp.id)::int as total
			FROM ${skillPlans} sp
			WHERE sp.owner_character_id = ${ownerCharacterId}
		`
		const countResult = await this.db.execute(countQuery)
		const total = (countResult.rows[0] as any)?.total || 0

		// Build the SQL query with aggregation to avoid N+1 queries
		const query = sql`
			SELECT
				sp.id,
				sp.name,
				sp.description,
				sp.is_published as "isPublished",
				sp.maintainer_id as "maintainerId",
				sp.owner_character_id as "ownerCharacterId",
				sp.created_at as "createdAt",
				sp.updated_at as "updatedAt",
				COUNT(DISTINCT sps.id)::int as "totalSkills",
				COALESCE(
					json_agg(
						DISTINCT jsonb_build_object(
							'id', c.id,
							'name', c.name,
							'description', c.description,
							'icon', c.icon,
							'displayOrder', c.display_order
						)
					) FILTER (WHERE c.id IS NOT NULL),
					'[]'
				) as categories
			FROM ${skillPlans} sp
			LEFT JOIN ${skillPlanSkills} sps ON sp.id = sps.plan_id
			LEFT JOIN ${skillPlanCategoryMappings} cm ON sp.id = cm.plan_id
			LEFT JOIN ${skillPlanCategories} c ON cm.category_id = c.id
			WHERE sp.owner_character_id = ${ownerCharacterId}
			GROUP BY sp.id
			ORDER BY sp.updated_at DESC
			LIMIT ${limit}
			OFFSET ${offset}
		`

		const results = await this.db.execute(query)

		const items = results.rows.map((row: any) => ({
			id: row.id,
			name: row.name,
			description: row.description,
			isPublished: row.isPublished,
			maintainerId: row.maintainerId,
			ownerCharacterId: row.ownerCharacterId,
			categories: row.categories || [],
			totalSkills: row.totalSkills || 0,
			createdAt: new Date(row.createdAt),
			updatedAt: new Date(row.updatedAt),
		}))

		return {
			items,
			total,
			limit,
			offset,
		}
	}

	/**
	 * List skill plans by maintainer
	 * @param maintainerId - The ID of the maintainer (user ID or group:groupId)
	 * @param options - Pagination options (limit and offset)
	 * @returns Paginated list of skill plans maintained by the user or group
	 */
	async listPlansByMaintainer(
		maintainerId: string,
		options?: PaginationOptions
	): Promise<PaginatedResult<SkillPlanSummary>> {
		const limit = options?.limit ?? 50
		const offset = options?.offset ?? 0

		// Get total count first
		const countQuery = sql`
			SELECT COUNT(DISTINCT sp.id)::int as total
			FROM ${skillPlans} sp
			WHERE sp.maintainer_id = ${maintainerId}
		`
		const countResult = await this.db.execute(countQuery)
		const total = (countResult.rows[0] as any)?.total || 0

		// Build the SQL query with aggregation to avoid N+1 queries
		const query = sql`
			SELECT
				sp.id,
				sp.name,
				sp.description,
				sp.is_published as "isPublished",
				sp.maintainer_id as "maintainerId",
				sp.owner_character_id as "ownerCharacterId",
				sp.created_at as "createdAt",
				sp.updated_at as "updatedAt",
				COUNT(DISTINCT sps.id)::int as "totalSkills",
				COALESCE(
					json_agg(
						DISTINCT jsonb_build_object(
							'id', c.id,
							'name', c.name,
							'description', c.description,
							'icon', c.icon,
							'displayOrder', c.display_order
						)
					) FILTER (WHERE c.id IS NOT NULL),
					'[]'
				) as categories
			FROM ${skillPlans} sp
			LEFT JOIN ${skillPlanSkills} sps ON sp.id = sps.plan_id
			LEFT JOIN ${skillPlanCategoryMappings} cm ON sp.id = cm.plan_id
			LEFT JOIN ${skillPlanCategories} c ON cm.category_id = c.id
			WHERE sp.maintainer_id = ${maintainerId}
			GROUP BY sp.id
			ORDER BY sp.updated_at DESC
			LIMIT ${limit}
			OFFSET ${offset}
		`

		const results = await this.db.execute(query)

		const items = results.rows.map((row: any) => ({
			id: row.id,
			name: row.name,
			description: row.description,
			isPublished: row.isPublished,
			maintainerId: row.maintainerId,
			ownerCharacterId: row.ownerCharacterId,
			categories: row.categories || [],
			totalSkills: row.totalSkills || 0,
			createdAt: new Date(row.createdAt),
			updatedAt: new Date(row.updatedAt),
		}))

		return {
			items,
			total,
			limit,
			offset,
		}
	}

	/**
	 * Add a skill to a plan
	 * @param input - The skill addition input
	 * @returns Success status
	 */
	async addSkillToPlan(input: AddSkillToPlanInput): Promise<boolean> {
		// Validate that recommended >= required
		if (input.recommendedLevel < input.requiredLevel) {
			throw new Error('Recommended level must be greater than or equal to required level')
		}

		// Validate levels are between 0-5
		if (
			input.requiredLevel < 0 ||
			input.requiredLevel > 5 ||
			input.recommendedLevel < 0 ||
			input.recommendedLevel > 5
		) {
			throw new Error('Skill levels must be between 0 and 5')
		}

		// Convert skill ID to string for consistency
		const skillIdStr = String(input.skillId)

		// Check if skill already exists in plan
		const existing = await this.db.query.skillPlanSkills.findFirst({
			where: and(
				eq(skillPlanSkills.planId, input.planId),
				eq(skillPlanSkills.skillId, skillIdStr)
			),
		})

		if (existing) {
			throw new Error('Skill already exists in this plan')
		}

		// Verify the skill exists in our database
		const skillExists = await this.db.query.skills.findFirst({
			where: eq(skills.id, skillIdStr),
		})
		if (!skillExists) {
			console.warn(`Adding unknown skill to plan: ${skillIdStr}`)
		}

		// Add the skill to the plan
		const result = await this.db
			.insert(skillPlanSkills)
			.values({
				planId: input.planId,
				skillId: skillIdStr,
				requiredLevel: input.requiredLevel,
				recommendedLevel: input.recommendedLevel,
				displayOrder: input.displayOrder ?? 0,
				notes: input.notes ?? null,
			})
			.returning()

		// Update plan's updatedAt timestamp
		await this.db
			.update(skillPlans)
			.set({ updatedAt: new Date() })
			.where(eq(skillPlans.id, input.planId))

		return result.length > 0
	}

	/**
	 * Add multiple skills to a plan in batch
	 * @param input - The batch skills addition input
	 * @returns Result with successful/failed counts and errors
	 */
	async batchAddSkillsToPlan(input: BatchAddSkillsInput): Promise<BatchAddSkillsResult> {
		const result: BatchAddSkillsResult = {
			successful: 0,
			failed: 0,
			errors: []
		}

		// Process skills in a transaction for consistency
		await this.db.transaction(async (tx) => {
			for (const skill of input.skills) {
				try {
					// Validate that recommended >= required
					if (skill.recommendedLevel < skill.requiredLevel) {
						result.failed++
						result.errors.push({
							skillId: skill.skillId,
							error: 'Recommended level must be greater than or equal to required level'
						})
						continue
					}

					// Validate levels are between 0-5
					if (
						skill.requiredLevel < 0 ||
						skill.requiredLevel > 5 ||
						skill.recommendedLevel < 0 ||
						skill.recommendedLevel > 5
					) {
						result.failed++
						result.errors.push({
							skillId: skill.skillId,
							error: 'Skill levels must be between 0 and 5'
						})
						continue
					}

					// Convert skill ID to string for consistency
					const skillIdStr = String(skill.skillId)

					// Check if skill already exists in plan
					const existing = await tx.query.skillPlanSkills.findFirst({
						where: and(
							eq(skillPlanSkills.planId, input.planId),
							eq(skillPlanSkills.skillId, skillIdStr)
						),
					})

					if (existing) {
						// Skip duplicates silently (as per user preference)
						continue
					}

					// Add the skill to the plan
					await tx
						.insert(skillPlanSkills)
						.values({
							planId: input.planId,
							skillId: skillIdStr,
							requiredLevel: skill.requiredLevel,
							recommendedLevel: skill.recommendedLevel,
							displayOrder: skill.displayOrder ?? 0,
							notes: skill.notes ?? null,
						})

					result.successful++
				} catch (error) {
					result.failed++
					result.errors.push({
						skillId: skill.skillId,
						error: error instanceof Error ? error.message : 'Unknown error'
					})
				}
			}

			// Update the plan's updatedAt timestamp
			if (result.successful > 0) {
				await tx
					.update(skillPlans)
					.set({ updatedAt: new Date() })
					.where(eq(skillPlans.id, input.planId))
			}
		})

		return result
	}

	/**
	 * Remove a skill from a plan
	 * @param planId - The plan ID
	 * @param skillId - The skill ID to remove
	 * @returns Success status
	 */
	async removeSkillFromPlan(planId: string, skillId: EveSkillId): Promise<boolean> {
		const result = await this.db
			.delete(skillPlanSkills)
			.where(
				and(
					eq(skillPlanSkills.planId, planId),
					eq(skillPlanSkills.skillId, skillId)
				)
			)
			.returning()

		if (result.length > 0) {
			// Update plan's updatedAt timestamp
			await this.db
				.update(skillPlans)
				.set({ updatedAt: new Date() })
				.where(eq(skillPlans.id, planId))
		}

		return result.length > 0
	}

	/**
	 * Update a skill in a plan
	 * @param planId - The plan ID
	 * @param skillId - The skill ID to update
	 * @param input - The update input
	 * @returns Success status
	 */
	async updateSkillInPlan(
		planId: string,
		skillId: EveSkillId,
		input: Partial<Omit<AddSkillToPlanInput, 'planId' | 'skillId'>>
	): Promise<boolean> {
		// Get current skill to validate changes
		const currentSkill = await this.db.query.skillPlanSkills.findFirst({
			where: and(
				eq(skillPlanSkills.planId, planId),
				eq(skillPlanSkills.skillId, skillId)
			),
		})

		if (!currentSkill) {
			throw new Error('Skill not found in plan')
		}

		const newRequiredLevel = input.requiredLevel ?? currentSkill.requiredLevel
		const newRecommendedLevel = input.recommendedLevel ?? currentSkill.recommendedLevel

		// Validate that recommended >= required
		if (newRecommendedLevel < newRequiredLevel) {
			throw new Error('Recommended level must be greater than or equal to required level')
		}

		// Validate levels are between 0-5
		if (
			newRequiredLevel < 0 ||
			newRequiredLevel > 5 ||
			newRecommendedLevel < 0 ||
			newRecommendedLevel > 5
		) {
			throw new Error('Skill levels must be between 0 and 5')
		}

		// Update the skill
		const result = await this.db
			.update(skillPlanSkills)
			.set({
				...(input.requiredLevel !== undefined && { requiredLevel: input.requiredLevel }),
				...(input.recommendedLevel !== undefined && { recommendedLevel: input.recommendedLevel }),
				...(input.displayOrder !== undefined && { displayOrder: input.displayOrder }),
				...(input.notes !== undefined && { notes: input.notes }),
			})
			.where(
				and(
					eq(skillPlanSkills.planId, planId),
					eq(skillPlanSkills.skillId, skillId)
				)
			)
			.returning()

		if (result.length > 0) {
			// Update plan's updatedAt timestamp
			await this.db
				.update(skillPlans)
				.set({ updatedAt: new Date() })
				.where(eq(skillPlans.id, planId))
		}

		return result.length > 0
	}

	/**
	 * Check character's readiness for a skill plan
	 * @param planId - The skill plan ID
	 * @param characterId - The character ID
	 * @param characterSkills - JSON array of character's current skills
	 * @returns Character's progress and readiness for the plan
	 */
	async checkCharacterPlanReadiness(
		planId: string,
		characterId: string,
		characterSkills: Array<{
			skill_id: string
			active_skill_level: number
			trained_skill_level: number
			skillpoints_in_skill: number
		}>
	): Promise<CharacterPlanProgress> {
		// Get the plan
		const plan = await this.getSkillPlan(planId)
		if (!plan) {
			throw new Error('Skill plan not found')
		}

		// Create a map of character skills for quick lookup
		const characterSkillMap = new Map(
			characterSkills.map((cs) => [cs.skill_id, cs.trained_skill_level])
		)

		// Check readiness for each skill in the plan
		const skillReadiness: CharacterSkillReadiness[] = plan.skills.map((planSkill) => {
			const currentLevel = characterSkillMap.get(planSkill.skillId) ?? 0
			const levelsNeededForMinimum = Math.max(0, planSkill.requiredLevel - currentLevel)
			const levelsNeededForRecommended = Math.max(0, planSkill.recommendedLevel - currentLevel)

			let status: 'fully_trained' | 'meets_minimum' | 'insufficient'
			if (currentLevel >= planSkill.recommendedLevel) {
				status = 'fully_trained'
			} else if (currentLevel >= planSkill.requiredLevel) {
				status = 'meets_minimum'
			} else {
				status = 'insufficient'
			}

			return {
				skillId: planSkill.skillId,
				skillName: planSkill.skillName,
				requiredLevel: planSkill.requiredLevel,
				recommendedLevel: planSkill.recommendedLevel,
				currentLevel,
				status,
				levelsNeededForMinimum,
				levelsNeededForRecommended,
			}
		})

		// Calculate overall progress
		const totalSkills = skillReadiness.length
		const skillsMeetingMinimum = skillReadiness.filter(
			(sr) => sr.status === 'meets_minimum' || sr.status === 'fully_trained'
		).length
		const skillsFullyTrained = skillReadiness.filter((sr) => sr.status === 'fully_trained').length

		const minimumProgressPercent = totalSkills > 0 ? (skillsMeetingMinimum / totalSkills) * 100 : 0
		const recommendedProgressPercent = totalSkills > 0 ? (skillsFullyTrained / totalSkills) * 100 : 0

		return {
			planId: plan.id,
			planName: plan.name,
			totalSkills,
			skillsMeetingMinimum,
			skillsFullyTrained,
			minimumProgressPercent: Math.round(minimumProgressPercent * 100) / 100,
			recommendedProgressPercent: Math.round(recommendedProgressPercent * 100) / 100,
			skillReadiness,
		}
	}

	/**
	 * Calculate character's progress across multiple plans
	 * @param characterId - The character ID
	 * @param characterSkills - JSON array of character's current skills
	 * @param planIds - Optional array of plan IDs to check (defaults to all published)
	 * @returns Progress for each plan
	 */
	async calculateMultiplePlanProgress(
		characterId: string,
		characterSkills: Array<{
			skill_id: string
			active_skill_level: number
			trained_skill_level: number
			skillpoints_in_skill: number
		}>,
		planIds?: string[]
	): Promise<CharacterPlanProgress[]> {
		// Get the plans to check
		let plansToCheck: string[]
		if (planIds && planIds.length > 0) {
			plansToCheck = planIds
		} else {
			// Default to all published plans
			const publishedPlans = await this.listPublishedPlans()
			plansToCheck = publishedPlans.items.map((p) => p.id)
		}

		// Calculate progress for each plan
		const progressResults = await Promise.all(
			plansToCheck.map((planId) =>
				this.checkCharacterPlanReadiness(planId, characterId, characterSkills)
			)
		)

		return progressResults
	}

	// ===== Skill Plan Category Methods =====

	/**
	 * Create a new skill plan category
	 * @param input - The category creation input
	 * @returns The created category
	 */
	async createSkillPlanCategory(input: {
		name: string
		description?: string
		icon?: string
		displayOrder?: number
	}): Promise<SkillPlanCategory> {
		const [category] = await this.db
			.insert(skillPlanCategories)
			.values({
				name: input.name,
				description: input.description ?? null,
				icon: input.icon ?? null,
				displayOrder: input.displayOrder ?? 0,
			})
			.returning()

		return {
			id: category.id,
			name: category.name,
			description: category.description,
			icon: category.icon,
			displayOrder: category.displayOrder,
		}
	}

	/**
	 * List all skill plan categories
	 * @returns List of all categories
	 */
	async listSkillPlanCategories(): Promise<SkillPlanCategory[]> {
		const categories = await this.db.query.skillPlanCategories.findMany({
			orderBy: (spc, { asc }) => [asc(spc.displayOrder), asc(spc.name)],
		})

		return categories.map((category) => ({
			id: category.id,
			name: category.name,
			description: category.description,
			icon: category.icon,
			displayOrder: category.displayOrder,
		}))
	}

	/**
	 * Update a skill plan category
	 * @param categoryId - The category ID
	 * @param input - The update input
	 * @returns The updated category
	 */
	async updateSkillPlanCategory(
		categoryId: string,
		input: {
			name?: string
			description?: string
			icon?: string
			displayOrder?: number
		}
	): Promise<SkillPlanCategory> {
		const [updatedCategory] = await this.db
			.update(skillPlanCategories)
			.set({
				...(input.name !== undefined && { name: input.name }),
				...(input.description !== undefined && { description: input.description }),
				...(input.icon !== undefined && { icon: input.icon }),
				...(input.displayOrder !== undefined && { displayOrder: input.displayOrder }),
			})
			.where(eq(skillPlanCategories.id, categoryId))
			.returning()

		if (!updatedCategory) {
			throw new Error('Category not found')
		}

		return {
			id: updatedCategory.id,
			name: updatedCategory.name,
			description: updatedCategory.description,
			icon: updatedCategory.icon,
			displayOrder: updatedCategory.displayOrder,
		}
	}

	/**
	 * Delete a skill plan category
	 * @param categoryId - The category ID
	 * @returns Success status
	 */
	async deleteSkillPlanCategory(categoryId: string): Promise<boolean> {
		// First delete all mappings for this category
		await this.db
			.delete(skillPlanCategoryMappings)
			.where(eq(skillPlanCategoryMappings.categoryId, categoryId))

		// Then delete the category
		const result = await this.db
			.delete(skillPlanCategories)
			.where(eq(skillPlanCategories.id, categoryId))
			.returning()

		return result.length > 0
	}

	/**
	 * Add a category to a skill plan
	 * @param planId - The plan ID
	 * @param categoryId - The category ID
	 * @returns Success status
	 */
	async addCategoryToPlan(planId: string, categoryId: string): Promise<boolean> {
		// Check if the mapping already exists
		const existing = await this.db.query.skillPlanCategoryMappings.findFirst({
			where: and(
				eq(skillPlanCategoryMappings.planId, planId),
				eq(skillPlanCategoryMappings.categoryId, categoryId)
			),
		})

		if (existing) {
			return true // Already exists, consider it a success
		}

		// Add the mapping
		const result = await this.db
			.insert(skillPlanCategoryMappings)
			.values({
				planId,
				categoryId,
			})
			.returning()

		// Update plan's updatedAt timestamp
		if (result.length > 0) {
			await this.db
				.update(skillPlans)
				.set({ updatedAt: new Date() })
				.where(eq(skillPlans.id, planId))
		}

		return result.length > 0
	}

	/**
	 * Remove a category from a skill plan
	 * @param planId - The plan ID
	 * @param categoryId - The category ID
	 * @returns Success status
	 */
	async removeCategoryFromPlan(planId: string, categoryId: string): Promise<boolean> {
		const result = await this.db
			.delete(skillPlanCategoryMappings)
			.where(
				and(
					eq(skillPlanCategoryMappings.planId, planId),
					eq(skillPlanCategoryMappings.categoryId, categoryId)
				)
			)
			.returning()

		if (result.length > 0) {
			// Update plan's updatedAt timestamp
			await this.db
				.update(skillPlans)
				.set({ updatedAt: new Date() })
				.where(eq(skillPlans.id, planId))
		}

		return result.length > 0
	}
}
