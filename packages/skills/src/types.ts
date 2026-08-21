import type { EveGroupId, EveSkillId } from '@repo/eve-types'

/**
 * Pagination options for list queries
 */
export interface PaginationOptions {
	limit?: number
	offset?: number
}

export interface SkillPlanVisibilityOptions extends PaginationOptions {
	categoryId?: string
	/** Include every plan. This is reserved for site-admin callers. */
	includeAll?: boolean
	/** Include unpublished plans maintained by any of these identifiers. */
	maintainerIds?: string[]
}

/**
 * Paginated result wrapper
 */
export interface PaginatedResult<T> {
	items: T[]
	total: number
	limit: number
	offset: number
}

export interface SkillInfo {
	id: EveSkillId
	name: string
	description: string
	rank: number
	primaryAttribute: string | null
	secondaryAttribute: string | null
	published: boolean
	canNotBeTrained: boolean
}

export interface SkillGroupInfo {
	id: EveGroupId
	name: string
	description: string
	published: boolean
}

export interface SkillPlanSummary {
	id: string
	name: string
	description: string
	isPublished: boolean
	maintainerId: string | null
	ownerCharacterId: string | null
	categories: SkillPlanCategory[]
	totalSkills: number
	createdAt: Date
	updatedAt: Date
}

export interface SkillPlanSkill {
	skillId: EveSkillId
	skillName: string
	requiredLevel: number
	recommendedLevel: number
	displayOrder: number
	notes: string | null
}

export interface SkillPlan {
	id: string
	name: string
	description: string
	isPublished: boolean
	maintainerId: string | null
	ownerCharacterId: string | null
	categories: SkillPlanCategory[]
	skills: SkillPlanSkill[]
	createdAt: Date
	updatedAt: Date
}

export interface SkillPlanCategory {
	id: string
	name: string
	description: string | null
	icon: string | null
	displayOrder: number
}

export interface CreateSkillPlanInput {
	name: string
	description: string
	isPublished?: boolean
	maintainerId?: string | null
	ownerCharacterId?: string | null
	categoryIds?: string[]
}

export interface AddSkillToPlanInput {
	planId: string
	skillId: EveSkillId
	requiredLevel: number
	recommendedLevel: number
	displayOrder?: number
	notes?: string | null
}

export interface BatchAddSkillsInput {
	planId: string
	skills: Array<{
		skillId: EveSkillId
		requiredLevel: number
		recommendedLevel: number
		displayOrder?: number
		notes?: string | null
	}>
}

export interface BatchAddSkillsResult {
	successful: number
	failed: number
	errors: Array<{
		skillId: EveSkillId
		error: string
	}>
}

export interface CharacterSkillReadiness {
	skillId: EveSkillId
	skillName: string
	requiredLevel: number
	recommendedLevel: number
	currentLevel: number
	status: 'fully_trained' | 'meets_minimum' | 'insufficient'
	levelsNeededForMinimum: number
	levelsNeededForRecommended: number
}

export interface CharacterPlanProgress {
	planId: string
	planName: string
	totalSkills: number
	skillsMeetingMinimum: number
	skillsFullyTrained: number
	minimumProgressPercent: number
	recommendedProgressPercent: number
	skillReadiness: CharacterSkillReadiness[]
}
