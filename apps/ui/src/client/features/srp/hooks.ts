import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

import { srpKeys } from './query-keys'

import type {
	CommentVisibility,
	LossWithSRPStatus,
	PaymentStatus,
	RequestStatus,
	SRPCommentResponse,
	SRPConfigResponse,
	SRPRequestResponse,
} from './types'

// ===== Query Hooks =====

/**
 * Get recent losses for all user's characters
 */
export function useRecentLosses(daysBack: number = 30) {
	return useQuery({
		queryKey: srpKeys.losses(daysBack),
		queryFn: () => api.getRecentLosses(daysBack),
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}

/**
 * Get user's own SRP requests
 */
export function useMyRequests(
	params: { limit?: number; offset?: number; status?: RequestStatus } = {}
) {
	return useQuery({
		queryKey: srpKeys.myRequests(params),
		queryFn: () => api.getMyRequests(params),
		staleTime: 1000 * 60, // 1 minute
	})
}

/**
 * Get single SRP request by ID
 */
export function useRequest(id: string | undefined) {
	return useQuery({
		queryKey: srpKeys.request(id!),
		queryFn: () => api.getRequest(id!),
		enabled: !!id,
		staleTime: 1000 * 30, // 30 seconds
	})
}

/**
 * Get pending requests for review (requires reviewer permission)
 */
export function usePendingRequests(
	params: { corporationId?: string; limit?: number; offset?: number } = {}
) {
	return useQuery({
		queryKey: srpKeys.pendingRequests(params),
		queryFn: () => api.getPendingRequests(params),
		staleTime: 1000 * 30, // 30 seconds
	})
}

/**
 * Get pending payments (requires payer permission)
 */
export function usePendingPayments(
	params: { corporationId?: string; limit?: number; offset?: number } = {}
) {
	return useQuery({
		queryKey: srpKeys.pendingPayments(params),
		queryFn: () => api.getPendingPayments(params),
		staleTime: 1000 * 30, // 30 seconds
	})
}

/**
 * Get comments for a request
 */
export function useRequestComments(
	requestId: string | undefined,
	includeInternal: boolean = false
) {
	return useQuery({
		queryKey: srpKeys.comments(requestId!, includeInternal),
		queryFn: () => api.getRequestComments(requestId!, includeInternal),
		enabled: !!requestId,
		staleTime: 1000 * 30,
	})
}

/**
 * Get active SRP configuration
 */
export function useSRPConfig() {
	return useQuery({
		queryKey: srpKeys.config(),
		queryFn: () => api.getSRPConfig(),
		staleTime: 1000 * 60 * 10, // 10 minutes
	})
}

/**
 * Get SRP statistics (admin only)
 */
export function useSRPStats(params?: {
	startDate?: string
	endDate?: string
	corporationId?: string
}) {
	return useQuery({
		queryKey: srpKeys.stats(params),
		queryFn: () => api.getSRPStats(params),
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}

// ===== Mutation Hooks =====

/**
 * Create a new SRP request
 */
export function useCreateRequest() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: {
			characterId: string
			killmailId: string
			killmailHash: string
			requestedAmount?: string
		}) => api.createSRPRequest(data),
		onSuccess: () => {
			// Invalidate relevant queries
			queryClient.invalidateQueries({ queryKey: srpKeys.requests() })
			queryClient.invalidateQueries({ queryKey: srpKeys.losses() })
		},
	})
}

/**
 * Approve an SRP request
 */
export function useApproveRequest() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			id,
			data,
		}: {
			id: string
			data: { approvedAmount: string; reviewNotes?: string }
		}) => api.approveRequest(id, data),
		onSuccess: (
			_data: any,
			variables: { id: string; data: { approvedAmount: string; reviewNotes?: string } }
		) => {
			// Invalidate relevant queries
			queryClient.invalidateQueries({ queryKey: srpKeys.request(variables.id) })
			queryClient.invalidateQueries({ queryKey: srpKeys.pending() })
			queryClient.invalidateQueries({ queryKey: srpKeys.payments() })
		},
	})
}

/**
 * Partially approve an SRP request
 */
export function usePartiallyApproveRequest() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			id,
			data,
		}: {
			id: string
			data: { approvedAmount: string; rejectionReason: string; reviewNotes?: string }
		}) => api.partiallyApproveRequest(id, data),
		onSuccess: (
			_data: any,
			variables: {
				id: string
				data: { approvedAmount: string; rejectionReason: string; reviewNotes?: string }
			}
		) => {
			queryClient.invalidateQueries({ queryKey: srpKeys.request(variables.id) })
			queryClient.invalidateQueries({ queryKey: srpKeys.pending() })
			queryClient.invalidateQueries({ queryKey: srpKeys.payments() })
		},
	})
}

/**
 * Reject an SRP request
 */
export function useRejectRequest() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			id,
			data,
		}: {
			id: string
			data: { rejectionReason: string; reviewNotes?: string }
		}) => api.rejectRequest(id, data),
		onSuccess: (
			_data: any,
			variables: { id: string; data: { rejectionReason: string; reviewNotes?: string } }
		) => {
			queryClient.invalidateQueries({ queryKey: srpKeys.request(variables.id) })
			queryClient.invalidateQueries({ queryKey: srpKeys.pending() })
		},
	})
}

/**
 * Add a comment to a request
 */
export function useAddComment() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			requestId,
			data,
		}: {
			requestId: string
			data: { content: string; visibility: CommentVisibility }
		}) => api.addComment(requestId, data),
		onSuccess: (
			_data: any,
			variables: { requestId: string; data: { content: string; visibility: CommentVisibility } }
		) => {
			// Invalidate both public and internal comments
			queryClient.invalidateQueries({ queryKey: srpKeys.comments(variables.requestId, false) })
			queryClient.invalidateQueries({ queryKey: srpKeys.comments(variables.requestId, true) })
		},
	})
}

/**
 * Update a comment
 */
export function useUpdateComment() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, content }: { id: string; content: string }) =>
			api.updateComment(id, content),
		onSuccess: () => {
			// Invalidate all comment queries
			queryClient.invalidateQueries({ queryKey: srpKeys.all })
		},
	})
}

/**
 * Delete a comment
 */
export function useDeleteComment() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => api.deleteComment(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: srpKeys.all })
		},
	})
}

/**
 * Mark request as fully paid
 */
export function useMarkPaid() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			id,
			data,
		}: {
			id: string
			data: { paidAmount: string; paymentToken: string }
		}) => api.markPaid(id, data),
		onSuccess: (
			_data: any,
			variables: { id: string; data: { paidAmount: string; paymentToken: string } }
		) => {
			queryClient.invalidateQueries({ queryKey: srpKeys.request(variables.id) })
			queryClient.invalidateQueries({ queryKey: srpKeys.payments() })
		},
	})
}

/**
 * Mark request as partially paid
 */
export function useMarkPartiallyPaid() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			id,
			data,
		}: {
			id: string
			data: { paidAmount: string; paymentToken: string; notes?: string }
		}) => api.markPartiallyPaid(id, data),
		onSuccess: (
			_data: any,
			variables: { id: string; data: { paidAmount: string; paymentToken: string; notes?: string } }
		) => {
			queryClient.invalidateQueries({ queryKey: srpKeys.request(variables.id) })
			queryClient.invalidateQueries({ queryKey: srpKeys.payments() })
		},
	})
}

/**
 * Update SRP configuration (admin only)
 */
export function useUpdateSRPConfig() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: Partial<SRPConfigResponse>) => api.updateSRPConfig(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: srpKeys.config() })
		},
	})
}
