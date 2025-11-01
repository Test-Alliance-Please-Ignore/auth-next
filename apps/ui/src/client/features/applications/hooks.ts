/**
 * Applications Feature Hooks
 *
 * React Query hooks for managing application data fetching, mutations, and caching.
 * Follows TanStack Query v5 patterns with gcTime instead of cacheTime.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { applicationsApi } from './api'

import type {
	AddHRNoteRequest,
	AddRecommendationRequest,
	Application,
	ApplicationActivityLogEntry,
	ApplicationsParams,
	HRNote,
	HRNotesParams,
	Recommendation,
	SubmitApplicationRequest,
	UpdateApplicationStatusRequest,
	UpdateHRNoteRequest,
	UpdateRecommendationRequest,
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
	hrNotes: () => [...applicationKeys.all, 'hr-notes'] as const,
	hrNotesList: (filters: string) => [...applicationKeys.hrNotes(), filters] as const,
	hrNoteDetail: (noteId: string) => [...applicationKeys.hrNotes(), noteId] as const,
	hrNotesForUser: (userId: string) => [...applicationKeys.hrNotes(), 'user', userId] as const,
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

			// Invalidate activity log
			queryClient.invalidateQueries({
				queryKey: applicationKeys.activity(variables.applicationId),
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
		},
	})
}

// ============================================================================
// Manager Hook for Cache Invalidation
// ============================================================================

/**
 * Hook to manage application data with cache invalidation utilities
 * Provides methods for invalidating specific parts of the cache
 */
export function useApplicationManager() {
	const queryClient = useQueryClient()

	const invalidateApplications = useCallback(() => {
		return queryClient.invalidateQueries({
			queryKey: applicationKeys.lists(),
		})
	}, [queryClient])

	const invalidateApplication = useCallback(
		(applicationId: string) => {
			return queryClient.invalidateQueries({
				queryKey: applicationKeys.detail(applicationId),
			})
		},
		[queryClient]
	)

	const invalidateRecommendations = useCallback(
		(applicationId: string) => {
			return queryClient.invalidateQueries({
				queryKey: applicationKeys.recommendations(applicationId),
			})
		},
		[queryClient]
	)

	const invalidateActivity = useCallback(
		(applicationId: string) => {
			return queryClient.invalidateQueries({
				queryKey: applicationKeys.activity(applicationId),
			})
		},
		[queryClient]
	)

	const invalidateAll = useCallback(() => {
		return queryClient.invalidateQueries({
			queryKey: applicationKeys.all,
		})
	}, [queryClient])

	const prefetchApplication = useCallback(
		(applicationId: string) => {
			return queryClient.prefetchQuery({
				queryKey: applicationKeys.detail(applicationId),
				queryFn: () => applicationsApi.getApplication(applicationId),
				staleTime: 1000 * 60, // 1 minute
			})
		},
		[queryClient]
	)

	return {
		invalidateApplications,
		invalidateApplication,
		invalidateRecommendations,
		invalidateActivity,
		invalidateAll,
		prefetchApplication,
	}
}

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
		mutationFn: ({
			noteId,
			subjectUserId,
		}: {
			noteId: string
			subjectUserId: string
		}) => applicationsApi.deleteHRNote(noteId),
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
