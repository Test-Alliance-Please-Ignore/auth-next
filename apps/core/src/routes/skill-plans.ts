import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'

import { createDb } from '../db'
import {
	canCheckCharacterProgress,
	canCreateCategory,
	canCreateSkillPlan,
	canDeletePlan,
	canManageCategories,
	canModifyPlan,
	canViewPlan,
} from '../lib/skill-plan-auth'
import { getCachedGroup, getCachedUserMemberships } from '../lib/groups-cache'
import { requireAuth } from '../middleware/session'

import type { EveCharacterData } from '@repo/eve-character-data'
import type {
	AddSkillToPlanInput,
	CreateSkillPlanInput,
	SkillPlan,
	SkillPlanCategory,
	Skills,
} from '@repo/skills'
import type { App } from '../context'

/**
 * Helper function to resolve maintainer name from maintainerId
 */
async function resolveMaintainerName(
	maintainerId: string,
	currentUserId: string,
	env: { GROUPS: DurableObjectNamespace },
	db: ReturnType<typeof createDb>,
	isAdmin: boolean
): Promise<string> {
	if (maintainerId.startsWith('group:')) {
		// Get group name
		const groupId = maintainerId.replace('group:', '')
		try {
			const group = await getCachedGroup(env, groupId, currentUserId, isAdmin)
			return group?.name || groupId
		} catch (error) {
			console.error('Failed to fetch group name:', error)
			return groupId
		}
	} else {
		// Get user's character name
		if (maintainerId === currentUserId) {
			return 'You'
		}
		try {
			const character = await db.query.userCharacters.findFirst({
				where: (chars, { eq, and }) =>
					and(eq(chars.userId, maintainerId), eq(chars.is_primary, true)),
			})
			return character?.characterName || maintainerId
		} catch (error) {
			console.error('Failed to fetch user character name:', error)
			return maintainerId
		}
	}
}

const skillPlansRoutes = new Hono<App>()
	// All routes require authentication
	.use('*', requireAuth())

	// ===== Category Management =====

	/**
	 * GET /api/skill-plans/categories
	 * List all skill plan categories
	 * Public endpoint for authenticated users
	 */
	.get('/categories', async (c) => {
		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')
		const categories = await skillsStub.listSkillPlanCategories()
		return c.json(categories)
	})

	/**
	 * POST /api/skill-plans/categories
	 * Create a new skill plan category
	 * Requires: urn:skill-plans:categories:create permission
	 */
	.post('/categories', async (c) => {
		const user = c.get('user')!

		// Check permission
		const allowed = await canCreateCategory(c.env, user.id, user.is_admin)
		if (!allowed) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		// Parse and validate input
		const data = await c.req.json<{
			name: string
			description?: string
			icon?: string
			displayOrder?: number
		}>()

		if (!data.name || data.name.trim().length === 0) {
			return c.json({ error: 'Category name is required' }, 400)
		}

		// Create category
		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')
		try {
			const category = await skillsStub.createSkillPlanCategory({
				name: data.name.trim(),
				description: data.description?.trim(),
				icon: data.icon,
				displayOrder: data.displayOrder ?? 0,
			})
			return c.json(category, 201)
		} catch (error) {
			console.error('Failed to create category:', error)
			return c.json({ error: 'Failed to create category' }, 500)
		}
	})

	/**
	 * PATCH /api/skill-plans/categories/:categoryId
	 * Update a skill plan category
	 * Requires: urn:skill-plans:categories:manage permission
	 */
	.patch('/categories/:categoryId', async (c) => {
		const user = c.get('user')!
		const categoryId = c.req.param('categoryId')

		// Check permission
		const allowed = await canManageCategories(c.env, user.id, user.is_admin)
		if (!allowed) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		// Parse and validate input
		const data = await c.req.json<{
			name?: string
			description?: string
			icon?: string
			displayOrder?: number
		}>()

		// Update category
		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')
		try {
			const category = await skillsStub.updateSkillPlanCategory(categoryId, {
				...(data.name !== undefined && { name: data.name.trim() }),
				...(data.description !== undefined && { description: data.description?.trim() }),
				...(data.icon !== undefined && { icon: data.icon }),
				...(data.displayOrder !== undefined && { displayOrder: data.displayOrder }),
			})
			return c.json(category)
		} catch (error) {
			console.error('Failed to update category:', error)
			return c.json({ error: 'Failed to update category' }, 500)
		}
	})

	/**
	 * DELETE /api/skill-plans/categories/:categoryId
	 * Delete a skill plan category
	 * Requires: urn:skill-plans:categories:manage permission
	 */
	.delete('/categories/:categoryId', async (c) => {
		const user = c.get('user')!
		const categoryId = c.req.param('categoryId')

		// Check permission
		const allowed = await canManageCategories(c.env, user.id, user.is_admin)
		if (!allowed) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		// Delete category
		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')
		try {
			const success = await skillsStub.deleteSkillPlanCategory(categoryId)
			if (success) {
				return c.json({ message: 'Category deleted successfully' })
			} else {
				return c.json({ error: 'Category not found' }, 404)
			}
		} catch (error) {
			console.error('Failed to delete category:', error)
			return c.json({ error: 'Failed to delete category' }, 500)
		}
	})

	// ===== Skill Plan CRUD =====

	/**
	 * GET /api/skill-plans
	 * List skill plans
	 * - Shows all published plans to authenticated users
	 * - Shows user's maintained plans with ?myPlans=true
	 * - Can filter by category with ?categoryId=xxx
	 * - Supports pagination with ?limit=N&offset=N
	 */
	.get('/', async (c) => {
		const user = c.get('user')!
		const query = c.req.query()
		const categoryId = query.categoryId
		const myPlans = query.myPlans === 'true'
		const limit = query.limit ? parseInt(query.limit, 10) : undefined
		const offset = query.offset ? parseInt(query.offset, 10) : undefined

		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

		try {
			if (myPlans && user.mainCharacterId) {
				// Get plans maintained by the user
				const result = await skillsStub.listPlansByOwner(user.mainCharacterId, { limit, offset })
				return c.json(result)
			} else {
				// Get published plans, optionally filtered by category
				const result = await skillsStub.listPublishedPlans(categoryId, { limit, offset })
				const db = createDb(c.env.DATABASE_URL)

				// Add permission flags and maintainer name for each plan
				const plansWithPermissions = await Promise.all(
					result.items.map(async (plan) => {
						const canModify = await canModifyPlan(plan, user.id, c.env, user.is_admin)
						const canDelete = await canDeletePlan(plan, user.id, c.env, user.is_admin)
						const maintainerType = plan.maintainerId?.startsWith('group:')
							? ('group' as const)
							: ('user' as const)
						const maintainerName = plan.maintainerId
							? await resolveMaintainerName(
									plan.maintainerId,
									user.id,
									c.env,
									db,
									user.is_admin
								)
							: 'System'
						return {
							...plan,
							canModify,
							canDelete,
							maintainerType,
							maintainerName,
						}
					})
				)

				return c.json({
					...result,
					items: plansWithPermissions,
				})
			}
		} catch (error) {
			console.error('Failed to list skill plans:', error)
			return c.json({ error: 'Failed to list skill plans' }, 500)
		}
	})

	/**
	 * GET /api/skill-plans/my
	 * Get skill plans maintained by the current user
	 * Note: Pagination is applied AFTER merging user and group plans
	 */
	.get('/my', async (c) => {
		const user = c.get('user')!
		const query = c.req.query()
		const limit = query.limit ? parseInt(query.limit, 10) : 50
		const offset = query.offset ? parseInt(query.offset, 10) : 0

		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

		try {
			// Get plans where user is the maintainer (without pagination for merging)
			const userPlansResult = await skillsStub.listPlansByMaintainer(user.id, { limit: 1000 })
			const plans = [...userPlansResult.items]

			// Also get plans where user is part of a group that maintains the plan
			const memberships = await getCachedUserMemberships(c.env, user.id)

			for (const membership of memberships) {
				const groupPlansResult = await skillsStub.listPlansByMaintainer(
					`group:${membership.groupId}`,
					{
						limit: 1000,
					}
				)
				// Merge group plans with user plans, avoiding duplicates
				for (const plan of groupPlansResult.items) {
					if (!plans.find((p) => p.id === plan.id)) {
						plans.push(plan)
					}
				}
			}

			const db = createDb(c.env.DATABASE_URL)

			// Sort by updated_at desc (same as the DO queries)
			plans.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())

			// Apply pagination after merging
			const total = plans.length
			const paginatedPlans = plans.slice(offset, offset + limit)

			// Add permission flags and maintainer name for each plan
			const plansWithPermissions = await Promise.all(
				paginatedPlans.map(async (plan) => {
					const maintainerType = plan.maintainerId?.startsWith('group:')
						? ('group' as const)
						: ('user' as const)
					const maintainerName = plan.maintainerId
						? await resolveMaintainerName(plan.maintainerId, user.id, c.env, db, user.is_admin)
						: 'System'
					return {
						...plan,
						canModify: true, // User can modify plans they maintain
						canDelete: true, // User can delete plans they maintain
						maintainerType,
						maintainerName,
					}
				})
			)

			return c.json({
				items: plansWithPermissions,
				total,
				limit,
				offset,
			})
		} catch (error) {
			console.error('Failed to get user skill plans:', error)
			return c.json({ error: 'Failed to get user skill plans' }, 500)
		}
	})

	/**
	 * GET /api/skill-plans/:id/skills
	 * Get all skills in a plan
	 * Authorization: Same as viewing the plan
	 */
	.get('/:id/skills', async (c) => {
		const user = c.get('user')!
		const planId = c.req.param('id')

		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

		// Get the plan
		const plan = await skillsStub.getSkillPlan(planId)
		if (!plan) {
			return c.json({ error: 'Skill plan not found' }, 404)
		}

		// Check view permission (same as viewing the plan)
		const allowed = await canViewPlan(plan, user.id, c.env, user.is_admin)
		if (!allowed) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		// Return the skills array from the plan
		// The plan object already includes the skills
		return c.json(plan.skills || [])
	})

	/**
	 * GET /api/skill-plans/:id/progress/character/:characterId
	 * Check a character's progress on a specific skill plan
	 * Authorization: Character owner OR urn:skill-plans:progress:check-any
	 */
	.get('/:id/progress/character/:characterId', async (c) => {
		const user = c.get('user')!
		const planId = c.req.param('id')
		const characterId = c.req.param('characterId')

		const db = createDb(c.env.DATABASE_URL)

		// Check if user can check this character's progress
		const allowed = await canCheckCharacterProgress(
			characterId,
			user.id,
			db,
			c.env,
			user.is_admin
		)
		if (!allowed) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

		// Get the plan first to verify it exists
		const plan = await skillsStub.getSkillPlan(planId)
		if (!plan) {
			return c.json({ error: 'Skill plan not found' }, 404)
		}

		// Check if user can view the plan (if private)
		const canView = await canViewPlan(plan, user.id, c.env, user.is_admin)
		if (!canView) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		// Get character skills from EveCharacterData DO
		const eveCharacterDataStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')

		try {
			let skillsData = await eveCharacterDataStub.getSkills(characterId)

			// If skills not found, try to fetch them from ESI
			if (!skillsData || !skillsData.skills) {
				console.log(`Skills not found for character ${characterId}, fetching from ESI...`)
				try {
					await eveCharacterDataStub.fetchAuthenticatedData(characterId)
					// Try getting skills again after fetching
					skillsData = await eveCharacterDataStub.getSkills(characterId)
				} catch (fetchError) {
					console.error(`Failed to fetch skills from ESI for character ${characterId}:`, fetchError)
					// Continue - will check if skills exist below
				}
			}

			// If still no skills after attempting to fetch
			if (!skillsData || !skillsData.skills) {
				return c.json(
					{
						error: 'Character skills not found. Please ensure the character has a valid EVE token.',
					},
					404
				)
			}

			// Convert skills to format expected by Skills DO
			const characterSkills = skillsData.skills.map((s) => ({
				skill_id: String(s.skill_id),
				active_skill_level: s.active_skill_level,
				trained_skill_level: s.trained_skill_level,
				skillpoints_in_skill: s.skillpoints_in_skill,
			}))

			// Check progress
			const progress = await skillsStub.checkCharacterPlanReadiness(
				planId,
				characterId,
				characterSkills
			)

			// Transform the response to match the UI's expected format
			const transformedProgress = {
				characterId,
				characterName: characterId, // We could get this from somewhere else if needed
				planId: progress.planId,
				planName: progress.planName,
				totalSkills: progress.totalSkills,
				completedRequired: progress.skillsMeetingMinimum,
				completedRecommended: progress.skillsFullyTrained,
				percentageRequired: progress.minimumProgressPercent,
				percentageRecommended: progress.recommendedProgressPercent,
				skills: progress.skillReadiness.map((skill) => ({
					skillId: skill.skillId,
					skillName: skill.skillName,
					requiredLevel: skill.requiredLevel,
					recommendedLevel: skill.recommendedLevel,
					currentLevel: skill.currentLevel,
					meetsRequired: skill.status === 'meets_minimum' || skill.status === 'fully_trained',
					meetsRecommended: skill.status === 'fully_trained',
				})),
			}

			return c.json(transformedProgress)
		} catch (error) {
			console.error('Failed to check character progress:', error)
			return c.json({ error: 'Failed to check character progress' }, 500)
		}
	})

	/**
	 * GET /api/skill-plans/:id/progress
	 * Check current user's main character progress on a specific skill plan
	 * Authorization: Must be authenticated
	 */
	.get('/:id/progress', async (c) => {
		const user = c.get('user')!
		const planId = c.req.param('id')

		// Use the user's main character
		if (!user.mainCharacterId) {
			return c.json({ error: 'No main character set' }, 400)
		}

		const characterId = user.mainCharacterId
		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

		// Get the plan first to verify it exists
		const plan = await skillsStub.getSkillPlan(planId)
		if (!plan) {
			return c.json({ error: 'Skill plan not found' }, 404)
		}

		// Check if user can view the plan (if private)
		const canView = await canViewPlan(plan, user.id, c.env, user.is_admin)
		if (!canView) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		// Get character skills from EveCharacterData DO
		const eveCharacterDataStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')

		try {
			let skillsData = await eveCharacterDataStub.getSkills(characterId)

			// If skills not found, try to fetch them from ESI
			if (!skillsData || !skillsData.skills) {
				console.log(`Skills not found for character ${characterId}, fetching from ESI...`)
				try {
					await eveCharacterDataStub.fetchAuthenticatedData(characterId)
					// Try getting skills again after fetching
					skillsData = await eveCharacterDataStub.getSkills(characterId)
				} catch (fetchError) {
					console.error(`Failed to fetch skills from ESI for character ${characterId}:`, fetchError)
					// Continue - will check if skills exist below
				}
			}

			// If still no skills after attempting to fetch
			if (!skillsData || !skillsData.skills) {
				return c.json(
					{
						error: 'Character skills not found. Please ensure the character has a valid EVE token.',
					},
					404
				)
			}

			// Convert skills to format expected by Skills DO
			const characterSkills = skillsData.skills.map((s) => ({
				skill_id: String(s.skill_id),
				active_skill_level: s.active_skill_level,
				trained_skill_level: s.trained_skill_level,
				skillpoints_in_skill: s.skillpoints_in_skill,
			}))

			// Check progress
			const progress = await skillsStub.checkCharacterPlanReadiness(
				planId,
				characterId,
				characterSkills
			)

			// Transform the response to match the UI's expected format
			const transformedProgress = {
				characterId,
				characterName: characterId, // We could get this from somewhere else if needed
				planId: progress.planId,
				planName: progress.planName,
				totalSkills: progress.totalSkills,
				completedRequired: progress.skillsMeetingMinimum,
				completedRecommended: progress.skillsFullyTrained,
				percentageRequired: progress.minimumProgressPercent,
				percentageRecommended: progress.recommendedProgressPercent,
				skills: progress.skillReadiness.map((skill) => ({
					skillId: skill.skillId,
					skillName: skill.skillName,
					requiredLevel: skill.requiredLevel,
					recommendedLevel: skill.recommendedLevel,
					currentLevel: skill.currentLevel,
					meetsRequired: skill.status === 'meets_minimum' || skill.status === 'fully_trained',
					meetsRecommended: skill.status === 'fully_trained',
				})),
			}

			return c.json(transformedProgress)
		} catch (error) {
			console.error('Failed to check character progress:', error)
			return c.json({ error: 'Failed to check character progress' }, 500)
		}
	})

	/**
	 * GET /api/skill-plans/:id
	 * Get a specific skill plan
	 * - Published plans visible to all authenticated users
	 * - Private plans visible to maintainer only
	 */
	.get('/:id', async (c) => {
		const user = c.get('user')!
		const planId = c.req.param('id')

		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

		// Get the plan
		const plan = await skillsStub.getSkillPlan(planId)
		if (!plan) {
			return c.json({ error: 'Skill plan not found' }, 404)
		}

		// Check view permission
		const allowed = await canViewPlan(plan, user.id, c.env, user.is_admin)
		if (!allowed) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		// Add permission flags for the UI
		const canModify = await canModifyPlan(plan, user.id, c.env, user.is_admin)
		const canDelete = await canDeletePlan(plan, user.id, c.env, user.is_admin)

		// Add maintainer name for display
		const db = createDb(c.env.DATABASE_URL)
		const maintainerType = plan.maintainerId?.startsWith('group:')
			? ('group' as const)
			: ('user' as const)
		const maintainerName = plan.maintainerId
			? await resolveMaintainerName(plan.maintainerId, user.id, c.env, db, user.is_admin)
			: 'System'

		return c.json({
			...plan,
			canModify,
			canDelete,
			maintainerName,
			maintainerType,
		})
	})

	/**
	 * POST /api/skill-plans
	 * Create a new skill plan
	 * Requires: urn:skill-plans:create permission
	 */
	.post('/', async (c) => {
		const user = c.get('user')!

		// Check permission
		const allowed = await canCreateSkillPlan(c.env, user.id, user.is_admin)
		if (!allowed) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		// Parse input
		const data = await c.req.json<CreateSkillPlanInput>()

		// Validate required fields
		if (!data.name || data.name.trim().length === 0) {
			return c.json({ error: 'Plan name is required' }, 400)
		}
		if (!data.description || data.description.trim().length === 0) {
			return c.json({ error: 'Plan description is required' }, 400)
		}

		// Set owner to the user's main character if not specified
		if (!data.ownerCharacterId && user.mainCharacterId) {
			data.ownerCharacterId = user.mainCharacterId
		}

		// Set maintainer to the user if not specified
		// Maintainer should be user.id for users or group:groupId for groups
		if (!data.maintainerId) {
			data.maintainerId = user.id
		}

		// Create the plan
		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')
		try {
			const plan = await skillsStub.createSkillPlan({
				name: data.name.trim(),
				description: data.description.trim(),
				isPublished: data.isPublished ?? false,
				maintainerId: data.maintainerId,
				ownerCharacterId: data.ownerCharacterId,
				categoryIds: data.categoryIds,
			})
			return c.json(plan, 201)
		} catch (error) {
			console.error('Failed to create skill plan:', error)
			return c.json({ error: 'Failed to create skill plan' }, 500)
		}
	})

	/**
	 * PATCH /api/skill-plans/:id
	 * Update a skill plan (partial update)
	 * Authorization: Site admin OR maintainer
	 */
	.patch('/:id', async (c) => {
		const user = c.get('user')!
		const planId = c.req.param('id')

		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

		// Get the plan to check permissions
		const plan = await skillsStub.getSkillPlan(planId)
		if (!plan) {
			return c.json({ error: 'Skill plan not found' }, 404)
		}

		// Check modification permission
		const allowed = await canModifyPlan(plan, user.id, c.env, user.is_admin)
		if (!allowed) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		// Parse input
		const data = await c.req.json<Partial<CreateSkillPlanInput>>()

		// Validate fields if provided
		if (data.name !== undefined && data.name.trim().length === 0) {
			return c.json({ error: 'Plan name cannot be empty' }, 400)
		}
		if (data.description !== undefined && data.description.trim().length === 0) {
			return c.json({ error: 'Plan description cannot be empty' }, 400)
		}

		// Update the plan
		try {
			const updatedPlan = await skillsStub.updateSkillPlan(planId, {
				...(data.name && { name: data.name.trim() }),
				...(data.description && { description: data.description.trim() }),
				...(data.isPublished !== undefined && { isPublished: data.isPublished }),
				...(data.maintainerId !== undefined && { maintainerId: data.maintainerId }),
				...(data.categoryIds !== undefined && { categoryIds: data.categoryIds }),
			})
			return c.json(updatedPlan)
		} catch (error) {
			console.error('Failed to update skill plan:', error)
			return c.json({ error: 'Failed to update skill plan' }, 500)
		}
	})

	/**
	 * DELETE /api/skill-plans/:id
	 * Delete a skill plan
	 * Authorization: Site admin OR maintainer OR urn:skill-plans:delete-any
	 */
	.delete('/:id', async (c) => {
		const user = c.get('user')!
		const planId = c.req.param('id')

		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

		// Get the plan to check permissions
		const plan = await skillsStub.getSkillPlan(planId)
		if (!plan) {
			return c.json({ error: 'Skill plan not found' }, 404)
		}

		// Check deletion permission
		const allowed = await canDeletePlan(plan, user.id, c.env, user.is_admin)
		if (!allowed) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		// Delete the plan
		try {
			const success = await skillsStub.deleteSkillPlan(planId)
			if (success) {
				return c.json({ message: 'Skill plan deleted successfully' })
			} else {
				return c.json({ error: 'Failed to delete skill plan' }, 500)
			}
		} catch (error) {
			console.error('Failed to delete skill plan:', error)
			return c.json({ error: 'Failed to delete skill plan' }, 500)
		}
	})

	// ===== Skill Management within Plans =====

	/**
	 * POST /api/skill-plans/:id/skills
	 * Add a skill to a plan
	 * Authorization: Site admin OR maintainer
	 */
	.post('/:id/skills', async (c) => {
		const user = c.get('user')!
		const planId = c.req.param('id')

		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

		// Get the plan to check permissions
		const plan = await skillsStub.getSkillPlan(planId)
		if (!plan) {
			return c.json({ error: 'Skill plan not found' }, 404)
		}

		// Check modification permission
		const allowed = await canModifyPlan(plan, user.id, c.env, user.is_admin)
		if (!allowed) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		// Parse input
		const data = await c.req.json<Omit<AddSkillToPlanInput, 'planId'>>()

		// Validate input
		if (!data.skillId) {
			return c.json({ error: 'Skill ID is required' }, 400)
		}
		if (data.requiredLevel === undefined || data.requiredLevel < 0 || data.requiredLevel > 5) {
			return c.json({ error: 'Required level must be between 0 and 5' }, 400)
		}
		if (
			data.recommendedLevel === undefined ||
			data.recommendedLevel < 0 ||
			data.recommendedLevel > 5
		) {
			return c.json({ error: 'Recommended level must be between 0 and 5' }, 400)
		}
		// Validate level relationship
		// Allow requiredLevel=0 with recommendedLevel>0 (optional skills)
		// When requiredLevel>0, recommendedLevel must be >= requiredLevel
		if (data.requiredLevel > 0 && data.recommendedLevel < data.requiredLevel) {
			return c.json({ error: 'Recommended level must be >= required level' }, 400)
		}
		if (data.requiredLevel === 0 && data.recommendedLevel === 0) {
			return c.json({ error: 'At least one of required or recommended level must be > 0' }, 400)
		}

		// Add the skill
		try {
			const success = await skillsStub.addSkillToPlan({
				planId,
				skillId: String(data.skillId) as any, // Convert to string for API
				requiredLevel: data.requiredLevel,
				recommendedLevel: data.recommendedLevel,
				displayOrder: data.displayOrder,
				notes: data.notes,
			})

			if (success) {
				// Return the updated plan
				const updatedPlan = await skillsStub.getSkillPlan(planId)
				return c.json(updatedPlan)
			} else {
				return c.json({ error: 'Failed to add skill to plan' }, 500)
			}
		} catch (error: any) {
			console.error('Failed to add skill to plan:', error)
			if (error.message?.includes('already exists')) {
				return c.json({ error: 'Skill already exists in this plan' }, 409)
			}
			return c.json({ error: 'Failed to add skill to plan' }, 500)
		}
	})

	/**
	 * POST /api/skill-plans/:id/skills/batch
	 * Add multiple skills to a plan in batch
	 * Authorization: Site admin OR maintainer
	 */
	.post('/:id/skills/batch', async (c) => {
		const user = c.get('user')!
		const planId = c.req.param('id')

		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

		// Get the plan to check permissions
		const plan = await skillsStub.getSkillPlan(planId)
		if (!plan) {
			return c.json({ error: 'Skill plan not found' }, 404)
		}

		// Check modification permission
		const allowed = await canModifyPlan(plan, user.id, c.env, user.is_admin)
		if (!allowed) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		// Parse input
		const data = await c.req.json<{
			skills: Array<{
				skillId: string | number
				requiredLevel: number
				recommendedLevel: number
				displayOrder?: number
				notes?: string | null
			}>
		}>()

		// Validate input
		if (!data.skills || !Array.isArray(data.skills)) {
			return c.json({ error: 'Skills array is required' }, 400)
		}

		if (data.skills.length === 0) {
			return c.json({ error: 'At least one skill is required' }, 400)
		}

		if (data.skills.length > 100) {
			return c.json({ error: 'Maximum 100 skills can be added at once' }, 400)
		}

		// Basic validation of each skill
		for (const skill of data.skills) {
			if (!skill.skillId) {
				return c.json({ error: 'Each skill must have a skillId' }, 400)
			}
			if (skill.requiredLevel === undefined || skill.requiredLevel < 0 || skill.requiredLevel > 5) {
				return c.json(
					{ error: `Required level must be between 0 and 5 for skill ${skill.skillId}` },
					400
				)
			}
			if (
				skill.recommendedLevel === undefined ||
				skill.recommendedLevel < 0 ||
				skill.recommendedLevel > 5
			) {
				return c.json(
					{ error: `Recommended level must be between 0 and 5 for skill ${skill.skillId}` },
					400
				)
			}
			// Validate level relationship
			// Allow requiredLevel=0 with recommendedLevel>0 (optional skills)
			// When requiredLevel>0, recommendedLevel must be >= requiredLevel
			if (skill.requiredLevel > 0 && skill.recommendedLevel < skill.requiredLevel) {
				return c.json(
					{ error: `Recommended level must be >= required level for skill ${skill.skillId}` },
					400
				)
			}
			if (skill.requiredLevel === 0 && skill.recommendedLevel === 0) {
				return c.json(
					{
						error: `At least one of required or recommended level must be > 0 for skill ${skill.skillId}`,
					},
					400
				)
			}
		}

		// Add the skills in batch
		try {
			const result = await skillsStub.batchAddSkillsToPlan({
				planId,
				skills: data.skills.map((skill) => ({
					skillId: String(skill.skillId) as any, // Convert to string for API
					requiredLevel: skill.requiredLevel,
					recommendedLevel: skill.recommendedLevel,
					displayOrder: skill.displayOrder,
					notes: skill.notes,
				})),
			})

			// Return the result with the updated plan if successful
			if (result.successful > 0) {
				const updatedPlan = await skillsStub.getSkillPlan(planId)
				return c.json({
					...result,
					plan: updatedPlan,
				})
			} else {
				return c.json(result, 400)
			}
		} catch (error: any) {
			console.error('Failed to batch add skills to plan:', error)
			return c.json({ error: 'Failed to batch add skills to plan' }, 500)
		}
	})

	/**
	 * PATCH /api/skill-plans/:id/skills/:skillId
	 * Update a skill in a plan
	 * Authorization: Site admin OR maintainer
	 */
	.patch('/:id/skills/:skillId', async (c) => {
		const user = c.get('user')!
		const planId = c.req.param('id')
		const skillId = c.req.param('skillId')

		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

		// Get the plan to check permissions
		const plan = await skillsStub.getSkillPlan(planId)
		if (!plan) {
			return c.json({ error: 'Skill plan not found' }, 404)
		}

		// Check modification permission
		const allowed = await canModifyPlan(plan, user.id, c.env, user.is_admin)
		if (!allowed) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		// Parse input
		const data = await c.req.json<{
			requiredLevel?: number
			recommendedLevel?: number
			displayOrder?: number
			notes?: string | null
		}>()

		// Validate levels if provided
		if (data.requiredLevel !== undefined && (data.requiredLevel < 0 || data.requiredLevel > 5)) {
			return c.json({ error: 'Required level must be between 0 and 5' }, 400)
		}
		if (
			data.recommendedLevel !== undefined &&
			(data.recommendedLevel < 0 || data.recommendedLevel > 5)
		) {
			return c.json({ error: 'Recommended level must be between 0 and 5' }, 400)
		}

		// Validate level relationship if both are provided
		if (data.requiredLevel !== undefined && data.recommendedLevel !== undefined) {
			// Allow requiredLevel=0 with recommendedLevel>0 (optional skills)
			// When requiredLevel>0, recommendedLevel must be >= requiredLevel
			if (data.requiredLevel > 0 && data.recommendedLevel < data.requiredLevel) {
				return c.json({ error: 'Recommended level must be >= required level' }, 400)
			}
			if (data.requiredLevel === 0 && data.recommendedLevel === 0) {
				return c.json({ error: 'At least one of required or recommended level must be > 0' }, 400)
			}
		}

		// Update the skill
		try {
			const success = await skillsStub.updateSkillInPlan(planId, skillId as any, data)

			if (success) {
				// Return the updated plan
				const updatedPlan = await skillsStub.getSkillPlan(planId)
				return c.json(updatedPlan)
			} else {
				return c.json({ error: 'Failed to update skill in plan' }, 500)
			}
		} catch (error: any) {
			console.error('Failed to update skill in plan:', error)
			if (error.message?.includes('not found')) {
				return c.json({ error: 'Skill not found in plan' }, 404)
			}
			if (error.message?.includes('greater than or equal')) {
				return c.json({ error: 'Recommended level must be >= required level' }, 400)
			}
			return c.json({ error: 'Failed to update skill in plan' }, 500)
		}
	})

	/**
	 * DELETE /api/skill-plans/:id/skills/:skillId
	 * Remove a skill from a plan
	 * Authorization: Site admin OR maintainer
	 */
	.delete('/:id/skills/:skillId', async (c) => {
		const user = c.get('user')!
		const planId = c.req.param('id')
		const skillId = c.req.param('skillId')

		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

		// Get the plan to check permissions
		const plan = await skillsStub.getSkillPlan(planId)
		if (!plan) {
			return c.json({ error: 'Skill plan not found' }, 404)
		}

		// Check modification permission
		const allowed = await canModifyPlan(plan, user.id, c.env, user.is_admin)
		if (!allowed) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		// Remove the skill
		try {
			const success = await skillsStub.removeSkillFromPlan(planId, skillId as any)

			if (success) {
				// Return the updated plan
				const updatedPlan = await skillsStub.getSkillPlan(planId)
				return c.json(updatedPlan)
			} else {
				return c.json({ error: 'Skill not found in plan' }, 404)
			}
		} catch (error) {
			console.error('Failed to remove skill from plan:', error)
			return c.json({ error: 'Failed to remove skill from plan' }, 500)
		}
	})

	// ===== Plan Categories Assignment =====

	/**
	 * POST /api/skill-plans/:id/categories/:categoryId
	 * Add a category to a skill plan
	 * Authorization: Site admin OR maintainer
	 */
	.post('/:id/categories/:categoryId', async (c) => {
		const user = c.get('user')!
		const planId = c.req.param('id')
		const categoryId = c.req.param('categoryId')

		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

		// Get the plan to check permissions
		const plan = await skillsStub.getSkillPlan(planId)
		if (!plan) {
			return c.json({ error: 'Skill plan not found' }, 404)
		}

		// Check modification permission
		const allowed = await canModifyPlan(plan, user.id, c.env, user.is_admin)
		if (!allowed) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		// Add the category
		try {
			const success = await skillsStub.addCategoryToPlan(planId, categoryId)

			if (success) {
				// Return the updated plan
				const updatedPlan = await skillsStub.getSkillPlan(planId)
				return c.json(updatedPlan)
			} else {
				return c.json({ error: 'Failed to add category to plan' }, 500)
			}
		} catch (error) {
			console.error('Failed to add category to plan:', error)
			return c.json({ error: 'Failed to add category to plan' }, 500)
		}
	})

	/**
	 * DELETE /api/skill-plans/:id/categories/:categoryId
	 * Remove a category from a skill plan
	 * Authorization: Site admin OR maintainer
	 */
	.delete('/:id/categories/:categoryId', async (c) => {
		const user = c.get('user')!
		const planId = c.req.param('id')
		const categoryId = c.req.param('categoryId')

		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

		// Get the plan to check permissions
		const plan = await skillsStub.getSkillPlan(planId)
		if (!plan) {
			return c.json({ error: 'Skill plan not found' }, 404)
		}

		// Check modification permission
		const allowed = await canModifyPlan(plan, user.id, c.env, user.is_admin)
		if (!allowed) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		// Remove the category
		try {
			const success = await skillsStub.removeCategoryFromPlan(planId, categoryId)

			if (success) {
				// Return the updated plan
				const updatedPlan = await skillsStub.getSkillPlan(planId)
				return c.json(updatedPlan)
			} else {
				return c.json({ error: 'Category not found in plan' }, 404)
			}
		} catch (error) {
			console.error('Failed to remove category from plan:', error)
			return c.json({ error: 'Failed to remove category from plan' }, 500)
		}
	})

	// ===== Character Progress Checking (Legacy/Deprecated Routes) =====

	/**
	 * GET /api/skill-plans/characters/:characterId/progress/:planId
	 * Check a character's progress on a specific skill plan
	 * Authorization: Character owner OR urn:skill-plans:progress:check-any
	 *
	 * DEPRECATED: Use GET /api/skill-plans/:id/progress/:characterId instead
	 */
	.get('/characters/:characterId/progress/:planId', async (c) => {
		const user = c.get('user')!
		const characterId = c.req.param('characterId')
		const planId = c.req.param('planId')

		const db = createDb(c.env.DATABASE_URL)

		// Check if user can check this character's progress
		const allowed = await canCheckCharacterProgress(
			characterId,
			user.id,
			db,
			c.env,
			user.is_admin
		)
		if (!allowed) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

		// Get the plan first to verify it exists
		const plan = await skillsStub.getSkillPlan(planId)
		if (!plan) {
			return c.json({ error: 'Skill plan not found' }, 404)
		}

		// Check if user can view the plan (if private)
		const canView = await canViewPlan(plan, user.id, c.env, user.is_admin)
		if (!canView) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		// Get character skills from EveCharacterData DO
		const eveCharacterDataStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')

		try {
			let skillsData = await eveCharacterDataStub.getSkills(characterId)

			// If skills not found, try to fetch them from ESI
			if (!skillsData || !skillsData.skills) {
				console.log(`Skills not found for character ${characterId}, fetching from ESI...`)
				try {
					await eveCharacterDataStub.fetchAuthenticatedData(characterId)
					// Try getting skills again after fetching
					skillsData = await eveCharacterDataStub.getSkills(characterId)
				} catch (fetchError) {
					console.error(`Failed to fetch skills from ESI for character ${characterId}:`, fetchError)
					// Continue - will check if skills exist below
				}
			}

			// If still no skills after attempting to fetch
			if (!skillsData || !skillsData.skills) {
				return c.json(
					{
						error: 'Character skills not found. Please ensure the character has a valid EVE token.',
					},
					404
				)
			}

			// Convert skills to format expected by Skills DO
			const characterSkills = skillsData.skills.map((s) => ({
				skill_id: String(s.skill_id),
				active_skill_level: s.active_skill_level,
				trained_skill_level: s.trained_skill_level,
				skillpoints_in_skill: s.skillpoints_in_skill,
			}))

			// Check progress
			const progress = await skillsStub.checkCharacterPlanReadiness(
				planId,
				characterId,
				characterSkills
			)

			// Transform the response to match the UI's expected format
			const transformedProgress = {
				characterId,
				characterName: characterId, // We could get this from somewhere else if needed
				planId: progress.planId,
				planName: progress.planName,
				totalSkills: progress.totalSkills,
				completedRequired: progress.skillsMeetingMinimum,
				completedRecommended: progress.skillsFullyTrained,
				percentageRequired: progress.minimumProgressPercent,
				percentageRecommended: progress.recommendedProgressPercent,
				skills: progress.skillReadiness.map((skill) => ({
					skillId: skill.skillId,
					skillName: skill.skillName,
					requiredLevel: skill.requiredLevel,
					recommendedLevel: skill.recommendedLevel,
					currentLevel: skill.currentLevel,
					meetsRequired: skill.status === 'meets_minimum' || skill.status === 'fully_trained',
					meetsRecommended: skill.status === 'fully_trained',
				})),
			}

			return c.json(transformedProgress)
		} catch (error) {
			console.error('Failed to check character progress:', error)
			return c.json({ error: 'Failed to check character progress' }, 500)
		}
	})

	/**
	 * GET /api/skill-plans/characters/:characterId/progress
	 * Check a character's progress on all published plans or specific plans
	 * Query params: planIds=id1,id2,id3 (optional)
	 * Authorization: Character owner OR urn:skill-plans:progress:check-any
	 */
	.get('/characters/:characterId/progress', async (c) => {
		const user = c.get('user')!
		const characterId = c.req.param('characterId')
		const planIdsParam = c.req.query('planIds')

		const db = createDb(c.env.DATABASE_URL)

		// Check if user can check this character's progress
		const allowed = await canCheckCharacterProgress(
			characterId,
			user.id,
			db,
			c.env,
			user.is_admin
		)
		if (!allowed) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		// Parse plan IDs if provided
		const planIds = planIdsParam ? planIdsParam.split(',').filter(Boolean) : undefined

		// Get character skills from EveCharacterData DO
		const eveCharacterDataStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')

		try {
			let skillsData = await eveCharacterDataStub.getSkills(characterId)

			// If skills not found, try to fetch them from ESI
			if (!skillsData || !skillsData.skills) {
				console.log(`Skills not found for character ${characterId}, fetching from ESI...`)
				try {
					await eveCharacterDataStub.fetchAuthenticatedData(characterId)
					// Try getting skills again after fetching
					skillsData = await eveCharacterDataStub.getSkills(characterId)
				} catch (fetchError) {
					console.error(`Failed to fetch skills from ESI for character ${characterId}:`, fetchError)
					// Continue - will check if skills exist below
				}
			}

			// If still no skills after attempting to fetch
			if (!skillsData || !skillsData.skills) {
				return c.json(
					{
						error: 'Character skills not found. Please ensure the character has a valid EVE token.',
					},
					404
				)
			}

			// Convert skills to format expected by Skills DO
			const characterSkills = skillsData.skills.map((s) => ({
				skill_id: String(s.skill_id),
				active_skill_level: s.active_skill_level,
				trained_skill_level: s.trained_skill_level,
				skillpoints_in_skill: s.skillpoints_in_skill,
			}))

			// Check progress on multiple plans
			const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')
			const progressResults = await skillsStub.calculateMultiplePlanProgress(
				characterId,
				characterSkills,
				planIds
			)

			return c.json(progressResults)
		} catch (error) {
			console.error('Failed to check character progress:', error)
			return c.json({ error: 'Failed to check character progress' }, 500)
		}
	})

export default skillPlansRoutes
