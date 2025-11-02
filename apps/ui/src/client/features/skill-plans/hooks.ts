import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { skillPlansApi } from './api'
import type {
	SkillPlan,
	CreateSkillPlanRequest,
	UpdateSkillPlanRequest,
	AddSkillRequest,
	UpdateSkillLevelsRequest,
	CharacterProgress,
	SkillPlanCategory,
	AvailableSkill,
	SkillPlanSkill,
} from './types'

// Query key factory
export const skillPlanKeys = {
	all: ['skill-plans'] as const,
	lists: () => [...skillPlanKeys.all, 'list'] as const,
	list: (filters?: any) => [...skillPlanKeys.lists(), filters] as const,
	myPlans: () => [...skillPlanKeys.all, 'my-plans'] as const,
	details: () => [...skillPlanKeys.all, 'detail'] as const,
	detail: (id: string) => [...skillPlanKeys.details(), id] as const,
	skills: (planId: string) => [...skillPlanKeys.all, 'skills', planId] as const,
	categories: () => [...skillPlanKeys.all, 'categories'] as const,
	progress: (planId: string, characterId?: string) =>
		[...skillPlanKeys.all, 'progress', planId, characterId] as const,
	availableSkills: () => ['available-skills'] as const,
	searchSkills: (query: string) => ['available-skills', 'search', query] as const,
}

// Plan queries
export function useSkillPlans(filters?: {
	search?: string
	categoryId?: string
	published?: boolean
	maintainerId?: string
}) {
	return useQuery<SkillPlan[]>({
		queryKey: skillPlanKeys.list(filters),
		queryFn: () => skillPlansApi.getPlans(filters),
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}

export function useMySkillPlans() {
	return useQuery<SkillPlan[]>({
		queryKey: skillPlanKeys.myPlans(),
		queryFn: () => skillPlansApi.getMyPlans(),
		staleTime: 1000 * 60 * 2, // 2 minutes
	})
}

export function useSkillPlan(planId: string) {
	return useQuery<SkillPlan>({
		queryKey: skillPlanKeys.detail(planId),
		queryFn: () => skillPlansApi.getPlan(planId),
		staleTime: 1000 * 60 * 2, // 2 minutes
		enabled: !!planId,
	})
}

// Plan mutations
export function useCreateSkillPlan() {
	const queryClient = useQueryClient()

	return useMutation<SkillPlan, Error, CreateSkillPlanRequest>({
		mutationFn: (data) => skillPlansApi.createPlan(data),
		onSuccess: () => {
			// Invalidate all plan lists
			queryClient.invalidateQueries({ queryKey: skillPlanKeys.lists() })
			queryClient.invalidateQueries({ queryKey: skillPlanKeys.myPlans() })
		},
	})
}

export function useUpdateSkillPlan() {
	const queryClient = useQueryClient()

	return useMutation<SkillPlan, Error, { planId: string; data: UpdateSkillPlanRequest }>({
		mutationFn: ({ planId, data }) => skillPlansApi.updatePlan(planId, data),
		onSuccess: (data, variables) => {
			// Update the detail cache
			queryClient.setQueryData(skillPlanKeys.detail(variables.planId), data)
			// Invalidate lists
			queryClient.invalidateQueries({ queryKey: skillPlanKeys.lists() })
			queryClient.invalidateQueries({ queryKey: skillPlanKeys.myPlans() })
		},
	})
}

export function useDeleteSkillPlan() {
	const queryClient = useQueryClient()

	return useMutation<void, Error, string>({
		mutationFn: (planId) => skillPlansApi.deletePlan(planId),
		onSuccess: (_, planId) => {
			// Remove from cache
			queryClient.removeQueries({ queryKey: skillPlanKeys.detail(planId) })
			// Invalidate lists
			queryClient.invalidateQueries({ queryKey: skillPlanKeys.lists() })
			queryClient.invalidateQueries({ queryKey: skillPlanKeys.myPlans() })
		},
	})
}

// Skill management
export function usePlanSkills(planId: string) {
	return useQuery<SkillPlanSkill[]>({
		queryKey: skillPlanKeys.skills(planId),
		queryFn: () => skillPlansApi.getPlanSkills(planId),
		staleTime: 1000 * 60 * 2, // 2 minutes
		enabled: !!planId,
	})
}

export function useAddSkillToPlan() {
	const queryClient = useQueryClient()

	return useMutation<void, Error, { planId: string; data: AddSkillRequest }>({
		mutationFn: ({ planId, data }) => skillPlansApi.addSkillToPlan(planId, data),
		onSuccess: (_, variables) => {
			// Invalidate plan skills
			queryClient.invalidateQueries({ queryKey: skillPlanKeys.skills(variables.planId) })
			// Invalidate plan detail to refresh skill count
			queryClient.invalidateQueries({ queryKey: skillPlanKeys.detail(variables.planId) })
		},
	})
}

export function useBatchAddSkillsToPlan() {
	const queryClient = useQueryClient()

	return useMutation<any, Error, { planId: string; skills: Array<{ skillId: number; requiredLevel: number; recommendedLevel: number }> }>({
		mutationFn: ({ planId, skills }) => skillPlansApi.batchAddSkillsToPlan(planId, skills),
		onSuccess: (_, variables) => {
			// Invalidate plan skills
			queryClient.invalidateQueries({ queryKey: skillPlanKeys.skills(variables.planId) })
			// Invalidate plan detail to refresh skill count
			queryClient.invalidateQueries({ queryKey: skillPlanKeys.detail(variables.planId) })
		},
	})
}

export function useUpdateSkillLevels() {
	const queryClient = useQueryClient()

	return useMutation<
		void,
		Error,
		{ planId: string; skillId: string; data: UpdateSkillLevelsRequest }
	>({
		mutationFn: ({ planId, skillId, data }) =>
			skillPlansApi.updateSkillLevels(planId, skillId, data),
		onSuccess: (_, variables) => {
			// Invalidate plan skills
			queryClient.invalidateQueries({ queryKey: skillPlanKeys.skills(variables.planId) })
		},
	})
}

export function useRemoveSkillFromPlan() {
	const queryClient = useQueryClient()

	return useMutation<void, Error, { planId: string; skillId: string }>({
		mutationFn: ({ planId, skillId }) => skillPlansApi.removeSkillFromPlan(planId, skillId),
		onSuccess: (_, variables) => {
			// Invalidate plan skills
			queryClient.invalidateQueries({ queryKey: skillPlanKeys.skills(variables.planId) })
			// Invalidate plan detail to refresh skill count
			queryClient.invalidateQueries({ queryKey: skillPlanKeys.detail(variables.planId) })
		},
	})
}

// Categories
export function useSkillPlanCategories() {
	return useQuery<SkillPlanCategory[]>({
		queryKey: skillPlanKeys.categories(),
		queryFn: () => skillPlansApi.getCategories(),
		staleTime: 1000 * 60 * 10, // 10 minutes - categories change rarely
	})
}

export function useCreateCategory() {
	const queryClient = useQueryClient()

	return useMutation<SkillPlanCategory, Error, { name: string; description: string; displayOrder?: number }>({
		mutationFn: (data) => skillPlansApi.createCategory(data),
		onSuccess: () => {
			// Invalidate categories list
			queryClient.invalidateQueries({ queryKey: skillPlanKeys.categories() })
		},
	})
}

export function useUpdateCategory() {
	const queryClient = useQueryClient()

	return useMutation<
		SkillPlanCategory,
		Error,
		{ categoryId: string; data: { name?: string; description?: string; displayOrder?: number } }
	>({
		mutationFn: ({ categoryId, data }) => skillPlansApi.updateCategory(categoryId, data),
		onSuccess: () => {
			// Invalidate categories list
			queryClient.invalidateQueries({ queryKey: skillPlanKeys.categories() })
		},
	})
}

export function useDeleteCategory() {
	const queryClient = useQueryClient()

	return useMutation<void, Error, string>({
		mutationFn: (categoryId) => skillPlansApi.deleteCategory(categoryId),
		onSuccess: () => {
			// Invalidate categories list
			queryClient.invalidateQueries({ queryKey: skillPlanKeys.categories() })
		},
	})
}

export function useAddCategoryToPlan() {
	const queryClient = useQueryClient()

	return useMutation<void, Error, { planId: string; categoryId: string }>({
		mutationFn: ({ planId, categoryId }) => skillPlansApi.addCategoryToPlan(planId, categoryId),
		onSuccess: (_, variables) => {
			// Invalidate plan detail
			queryClient.invalidateQueries({ queryKey: skillPlanKeys.detail(variables.planId) })
		},
	})
}

export function useRemoveCategoryFromPlan() {
	const queryClient = useQueryClient()

	return useMutation<void, Error, { planId: string; categoryId: string }>({
		mutationFn: ({ planId, categoryId }) =>
			skillPlansApi.removeCategoryFromPlan(planId, categoryId),
		onSuccess: (_, variables) => {
			// Invalidate plan detail
			queryClient.invalidateQueries({ queryKey: skillPlanKeys.detail(variables.planId) })
		},
	})
}

// Progress checking
export function useCharacterProgress(planId: string, characterId?: string) {
	return useQuery<CharacterProgress>({
		queryKey: skillPlanKeys.progress(planId, characterId),
		queryFn: () => skillPlansApi.checkCharacterProgress(planId, characterId),
		staleTime: 1000 * 60 * 1, // 1 minute - progress can change quickly
		enabled: !!planId,
	})
}

// Available skills
export function useAvailableSkills() {
	return useQuery<AvailableSkill[]>({
		queryKey: skillPlanKeys.availableSkills(),
		queryFn: () => skillPlansApi.getAvailableSkills(),
		staleTime: 1000 * 60 * 30, // 30 minutes - skills rarely change
	})
}

// Search skills
export function useSearchSkills(query: string, enabled = true) {
	return useQuery<AvailableSkill[]>({
		queryKey: skillPlanKeys.searchSkills(query),
		queryFn: () => skillPlansApi.searchSkills(query),
		enabled: enabled && query.length >= 2,
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}