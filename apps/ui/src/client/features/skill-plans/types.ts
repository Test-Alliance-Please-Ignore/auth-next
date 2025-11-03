// Pagination Types
export interface PaginationParams {
	limit?: number
	offset?: number
}

export interface PaginatedResponse<T> {
	items: T[]
	total: number
	limit: number
	offset: number
}

// Skill Plan UI Types
export interface SkillPlan {
	id: string
	name: string
	description: string
	isPublished: boolean
	maintainerId: string | null
	maintainerName?: string // Added by API for display
	maintainerType?: 'user' | 'group'
	ownerCharacterId: string | null
	ownerCharacterName?: string
	createdAt: string
	updatedAt: string
	categories?: SkillPlanCategory[]
	skills?: SkillPlanSkill[]
	canModify?: boolean
	canDelete?: boolean
}

export interface SkillPlanSkill {
	skillId: string
	skillName: string // Should always be provided by backend
	skillGroup: string // Should always be provided by backend
	requiredLevel: number
	recommendedLevel: number
	addedAt: string
	displayOrder?: number
	notes?: string
}

export interface SkillPlanCategory {
	id: string
	name: string
	description: string
	displayOrder: number
}

export interface CreateSkillPlanRequest {
	name: string
	description: string
	isPublished: boolean
	maintainerId: string | null
	ownerCharacterId?: string | null
	categoryIds?: string[]
}

export interface UpdateSkillPlanRequest {
	name?: string
	description?: string
	isPublished?: boolean
	maintainerId?: string | null
	categoryIds?: string[]
	ownerCharacterId?: string | null
}

export interface AddSkillRequest {
	skillId: string
	requiredLevel: number
	recommendedLevel: number
}

export interface UpdateSkillLevelsRequest {
	requiredLevel?: number
	recommendedLevel?: number
}

export interface CharacterProgress {
	characterId: string
	characterName: string
	planId: string
	planName: string
	totalSkills: number
	completedRequired: number
	completedRecommended: number
	percentageRequired: number
	percentageRecommended: number
	skills: CharacterSkillProgress[]
}

export interface CharacterSkillProgress {
	skillId: string
	skillName: string
	requiredLevel: number
	recommendedLevel: number
	currentLevel: number
	meetsRequired: boolean
	meetsRecommended: boolean
	trainingTimeToRequired?: number
	trainingTimeToRecommended?: number
}

export interface SkillPlansFilter {
	search?: string
	categoryId?: string
	published?: boolean
	maintainerType?: 'user' | 'group' | 'all'
	myPlansOnly?: boolean
}

export interface AvailableSkill {
	skillId: string
	name: string
	group: string
	description?: string
	rank?: number
	primaryAttribute?: string
	secondaryAttribute?: string
}

export interface MaintainerOption {
	id: string
	name: string
	type: 'user' | 'group'
}

// Character Mastery Types
export type MasteryStatus = 'fully_trained' | 'meets_minimum' | 'insufficient'

export interface CharacterMastery {
	characterId: string
	characterName: string
	planId: string
	status: MasteryStatus
	percentageRequired: number
	percentageRecommended: number
	completedRequired: number
	completedRecommended: number
	totalSkills: number
	hasValidToken: boolean
}

export interface CharacterMasteryCardProps {
	characterId: string
	characterName: string
	planId: string
	progress?: CharacterProgress
	isLoading?: boolean
	error?: Error | null
	onClick?: () => void
}
