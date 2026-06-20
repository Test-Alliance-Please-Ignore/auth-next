/**
 * Applications Feature Hooks
 *
 * React Query hooks for managing application data fetching, mutations, and caching.
 * Follows TanStack Query v5 patterns with gcTime instead of cacheTime.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { applicationsApi, fulcrumApi } from './api'
import { auditorUserKeys } from '@/hooks/useAuditorUsers'
import { useApiMutation } from '@/hooks/useApiMutation'

import type {
	AddHRNoteRequest,
	AddRecommendationRequest,
	Application,
	ApplicationActivityLogEntry,
	ApplicationsListResult,
	ApplicationMessage,
	ApplicationStaffNote,
	ApplicationsParams,
	CharacterReportMetadata,
	CreateTemplateRequest,
	FulcrumCharacterData,
	HRNote,
	HRNotesParams,
	MessageTemplate,
	MessageTemplateStatus,
	RecommendableApplication,
	Recommendation,
	RecommenderApplicationDetail,
	ReportManifest,
	ReportRequestSource,
	ReportSectionName,
	SendMessageRequest,
	SubmitApplicationRequest,
	UpsertApplicationStaffNoteRequest,
	UpdateApplicationStatusRequest,
	UpdateHRNoteRequest,
	UpdateRecommendationRequest,
	UpdateTemplateRequest,
} from './api'

// ============================================================================
// Query Key Factory
// ============================================================================

/**
 * Query key factory for consistent cache key generation
 * Pattern: ['applications', ...scope, ...params]
 */
export const applicationKeys = {
	all: ['applications'] as const,
	lists: () => [...applicationKeys.all, 'list'] as const,
	list: (filters: string) => [...applicationKeys.lists(), filters] as const,
	details: () => [...applicationKeys.all, 'detail'] as const,
	detail: (id: string) => [...applicationKeys.details(), id] as const,
	recommendations: (id: string) => [...applicationKeys.detail(id), 'recommendations'] as const,
	activity: (id: string) => [...applicationKeys.detail(id), 'activity'] as const,
	messages: (id: string) => [...applicationKeys.detail(id), 'messages'] as const,
	messageCount: (id: string) => [...applicationKeys.detail(id), 'message-count'] as const,
	staffNotes: (id: string) => [...applicationKeys.detail(id), 'staff-notes'] as const,
	hrNotes: () => [...applicationKeys.all, 'hr-notes'] as const,
	hrNotesList: (filters: string) => [...applicationKeys.hrNotes(), filters] as const,
	hrNoteDetail: (noteId: string) => [...applicationKeys.hrNotes(), noteId] as const,
	hrNotesForUser: (userId: string) => [...applicationKeys.hrNotes(), 'user', userId] as const,
	// Message Templates
	templates: () => [...applicationKeys.all, 'templates'] as const,
	templatesList: (corporationId: string, status?: string) =>
		[...applicationKeys.templates(), corporationId, status || 'all'] as const,
	templateDetail: (templateId: string) => [...applicationKeys.templates(), 'detail', templateId] as const,
	// Fulcrum (Character Reports)
	fulcrumUserCharacters: (userId: string, corporationId: string) =>
		[...applicationKeys.all, 'fulcrum', 'user-characters', userId, corporationId] as const,
	fulcrumCharacterReports: (characterId: string, corporationId: string) =>
		[...applicationKeys.all, 'fulcrum', 'character', characterId, corporationId] as const,
	fulcrumReportSections: (reportId: string) =>
		[...applicationKeys.all, 'fulcrum-report', reportId, 'sections'] as const,
	fulcrumReportSection: (reportId: string, section: ReportSectionName) =>
		[...applicationKeys.all, 'fulcrum-report', reportId, 'section', section] as const,
	// Recommendations discovery (corp members)
	recommendationsPending: () => [...applicationKeys.all, 'recommendations-pending'] as const,
	recommendationsDetail: (id: string) =>
		[...applicationKeys.all, 'recommendations-detail', id] as const,
	// Character application history
	characterHistory: (characterId: string) =>
		[...applicationKeys.all, 'character-history', characterId] as const,
	userHistory: (userId: string) =>
		[...applicationKeys.all, 'user-history', userId] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Hook to fetch applications with optional filters
 * @param params - Query parameters for filtering applications
 */
export function useApplications(params?: ApplicationsParams) {
	const filterKey = params ? JSON.stringify(params) : 'all'

	return useQuery<Application[]>({
		queryKey: applicationKeys.list(filterKey),
		queryFn: () => applicationsApi.getApplications(params),
		staleTime: 1000 * 60 * 2, // 2 minutes
		gcTime: 1000 * 60 * 5, // 5 minutes
	})
}

export function useApplicationsPaged(params?: ApplicationsParams) {
	const filterKey = params ? JSON.stringify(params) : 'all'

	return useQuery<ApplicationsListResult>({
		queryKey: [...applicationKeys.list(filterKey), 'paged'],
		queryFn: () => applicationsApi.getApplicationsPaged(params),
		placeholderData: (previousData) => previousData,
		staleTime: 1000 * 60 * 2,
		gcTime: 1000 * 60 * 5,
	})
}

/**
 * Hook to fetch a single application by ID
 * @param applicationId - The application ID to fetch
 */
export function useApplication(applicationId: string) {
	return useQuery<Application>({
		queryKey: applicationKeys.detail(applicationId),
		queryFn: () => applicationsApi.getApplication(applicationId),
		staleTime: 1000 * 60, // 1 minute
		gcTime: 1000 * 60 * 3, // 3 minutes
		enabled: !!applicationId,
	})
}

/**
 * Hook to fetch prior applications for a specific character, excluding the current application
 */
export function useCharacterApplicationHistory(characterId: string, excludeApplicationId: string) {
	return useQuery<Application[]>({
		queryKey: applicationKeys.characterHistory(characterId),
		queryFn: async () => {
			const apps = await applicationsApi.getApplications({ characterId })
			return apps.filter((a) => a.id !== excludeApplicationId)
		},
		staleTime: 1000 * 60 * 5,
		gcTime: 1000 * 60 * 10,
		enabled: !!characterId,
	})
}

/**
 * Hook to fetch prior applications for a user account, excluding the current application
 */
export function useUserApplicationHistory(userId: string, excludeApplicationId: string) {
	return useQuery<Application[]>({
		queryKey: applicationKeys.userHistory(userId),
		queryFn: async () => {
			const apps = await applicationsApi.getApplications({ userId })
			return apps.filter((a) => a.id !== excludeApplicationId)
		},
		staleTime: 1000 * 60 * 5,
		gcTime: 1000 * 60 * 10,
		enabled: !!userId,
	})
}

/**
 * Hook to fetch recommendations for an application
 * @param applicationId - The application ID
 */
export function useRecommendations(applicationId: string) {
	return useQuery<Recommendation[]>({
		queryKey: applicationKeys.recommendations(applicationId),
		queryFn: () => applicationsApi.getRecommendations(applicationId),
		staleTime: 1000 * 60, // 1 minute
		gcTime: 1000 * 60 * 3, // 3 minutes
		enabled: !!applicationId,
	})
}

/**
 * Hook to fetch activity log for an application
 * @param applicationId - The application ID
 */
export function useApplicationActivity(applicationId: string) {
	return useQuery<ApplicationActivityLogEntry[]>({
		queryKey: applicationKeys.activity(applicationId),
		queryFn: () => applicationsApi.getApplicationActivity(applicationId),
		staleTime: 1000 * 60, // 1 minute
		gcTime: 1000 * 60 * 3, // 3 minutes
		enabled: !!applicationId,
	})
}

/**
 * Hook to fetch messages for an application
 * @param applicationId - The application ID
 */
export function useMessages(applicationId: string) {
	return useQuery<ApplicationMessage[]>({
		queryKey: applicationKeys.messages(applicationId),
		queryFn: () => applicationsApi.getMessages(applicationId),
		staleTime: 1000 * 60, // 1 minute
		gcTime: 1000 * 60 * 3, // 3 minutes
		enabled: !!applicationId,
	})
}

/**
 * Hook to fetch message count for an application (for badge display)
 * @param applicationId - The application ID
 */
export function useMessageCount(applicationId: string) {
	return useQuery<number>({
		queryKey: applicationKeys.messageCount(applicationId),
		queryFn: () => applicationsApi.getMessageCount(applicationId),
		staleTime: 1000 * 30, // 30 seconds (more frequent for counts)
		gcTime: 1000 * 60 * 2, // 2 minutes
		enabled: !!applicationId,
	})
}

/**
 * Hook to fetch pending applications for recommendation (corp members)
 */
export function usePendingRecommendations() {
	return useQuery<RecommendableApplication[]>({
		queryKey: applicationKeys.recommendationsPending(),
		queryFn: () => applicationsApi.getPendingRecommendations(),
		staleTime: 1000 * 60 * 2, // 2 minutes
		gcTime: 1000 * 60 * 5, // 5 minutes
	})
}

/**
 * Hook to fetch application detail for writing a recommendation
 */
export function useApplicationForRecommender(applicationId: string) {
	return useQuery<RecommenderApplicationDetail>({
		queryKey: applicationKeys.recommendationsDetail(applicationId),
		queryFn: () => applicationsApi.getApplicationForRecommender(applicationId),
		staleTime: 1000 * 60, // 1 minute
		gcTime: 1000 * 60 * 3, // 3 minutes
		enabled: !!applicationId,
	})
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to submit a new application
 * Invalidates the applications list on success
 */
export function useSubmitApplication() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: SubmitApplicationRequest) => applicationsApi.submitApplication(data),
		onSuccess: (newApplication) => {
			// Invalidate all application lists
			queryClient.invalidateQueries({
				queryKey: applicationKeys.lists(),
			})

			// Pre-populate the cache so the detail page renders immediately, then mark
			// it stale so it refetches the authoritative response (which includes altCharacterIds)
			queryClient.setQueryData(applicationKeys.detail(newApplication.id), newApplication)
			queryClient.invalidateQueries({
				queryKey: applicationKeys.detail(newApplication.id),
			})
		},
	})
}

/**
 * Hook to update application status (for reviewers)
 * Invalidates the application detail and lists on success
 */
export function useUpdateApplicationStatus() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			applicationId,
			data,
		}: {
			applicationId: string
			data: UpdateApplicationStatusRequest
		}) => applicationsApi.updateApplicationStatus(applicationId, data),
		onSuccess: (_, variables) => {
			// Invalidate the specific application
			queryClient.invalidateQueries({
				queryKey: applicationKeys.detail(variables.applicationId),
			})

			// Invalidate all application lists
			queryClient.invalidateQueries({
				queryKey: applicationKeys.lists(),
			})

			// Invalidate activity log
			queryClient.invalidateQueries({
				queryKey: applicationKeys.activity(variables.applicationId),
			})
		},
	})
}

/**
 * Hook to withdraw an application (for applicants)
 * Invalidates the application detail and lists on success
 */
export function useWithdrawApplication() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (applicationId: string) => applicationsApi.withdrawApplication(applicationId),
		onSuccess: (_, applicationId) => {
			// Invalidate the specific application
			queryClient.invalidateQueries({
				queryKey: applicationKeys.detail(applicationId),
			})

			// Invalidate all application lists
			queryClient.invalidateQueries({
				queryKey: applicationKeys.lists(),
			})

			// Invalidate activity log
			queryClient.invalidateQueries({
				queryKey: applicationKeys.activity(applicationId),
			})
		},
	})
}

interface AddAltMutationVars {
	applicationId: string
	alts: Array<{ characterId: string; characterName?: string }>
	actorCharacterId?: string
	actorCharacterName?: string
}

interface RemoveAltMutationVars {
	applicationId: string
	altCharacterId: string
	altCharacterName?: string
	actorCharacterId?: string
	actorCharacterName?: string
}

function makeOptimisticAltEntry(
	applicationId: string,
	action: 'alt_added' | 'alt_removed',
	actorCharacterId: string,
	actorCharacterName: string | undefined,
	altCharacterId: string,
	altCharacterName: string | undefined,
	index = 0
): ApplicationActivityLogEntry {
	return {
		id: `optimistic-${Date.now()}-${index}`,
		applicationId,
		action,
		characterId: actorCharacterId,
		characterName: actorCharacterName,
		previousValue: action === 'alt_removed' ? altCharacterId : undefined,
		newValue: action === 'alt_added' ? altCharacterId : undefined,
		metadata: altCharacterName ? { altCharacterName } : undefined,
		timestamp: new Date().toISOString(),
	}
}

/**
 * Hook to add one or more alt characters to a pending application
 */
export function useAddApplicationAlt() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ applicationId, alts }: AddAltMutationVars) =>
			applicationsApi.addApplicationAlts(applicationId, alts.map((a) => a.characterId)),
		onMutate: (vars) => {
			const detailKey = applicationKeys.detail(vars.applicationId)
			const activityKey = applicationKeys.activity(vars.applicationId)

			const prevDetail = queryClient.getQueryData<Application>(detailKey)
			const prevActivity = queryClient.getQueryData<ApplicationActivityLogEntry[]>(activityKey)

			queryClient.setQueryData<Application>(detailKey, (old) =>
				old
					? { ...old, altCharacterIds: [...(old.altCharacterIds ?? []), ...vars.alts.map((a) => a.characterId)] }
					: old
			)
			queryClient.setQueryData<ApplicationActivityLogEntry[]>(activityKey, (old) => [
				...vars.alts.map((alt, i) =>
					makeOptimisticAltEntry(
						vars.applicationId, 'alt_added',
						vars.actorCharacterId ?? '', vars.actorCharacterName,
						alt.characterId, alt.characterName, i
					)
				),
				...(old ?? []),
			])

			return { prevDetail, prevActivity }
		},
		onError: (_err, vars, ctx) => {
			if (ctx?.prevDetail !== undefined) {
				queryClient.setQueryData(applicationKeys.detail(vars.applicationId), ctx.prevDetail)
			}
			if (ctx?.prevActivity !== undefined) {
				queryClient.setQueryData(applicationKeys.activity(vars.applicationId), ctx.prevActivity)
			}
		},
		onSettled: (_, __, { applicationId }) => {
			queryClient.invalidateQueries({ queryKey: applicationKeys.detail(applicationId) })
			queryClient.invalidateQueries({ queryKey: applicationKeys.lists() })
			queryClient.invalidateQueries({ queryKey: applicationKeys.activity(applicationId) })
		},
	})
}

/**
 * Hook to remove an alt character from a pending application
 */
export function useRemoveApplicationAlt() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ applicationId, altCharacterId }: RemoveAltMutationVars) =>
			applicationsApi.removeApplicationAlt(applicationId, altCharacterId),
		onMutate: (vars) => {
			const detailKey = applicationKeys.detail(vars.applicationId)
			const activityKey = applicationKeys.activity(vars.applicationId)

			const prevDetail = queryClient.getQueryData<Application>(detailKey)
			const prevActivity = queryClient.getQueryData<ApplicationActivityLogEntry[]>(activityKey)

			queryClient.setQueryData<Application>(detailKey, (old) =>
				old
					? { ...old, altCharacterIds: (old.altCharacterIds ?? []).filter((id) => id !== vars.altCharacterId) }
					: old
			)
			queryClient.setQueryData<ApplicationActivityLogEntry[]>(activityKey, (old) => [
				makeOptimisticAltEntry(
					vars.applicationId, 'alt_removed',
					vars.actorCharacterId ?? '', vars.actorCharacterName,
					vars.altCharacterId, vars.altCharacterName
				),
				...(old ?? []),
			])

			return { prevDetail, prevActivity }
		},
		onError: (_err, vars, ctx) => {
			if (ctx?.prevDetail !== undefined) {
				queryClient.setQueryData(applicationKeys.detail(vars.applicationId), ctx.prevDetail)
			}
			if (ctx?.prevActivity !== undefined) {
				queryClient.setQueryData(applicationKeys.activity(vars.applicationId), ctx.prevActivity)
			}
		},
		onSettled: (_, __, { applicationId }) => {
			queryClient.invalidateQueries({ queryKey: applicationKeys.detail(applicationId) })
			queryClient.invalidateQueries({ queryKey: applicationKeys.lists() })
			queryClient.invalidateQueries({ queryKey: applicationKeys.activity(applicationId) })
		},
	})
}

/**
 * Hook to add a recommendation to an application
 * Invalidates recommendations and application detail on success
 */
export function useAddRecommendation() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			applicationId,
			data,
		}: {
			applicationId: string
			data: AddRecommendationRequest
		}) => applicationsApi.addRecommendation(applicationId, data),
		onSuccess: (_, variables) => {
			// Invalidate recommendations for this application
			queryClient.invalidateQueries({
				queryKey: applicationKeys.recommendations(variables.applicationId),
			})

			// Invalidate the application detail (to update recommendation count)
			queryClient.invalidateQueries({
				queryKey: applicationKeys.detail(variables.applicationId),
			})

			// Invalidate activity log
			queryClient.invalidateQueries({
				queryKey: applicationKeys.activity(variables.applicationId),
			})

			// Invalidate the recommendations list page
			queryClient.invalidateQueries({
				queryKey: applicationKeys.recommendationsPending(),
			})
		},
	})
}

/**
 * Hook to update a recommendation
 * Invalidates recommendations and activity log on success
 */
export function useUpdateRecommendation() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			applicationId,
			recommendationId,
			data,
		}: {
			applicationId: string
			recommendationId: string
			data: UpdateRecommendationRequest
		}) => applicationsApi.updateRecommendation(applicationId, recommendationId, data),
		onSuccess: (_, variables) => {
			// Invalidate recommendations for this application
			queryClient.invalidateQueries({
				queryKey: applicationKeys.recommendations(variables.applicationId),
			})

			// Invalidate the application detail (to update recommendation count)
			queryClient.invalidateQueries({
				queryKey: applicationKeys.detail(variables.applicationId),
			})

			// Invalidate activity log
			queryClient.invalidateQueries({
				queryKey: applicationKeys.activity(variables.applicationId),
			})

			// Invalidate the recommendations list page
			queryClient.invalidateQueries({
				queryKey: applicationKeys.recommendationsPending(),
			})
		},
	})
}

/**
 * Hook to delete a recommendation
 * Invalidates recommendations, application detail, and activity log on success
 */
export function useDeleteRecommendation() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			applicationId,
			recommendationId,
		}: {
			applicationId: string
			recommendationId: string
		}) => applicationsApi.deleteRecommendation(applicationId, recommendationId),
		onSuccess: (_, variables) => {
			// Invalidate recommendations for this application
			queryClient.invalidateQueries({
				queryKey: applicationKeys.recommendations(variables.applicationId),
			})

			// Invalidate the application detail (to update recommendation count)
			queryClient.invalidateQueries({
				queryKey: applicationKeys.detail(variables.applicationId),
			})

			// Invalidate activity log
			queryClient.invalidateQueries({
				queryKey: applicationKeys.activity(variables.applicationId),
			})

			// Invalidate the recommendations list page
			queryClient.invalidateQueries({
				queryKey: applicationKeys.recommendationsPending(),
			})
		},
	})
}

/**
 * Hook to send a message for an application
 * Invalidates messages list and count on success
 */
export function useSendMessage() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			applicationId,
			data,
		}: {
			applicationId: string
			data: SendMessageRequest
		}) => applicationsApi.sendMessage(applicationId, data),
		onSuccess: (_, variables) => {
			// Invalidate messages list
			queryClient.invalidateQueries({
				queryKey: applicationKeys.messages(variables.applicationId),
			})

			// Invalidate message count
			queryClient.invalidateQueries({
				queryKey: applicationKeys.messageCount(variables.applicationId),
			})

			// Invalidate activity log (messages are logged)
			queryClient.invalidateQueries({
				queryKey: applicationKeys.activity(variables.applicationId),
			})

			// Invalidate detail and lists to refresh last HR activity timestamp.
			queryClient.invalidateQueries({
				queryKey: applicationKeys.detail(variables.applicationId),
			})
			queryClient.invalidateQueries({
				queryKey: applicationKeys.lists(),
			})
		},
	})
}

export function useApplicationStaffNotes(applicationId: string) {
	return useQuery<ApplicationStaffNote[]>({
		queryKey: applicationKeys.staffNotes(applicationId),
		queryFn: () => applicationsApi.getApplicationStaffNotes(applicationId),
		staleTime: 1000 * 60,
		gcTime: 1000 * 60 * 3,
		enabled: !!applicationId,
	})
}

export function useAddApplicationStaffNote() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			applicationId,
			data,
		}: {
			applicationId: string
			data: UpsertApplicationStaffNoteRequest
		}) => applicationsApi.addApplicationStaffNote(applicationId, data),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: applicationKeys.staffNotes(variables.applicationId) })
			queryClient.invalidateQueries({ queryKey: applicationKeys.detail(variables.applicationId) })
			queryClient.invalidateQueries({ queryKey: applicationKeys.activity(variables.applicationId) })
			queryClient.invalidateQueries({ queryKey: applicationKeys.lists() })
		},
	})
}

export function useUpdateApplicationStaffNote() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			applicationId,
			noteId,
			data,
		}: {
			applicationId: string
			noteId: string
			data: UpsertApplicationStaffNoteRequest
		}) => applicationsApi.updateApplicationStaffNote(applicationId, noteId, data),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: applicationKeys.staffNotes(variables.applicationId) })
			queryClient.invalidateQueries({ queryKey: applicationKeys.detail(variables.applicationId) })
			queryClient.invalidateQueries({ queryKey: applicationKeys.activity(variables.applicationId) })
			queryClient.invalidateQueries({ queryKey: applicationKeys.lists() })
		},
	})
}

export function useDeleteApplicationStaffNote() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			applicationId,
			noteId,
		}: {
			applicationId: string
			noteId: string
		}) => applicationsApi.deleteApplicationStaffNote(applicationId, noteId),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: applicationKeys.staffNotes(variables.applicationId) })
			queryClient.invalidateQueries({ queryKey: applicationKeys.detail(variables.applicationId) })
			queryClient.invalidateQueries({ queryKey: applicationKeys.activity(variables.applicationId) })
			queryClient.invalidateQueries({ queryKey: applicationKeys.lists() })
		},
	})
}

// ============================================================================
// Manager Hook for Cache Invalidation
// ============================================================================
// HR Notes Query Hooks (ADMIN ONLY)
// ============================================================================

/**
 * Hook to fetch HR notes with optional filters (ADMIN ONLY)
 * @param params - Query parameters for filtering HR notes
 */
export function useHRNotes(params?: HRNotesParams, options?: { enabled?: boolean }) {
	const filterKey = params ? JSON.stringify(params) : 'all'

	return useQuery<HRNote[]>({
		queryKey: applicationKeys.hrNotesList(filterKey),
		queryFn: () => applicationsApi.getHRNotes(params),
		staleTime: 1000 * 60, // 1 minute
		gcTime: 1000 * 60 * 5, // 5 minutes
		enabled: options?.enabled ?? true,
	})
}

/**
 * Hook to fetch a single HR note by ID (ADMIN ONLY)
 * @param noteId - The note ID to fetch
 */
export function useHRNote(noteId: string | null) {
	return useQuery<HRNote>({
		queryKey: applicationKeys.hrNoteDetail(noteId!),
		queryFn: () => applicationsApi.getHRNote(noteId!),
		staleTime: 1000 * 60, // 1 minute
		gcTime: 1000 * 60 * 3, // 3 minutes
		enabled: !!noteId,
	})
}

// ============================================================================
// HR Notes Mutation Hooks (ADMIN ONLY)
// ============================================================================

/**
 * Hook to add a new HR note (ADMIN ONLY)
 * Invalidates HR notes lists on success
 */
export function useAddHRNote() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: AddHRNoteRequest) => applicationsApi.addHRNote(data),
		onSuccess: (newNote) => {
			// Invalidate all HR notes lists
			queryClient.invalidateQueries({
				queryKey: applicationKeys.hrNotes(),
			})

			// Invalidate user-specific notes
			queryClient.invalidateQueries({
				queryKey: applicationKeys.hrNotesForUser(newNote.subjectUserId),
			})

			// Optionally pre-populate the cache with the new note
			queryClient.setQueryData(applicationKeys.hrNoteDetail(newNote.id), newNote)
		},
	})
}

/**
 * Hook to update an HR note (ADMIN ONLY)
 * Invalidates the specific note and lists on success
 */
export function useUpdateHRNote() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ noteId, data }: { noteId: string; data: UpdateHRNoteRequest }) =>
			applicationsApi.updateHRNote(noteId, data),
		onSuccess: (updatedNote) => {
			// Invalidate the specific note
			queryClient.invalidateQueries({
				queryKey: applicationKeys.hrNoteDetail(updatedNote.id),
			})

			// Invalidate all HR notes lists
			queryClient.invalidateQueries({
				queryKey: applicationKeys.hrNotes(),
			})

			// Invalidate user-specific notes
			queryClient.invalidateQueries({
				queryKey: applicationKeys.hrNotesForUser(updatedNote.subjectUserId),
			})
		},
	})
}

/**
 * Hook to delete an HR note (ADMIN ONLY)
 * Invalidates HR notes lists on success
 */
export function useDeleteHRNote() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ noteId, subjectUserId }: { noteId: string; subjectUserId: string }) =>
			applicationsApi.deleteHRNote(noteId),
		onSuccess: (_, variables) => {
			// Invalidate all HR notes lists
			queryClient.invalidateQueries({
				queryKey: applicationKeys.hrNotes(),
			})

			// Invalidate user-specific notes
			queryClient.invalidateQueries({
				queryKey: applicationKeys.hrNotesForUser(variables.subjectUserId),
			})

			// Remove from cache
			queryClient.removeQueries({
				queryKey: applicationKeys.hrNoteDetail(variables.noteId),
			})
		},
	})
}

// ============================================================================
// Message Template Query Hooks
// ============================================================================

/**
 * Hook to fetch message templates for a corporation
 * @param corporationId - The corporation ID to fetch templates for
 * @param status - Optional status filter
 */
export function useTemplates(corporationId: string, status?: MessageTemplateStatus) {
	return useQuery<MessageTemplate[]>({
		queryKey: applicationKeys.templatesList(corporationId, status),
		queryFn: () => applicationsApi.getTemplates(corporationId, status),
		staleTime: 1000 * 60 * 5, // 5 minutes (templates change less frequently)
		gcTime: 1000 * 60 * 10, // 10 minutes
		enabled: !!corporationId,
	})
}

/**
 * Hook to fetch a single template by ID
 * @param templateId - The template ID to fetch
 */
export function useTemplate(templateId: string | null) {
	return useQuery<MessageTemplate>({
		queryKey: applicationKeys.templateDetail(templateId!),
		queryFn: () => applicationsApi.getTemplate(templateId!),
		staleTime: 1000 * 60 * 5, // 5 minutes
		gcTime: 1000 * 60 * 10, // 10 minutes
		enabled: !!templateId,
	})
}

// ============================================================================
// Message Template Mutation Hooks
// ============================================================================

/**
 * Hook to create a new message template
 * Invalidates template lists on success
 */
export function useCreateTemplate() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			corporationId,
			data,
		}: {
			corporationId: string
			data: CreateTemplateRequest
		}) => applicationsApi.createTemplate(corporationId, data),
		onSuccess: (newTemplate) => {
			// Invalidate template list for this corporation
			queryClient.invalidateQueries({
				queryKey: applicationKeys.templatesList(newTemplate.ownerCorporationId),
			})

			// Pre-populate the cache with the new template
			queryClient.setQueryData(applicationKeys.templateDetail(newTemplate.id), newTemplate)
		},
	})
}

/**
 * Hook to update a message template
 * Invalidates template detail and list on success
 */
export function useUpdateTemplate() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			templateId,
			data,
		}: {
			templateId: string
			data: UpdateTemplateRequest
		}) => applicationsApi.updateTemplate(templateId, data),
		onSuccess: (updatedTemplate) => {
			// Invalidate the specific template
			queryClient.invalidateQueries({
				queryKey: applicationKeys.templateDetail(updatedTemplate.id),
			})

			// Invalidate template list for this corporation
			queryClient.invalidateQueries({
				queryKey: applicationKeys.templatesList(updatedTemplate.ownerCorporationId),
			})
		},
	})
}

/**
 * Hook to delete a message template
 * Invalidates template lists on success
 */
export function useDeleteTemplate() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			templateId,
			corporationId,
		}: {
			templateId: string
			corporationId: string
		}) => applicationsApi.deleteTemplate(templateId),
		onSuccess: (_, variables) => {
			// Invalidate template list for this corporation
			queryClient.invalidateQueries({
				queryKey: applicationKeys.templatesList(variables.corporationId),
			})

			// Remove from cache
			queryClient.removeQueries({
				queryKey: applicationKeys.templateDetail(variables.templateId),
			})
		},
	})
}

// ============================================================================
// Fulcrum (Character Reports) Hooks
// ============================================================================

/**
 * Hook to fetch all linked characters for a user with their Fulcrum reports.
 * Used in the application review Fulcrum panel to show all of a user's characters.
 */
export function useApplicationFulcrum(userId: string, corporationId: string, enabled = true) {
	return useQuery<FulcrumCharacterData[]>({
		queryKey: applicationKeys.fulcrumUserCharacters(userId, corporationId),
		queryFn: () => fulcrumApi.getUserCharactersWithReports(userId, corporationId),
		staleTime: 1000 * 30,
		gcTime: 1000 * 60 * 3,
		enabled: !!userId && !!corporationId && enabled,
		refetchInterval: (query) => {
			const data = query.state.data
			const hasInProgress = data?.some((ch) =>
				ch.reports.some((r) => r.status === 'pending' || r.status === 'processing'),
			)
			return hasInProgress ? 10_000 : false
		},
	})
}

/**
 * Hook to fetch Fulcrum reports for a specific character
 */
export function useCharacterReports(characterId: string, corporationId: string, enabled = true) {
	return useQuery<CharacterReportMetadata[]>({
		queryKey: applicationKeys.fulcrumCharacterReports(characterId, corporationId),
		queryFn: () => fulcrumApi.getCharacterReports(characterId, corporationId),
		staleTime: 1000 * 30,
		gcTime: 1000 * 60 * 3,
		enabled: !!characterId && !!corporationId && enabled,
		refetchInterval: (query) => {
			const data = query.state.data
			const hasInProgress = data?.some((r) => r.status === 'pending' || r.status === 'processing')
			return hasInProgress ? 10_000 : false
		},
	})
}

/**
 * Hook to request a new Fulcrum report for a character
 */
export function useRequestFulcrumReport() {
	const queryClient = useQueryClient()

	return useApiMutation({
		mutationFn: ({
			characterId,
			corporationId,
			requestSource,
			applicationId,
			sendDm,
			userId,
		}: {
			characterId: string
			corporationId: string
			requestSource: ReportRequestSource
			applicationId?: string
			sendDm?: boolean
			/** Pass userId to invalidate the user-characters query (application Fulcrum panel) */
			userId?: string
		}) =>
			fulcrumApi.requestReport(characterId, requestSource, applicationId, sendDm),
		errorMessage: 'You do not have permission to request a Fulcrum report for this character.',
		onMutate: ({ characterId, corporationId, userId }) => {
			if (!userId) return
			const optimisticPendingReport: CharacterReportMetadata = {
				id: `pending-local-${characterId}-${Date.now()}`,
				characterId,
				status: 'pending',
				requestorUserId: '',
				requestorCorporationId: corporationId,
				requestSource: 'hr',
				retentionDays: 7,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}

			queryClient.setQueryData<FulcrumCharacterData[]>(
				applicationKeys.fulcrumUserCharacters(userId, corporationId),
				(old) =>
					old?.map((character) =>
						character.characterId !== characterId
							? character
							: {
								...character,
								reports: character.reports.some(
									(report) => report.status === 'pending' || report.status === 'processing',
								)
									? character.reports
									: [optimisticPendingReport, ...character.reports],
							},
					),
			)

			queryClient.setQueryData<FulcrumCharacterData[]>(auditorUserKeys.fulcrum(userId), (old) =>
				old?.map((character) =>
					character.characterId !== characterId
						? character
						: {
							...character,
							reports: character.reports.some(
								(report) => report.status === 'pending' || report.status === 'processing',
							)
								? character.reports
								: [optimisticPendingReport, ...character.reports],
						},
				),
			)
		},
		onSettled: (_, __, variables) => {
			queryClient.invalidateQueries({
				queryKey: applicationKeys.fulcrumCharacterReports(
					variables.characterId,
					variables.corporationId,
				),
			})
			// Also invalidate user-characters query if userId is provided
			if (variables.userId) {
				queryClient.invalidateQueries({
					queryKey: applicationKeys.fulcrumUserCharacters(
						variables.userId,
						variables.corporationId,
					),
				})
			}
		},
	})
}

export function useRequestFulcrumReportBatch() {
	const queryClient = useQueryClient()

	return useApiMutation({
		mutationFn: ({
			characterIds,
			corporationId,
			requestSource,
			applicationId,
			sendDm,
			userId,
		}: {
			characterIds: string[]
			corporationId: string
			requestSource: ReportRequestSource
			applicationId?: string
			sendDm?: boolean
			userId?: string
		}) =>
			fulcrumApi.requestBulkReports(characterIds, requestSource, applicationId, sendDm),
		errorMessage: 'You do not have permission to request Fulcrum reports for these characters.',
		onMutate: ({ characterIds, corporationId, userId }) => {
			if (!userId || characterIds.length === 0) return
			const now = new Date().toISOString()

			const applyOptimisticPendingToCharacters = (old: FulcrumCharacterData[] | undefined) =>
				old?.map((character) => {
					if (!characterIds.includes(character.characterId)) return character
					if (
						character.reports.some(
							(report) => report.status === 'pending' || report.status === 'processing',
						)
					) {
						return character
					}
					const optimisticPendingReport: CharacterReportMetadata = {
						id: `pending-local-${character.characterId}-${Date.now()}`,
						characterId: character.characterId,
						status: 'pending',
						requestorUserId: '',
						requestorCorporationId: corporationId,
						requestSource: 'hr',
						retentionDays: 7,
						createdAt: now,
						updatedAt: now,
					}
					return {
						...character,
						reports: [optimisticPendingReport, ...character.reports],
					}
				})

			queryClient.setQueryData<FulcrumCharacterData[]>(
				applicationKeys.fulcrumUserCharacters(userId, corporationId),
				applyOptimisticPendingToCharacters,
			)
			queryClient.setQueryData<FulcrumCharacterData[]>(
				auditorUserKeys.fulcrum(userId),
				applyOptimisticPendingToCharacters,
			)
		},
		onSettled: (_, __, variables) => {
			for (const characterId of variables.characterIds) {
				queryClient.invalidateQueries({
					queryKey: applicationKeys.fulcrumCharacterReports(characterId, variables.corporationId),
				})
			}
			if (variables.userId) {
				queryClient.invalidateQueries({
					queryKey: applicationKeys.fulcrumUserCharacters(
						variables.userId,
						variables.corporationId,
					),
				})
			}
		},
	})
}

/**
 * Hook to fetch report section manifest (list of available sections)
 */
export function useReportSections(reportId: string, enabled = true) {
	return useQuery<ReportManifest>({
		queryKey: applicationKeys.fulcrumReportSections(reportId),
		queryFn: () => fulcrumApi.getReportSections(reportId),
		staleTime: 1000 * 60 * 5,
		gcTime: 1000 * 60 * 10,
		enabled: !!reportId && enabled,
		retry: 2,
	})
}

/**
 * Hook to fetch a specific report section's data (lazy-loaded per tab)
 */
export function useReportSectionData<T = unknown>(
	reportId: string,
	section: ReportSectionName,
	enabled = true,
) {
	return useQuery<T>({
		queryKey: applicationKeys.fulcrumReportSection(reportId, section),
		queryFn: () => fulcrumApi.getReportSectionData<T>(reportId, section),
		staleTime: 1000 * 60 * 5,
		gcTime: 1000 * 60 * 10,
		enabled: !!reportId && enabled,
		retry: (failureCount, error) => {
			// Don't retry on 404 (section genuinely missing)
			if (error instanceof Error && error.message.includes('404')) return false
			// Retry transient failures up to 2 times
			return failureCount < 2
		},
	})
}
