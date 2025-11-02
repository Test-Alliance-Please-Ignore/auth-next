/**
 * @repo/skills
 *
 * Shared types and interfaces for the Skills Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

import type { DurableObject } from 'cloudflare:workers'
import type { EveGroupId, EveSkillId } from '@repo/eve-types'
import type {
	AddSkillToPlanInput,
	BatchAddSkillsInput,
	BatchAddSkillsResult,
	CharacterPlanProgress,
	CreateSkillPlanInput,
	SkillInfo,
	SkillPlan,
	SkillPlanCategory,
	SkillPlanSummary,
} from './types'

export type {
	AddSkillToPlanInput,
	BatchAddSkillsInput,
	BatchAddSkillsResult,
	CharacterPlanProgress,
	CharacterSkillReadiness,
	CreateSkillPlanInput,
	SkillGroupInfo,
	SkillInfo,
	SkillPlan,
	SkillPlanCategory,
	SkillPlanSkill,
	SkillPlanSummary,
} from './types'

/**
 * Public RPC interface for Skills Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Skills } from '@repo/skills'
 * import { getStub } from '@repo/do-utils'
 *
 * const stub = getStub<Skills>(env.SKILLS, 'my-id')
 * const result = await stub.exampleMethod('hello')
 * ```
 */
export interface Skills extends DurableObject {
	/**
	 * Get skill information by ID
	 * @param skillId - The ID of the skill to get information for
	 * @returns The skill information or null if not found
	 */
	getSkillInfo(skillId: EveSkillId): Promise<SkillInfo | null>

	/**
	 * Get all available skills with group information
	 * @param includeUnpublished - Whether to include unpublished skills
	 * @returns All skills with group information
	 */
	getAllSkills(includeUnpublished?: boolean): Promise<any[]>

	/**
	 * Search skills by name or partial match
	 * @param query - The search query
	 * @param limit - Maximum number of results to return
	 * @returns Skills matching the query
	 */
	searchSkills(query: string, limit?: number): Promise<any[]>

	/**
	 * Clear all skill caches
	 * Useful for manual cache invalidation
	 */
	clearAllCaches(): Promise<void>

	/**
	 * Get skills by group ID
	 * @param groupId - The ID of the group to get skills for
	 * @returns The skills in the group
	 */
	getSkillsByGroupId(groupId: EveGroupId): Promise<SkillInfo[]>

	/**
	 * Get required skills for a skill
	 * @param skillId - The ID of the skill to get required skills for
	 * @returns The required skills
	 */
	getRequiredSkillsForSkill(skillId: EveSkillId): Promise<SkillInfo[]>

	// ===== Skill Plan Methods =====

	/**
	 * Create a new skill plan
	 * @param input - The skill plan creation input
	 * @returns The created skill plan
	 */
	createSkillPlan(input: CreateSkillPlanInput): Promise<SkillPlan>

	/**
	 * Get a skill plan by ID
	 * @param planId - The ID of the skill plan
	 * @returns The skill plan or null if not found
	 */
	getSkillPlan(planId: string): Promise<SkillPlan | null>

	/**
	 * Update an existing skill plan
	 * @param planId - The ID of the skill plan to update
	 * @param input - The update input (partial)
	 * @returns The updated skill plan
	 */
	updateSkillPlan(planId: string, input: Partial<CreateSkillPlanInput>): Promise<SkillPlan>

	/**
	 * Delete a skill plan
	 * @param planId - The ID of the skill plan to delete
	 * @returns Success status
	 */
	deleteSkillPlan(planId: string): Promise<boolean>

	/**
	 * List published skill plans
	 * @param categoryId - Optional category ID to filter by
	 * @returns List of published skill plans
	 */
	listPublishedPlans(categoryId?: string): Promise<SkillPlanSummary[]>

	/**
	 * List skill plans by owner
	 * @param ownerCharacterId - The character ID of the owner
	 * @returns List of skill plans owned by the character
	 */
	listPlansByOwner(ownerCharacterId: string): Promise<SkillPlanSummary[]>

	/**
	 * List skill plans by maintainer
	 * @param maintainerId - The ID of the maintainer (user ID or group:groupId)
	 * @returns List of skill plans maintained by the user or group
	 */
	listPlansByMaintainer(maintainerId: string): Promise<SkillPlanSummary[]>

	/**
	 * Add a skill to a plan
	 * @param input - The skill addition input
	 * @returns Success status
	 */
	addSkillToPlan(input: AddSkillToPlanInput): Promise<boolean>

	/**
	 * Add multiple skills to a plan in batch
	 * @param input - The batch skills addition input
	 * @returns Result with successful/failed counts and errors
	 */
	batchAddSkillsToPlan(input: BatchAddSkillsInput): Promise<BatchAddSkillsResult>

	/**
	 * Remove a skill from a plan
	 * @param planId - The plan ID
	 * @param skillId - The skill ID to remove
	 * @returns Success status
	 */
	removeSkillFromPlan(planId: string, skillId: EveSkillId): Promise<boolean>

	/**
	 * Update a skill in a plan
	 * @param planId - The plan ID
	 * @param skillId - The skill ID to update
	 * @param input - The update input
	 * @returns Success status
	 */
	updateSkillInPlan(
		planId: string,
		skillId: EveSkillId,
		input: Partial<Omit<AddSkillToPlanInput, 'planId' | 'skillId'>>
	): Promise<boolean>

	/**
	 * Check character's readiness for a skill plan
	 * @param planId - The skill plan ID
	 * @param characterId - The character ID
	 * @param characterSkills - JSON array of character's current skills
	 * @returns Character's progress and readiness for the plan
	 */
	checkCharacterPlanReadiness(
		planId: string,
		characterId: string,
		characterSkills: Array<{
			skill_id: string
			active_skill_level: number
			trained_skill_level: number
			skillpoints_in_skill: number
		}>
	): Promise<CharacterPlanProgress>

	/**
	 * Calculate character's progress across multiple plans
	 * @param characterId - The character ID
	 * @param characterSkills - JSON array of character's current skills
	 * @param planIds - Optional array of plan IDs to check (defaults to all published)
	 * @returns Progress for each plan
	 */
	calculateMultiplePlanProgress(
		characterId: string,
		characterSkills: Array<{
			skill_id: string
			active_skill_level: number
			trained_skill_level: number
			skillpoints_in_skill: number
		}>,
		planIds?: string[]
	): Promise<CharacterPlanProgress[]>

	// ===== Skill Plan Category Methods =====

	/**
	 * Create a new skill plan category
	 * @param input - The category creation input
	 * @returns The created category
	 */
	createSkillPlanCategory(input: {
		name: string
		description?: string
		icon?: string
		displayOrder?: number
	}): Promise<SkillPlanCategory>

	/**
	 * List all skill plan categories
	 * @returns List of all categories
	 */
	listSkillPlanCategories(): Promise<SkillPlanCategory[]>

	/**
	 * Update a skill plan category
	 * @param categoryId - The ID of the category to update
	 * @param input - The update input (partial)
	 * @returns The updated category
	 */
	updateSkillPlanCategory(
		categoryId: string,
		input: {
			name?: string
			description?: string
			icon?: string
			displayOrder?: number
		}
	): Promise<SkillPlanCategory>

	/**
	 * Delete a skill plan category
	 * @param categoryId - The ID of the category to delete
	 * @returns Success status
	 */
	deleteSkillPlanCategory(categoryId: string): Promise<boolean>

	/**
	 * Add a category to a skill plan
	 * @param planId - The plan ID
	 * @param categoryId - The category ID
	 * @returns Success status
	 */
	addCategoryToPlan(planId: string, categoryId: string): Promise<boolean>

	/**
	 * Remove a category from a skill plan
	 * @param planId - The plan ID
	 * @param categoryId - The category ID
	 * @returns Success status
	 */
	removeCategoryFromPlan(planId: string, categoryId: string): Promise<boolean>
}
