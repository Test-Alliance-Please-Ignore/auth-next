import { apiClient } from '../../lib/api'
import type {
	SkillPlan,
	CreateSkillPlanRequest,
	UpdateSkillPlanRequest,
	AddSkillRequest,
	UpdateSkillLevelsRequest,
	SkillPlanCategory,
	CharacterProgress,
	AvailableSkill,
	SkillPlanSkill,
	PaginationParams,
	PaginatedResponse,
} from './types'

export const skillPlansApi = {
	// Plan CRUD operations
	getPlans: async (
		filters?: {
			search?: string
			categoryId?: string
			published?: boolean
			maintainerId?: string
		},
		pagination?: PaginationParams
	): Promise<PaginatedResponse<SkillPlan>> => {
		const params = new URLSearchParams()
		if (filters?.search) params.append('search', filters.search)
		if (filters?.categoryId) params.append('categoryId', filters.categoryId)
		if (filters?.published !== undefined) params.append('published', String(filters.published))
		if (filters?.maintainerId) params.append('maintainerId', filters.maintainerId)
		if (pagination?.limit !== undefined) params.append('limit', String(pagination.limit))
		if (pagination?.offset !== undefined) params.append('offset', String(pagination.offset))

		const query = params.toString()
		const url = query ? `/skill-plans?${query}` : '/skill-plans'
		return apiClient.get<PaginatedResponse<SkillPlan>>(url)
	},

	getMyPlans: async (pagination?: PaginationParams): Promise<PaginatedResponse<SkillPlan>> => {
		const params = new URLSearchParams()
		if (pagination?.limit !== undefined) params.append('limit', String(pagination.limit))
		if (pagination?.offset !== undefined) params.append('offset', String(pagination.offset))

		const query = params.toString()
		const url = query ? `/skill-plans/my?${query}` : '/skill-plans/my'
		return apiClient.get<PaginatedResponse<SkillPlan>>(url)
	},

	getPlan: async (planId: string): Promise<SkillPlan> => {
		return apiClient.get<SkillPlan>(`/skill-plans/${planId}`)
	},

	createPlan: async (data: CreateSkillPlanRequest): Promise<SkillPlan> => {
		return apiClient.post<SkillPlan>('/skill-plans', data)
	},

	updatePlan: async (planId: string, data: UpdateSkillPlanRequest): Promise<SkillPlan> => {
		return apiClient.patch<SkillPlan>(`/skill-plans/${planId}`, data)
	},

	deletePlan: async (planId: string): Promise<void> => {
		return apiClient.delete(`/skill-plans/${planId}`)
	},

	// Skill management
	getPlanSkills: async (planId: string): Promise<SkillPlanSkill[]> => {
		return apiClient.get<SkillPlanSkill[]>(`/skill-plans/${planId}/skills`)
	},

	addSkillToPlan: async (planId: string, data: AddSkillRequest): Promise<void> => {
		return apiClient.post(`/skill-plans/${planId}/skills`, data)
	},

	batchAddSkillsToPlan: async (
		planId: string,
		skills: Array<{
			skillId: number
			requiredLevel: number
			recommendedLevel: number
		}>
	): Promise<any> => {
		return apiClient.post(`/skill-plans/${planId}/skills/batch`, { skills })
	},

	updateSkillLevels: async (
		planId: string,
		skillId: string,
		data: UpdateSkillLevelsRequest
	): Promise<void> => {
		return apiClient.patch(`/skill-plans/${planId}/skills/${skillId}`, data)
	},

	removeSkillFromPlan: async (planId: string, skillId: string): Promise<void> => {
		return apiClient.delete(`/skill-plans/${planId}/skills/${skillId}`)
	},

	// Category management
	getCategories: async (): Promise<SkillPlanCategory[]> => {
		return apiClient.get<SkillPlanCategory[]>('/skill-plans/categories')
	},

	createCategory: async (data: {
		name: string
		description: string
		displayOrder?: number
	}): Promise<SkillPlanCategory> => {
		return apiClient.post<SkillPlanCategory>('/skill-plans/categories', data)
	},

	updateCategory: async (
		categoryId: string,
		data: {
			name?: string
			description?: string
			displayOrder?: number
		}
	): Promise<SkillPlanCategory> => {
		return apiClient.patch<SkillPlanCategory>(`/skill-plans/categories/${categoryId}`, data)
	},

	deleteCategory: async (categoryId: string): Promise<void> => {
		return apiClient.delete(`/skill-plans/categories/${categoryId}`)
	},

	addCategoryToPlan: async (planId: string, categoryId: string): Promise<void> => {
		return apiClient.post(`/skill-plans/${planId}/categories/${categoryId}`)
	},

	removeCategoryFromPlan: async (planId: string, categoryId: string): Promise<void> => {
		return apiClient.delete(`/skill-plans/${planId}/categories/${categoryId}`)
	},

	// Progress checking
	checkCharacterProgress: async (
		planId: string,
		characterId?: string
	): Promise<CharacterProgress> => {
		const url = characterId
			? `/skill-plans/${planId}/progress/${characterId}`
			: `/skill-plans/${planId}/progress`
		return apiClient.get<CharacterProgress>(url)
	},

	// Get all available skills (from Skills durable object with caching)
	getAvailableSkills: async (): Promise<AvailableSkill[]> => {
		const skills = await apiClient.get<any[]>('/skills')
		// Transform the response to match AvailableSkill interface
		return skills.map(skill => ({
			skillId: String(skill.id || skill.skillId),
			name: skill.name,
			group: skill.groupName || 'Unknown',
			description: skill.description,
			rank: skill.rank,
			primaryAttribute: skill.primaryAttribute,
			secondaryAttribute: skill.secondaryAttribute,
		}))
	},

	// Search for skills by name
	searchSkills: async (query: string, limit = 50): Promise<AvailableSkill[]> => {
		const params = new URLSearchParams({ search: query, limit: String(limit) })
		const skills = await apiClient.get<any[]>(`/skills?${params}`)
		// Transform the response to match AvailableSkill interface
		return skills.map(skill => ({
			skillId: String(skill.id || skill.skillId),
			name: skill.name,
			group: skill.groupName || 'Unknown',
			description: skill.description,
			rank: skill.rank,
			primaryAttribute: skill.primaryAttribute,
			secondaryAttribute: skill.secondaryAttribute,
		}))
	},
}