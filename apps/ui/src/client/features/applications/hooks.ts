/**
 * Applications Feature Hooks
 *
 * React Query hooks for managing application data fetching, mutations, and caching.
 * Follows TanStack Query v5 patterns with gcTime instead of cacheTime.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { applicationsApi, fulcrumApi } from './api'

import type {
	AddHRNoteRequest,
	AddRecommendationRequest,
	Application,
	ApplicationActivityLogEntry,
	ApplicationMessage,
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
	ReportSectionName,
	SendMessageRequest,
	SubmitApplicationRequest,
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
	fulcrum: (applicationId: string) => [...applicationKeys.detail(applicationId), 'fulcrum'] as const,
	fulcrumReportSections: (reportId: string) =>
		[...applicationKeys.all, 'fulcrum-report', reportId, 'sections'] as const,
	fulcrumReportSection: (reportId: string, section: ReportSectionName) =>
		[...applicationKeys.all, 'fulcrum-report', reportId, 'section', section] as const,
	// Recommendations discovery (corp members)
	recommendationsPending: () => [...applicationKeys.all, 'recommendations-pending'] as const,
	recommendationsDetail: (id: string) =>
		[...applicationKeys.all, 'recommendations-detail', id] as const,
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

			// Optionally pre-populate the cache with the new application
			queryClient.setQueryData(applicationKeys.detail(newApplication.id), newApplication)
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
export function useHRNotes(params?: HRNotesParams) {
	const filterKey = params ? JSON.stringify(params) : 'all'

	return useQuery<HRNote[]>({
		queryKey: applicationKeys.hrNotesList(filterKey),
		queryFn: () => applicationsApi.getHRNotes(params),
		staleTime: 1000 * 60, // 1 minute
		gcTime: 1000 * 60 * 5, // 5 minutes
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
 * Hook to fetch applicant's characters with their Fulcrum report status
 */
export function useApplicationFulcrum(applicationId: string, enabled = true) {
	return useQuery<FulcrumCharacterData[]>({
		queryKey: applicationKeys.fulcrum(applicationId),
		queryFn: () => fulcrumApi.getApplicationFulcrumData(applicationId),
		staleTime: 1000 * 30,
		gcTime: 1000 * 60 * 3,
		enabled: !!applicationId && enabled,
		refetchInterval: (query) => {
			// Poll every 10 seconds while any report is in progress
			const data = query.state.data
			const hasInProgress = data?.some((ch) =>
				ch.reports.some((r) => r.status === 'pending' || r.status === 'processing'),
			)
			return hasInProgress ? 10_000 : false
		},
	})
}

/**
 * Hook to request a new Fulcrum report for a character
 */
export function useRequestFulcrumReport() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			applicationId,
			characterId,
		}: {
			applicationId: string
			characterId: string
		}) => fulcrumApi.requestReport(applicationId, characterId),
		onMutate: async (variables) => {
			const queryKey = applicationKeys.fulcrum(variables.applicationId)
			await queryClient.cancelQueries({ queryKey })

			const previous = queryClient.getQueryData<FulcrumCharacterData[]>(queryKey)

			if (previous) {
				queryClient.setQueryData(queryKey, previous.map((c) =>
					c.characterId === variables.characterId
						? {
							...c,
							reports: [
								...c.reports,
								{
									id: 'optimistic-' + Date.now(),
									characterId: variables.characterId,
									status: 'pending',
									requestorUserId: '',
									requestorCorporationId: '',
									createdAt: new Date().toISOString(),
									updatedAt: new Date().toISOString(),
								} satisfies CharacterReportMetadata,
							],
						}
						: c,
				))
			}

			return { previous }
		},
		onError: (_err, variables, context) => {
			if (context?.previous) {
				queryClient.setQueryData(
					applicationKeys.fulcrum(variables.applicationId),
					context.previous,
				)
			}
		},
		onSettled: (_, __, variables) => {
			queryClient.invalidateQueries({
				queryKey: applicationKeys.fulcrum(variables.applicationId),
			})
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
