import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

import { srpKeys } from './query-keys'

import type {
	CommentVisibility,
	RequestStatus,
	SRPConfigResponse,
	SRPReviewSubmission,
} from './types'

function invalidateSrpQueueBadgeQueries(queryClient: ReturnType<typeof useQueryClient>) {
	void queryClient.invalidateQueries({
		predicate: (query) => {
			const key = query.queryKey
			return (
				Array.isArray(key) &&
				key[0] === 'srp' &&
				key[1] === 'requests' &&
				key[2] === 'by-status' &&
				(key[3] === 'pending' || key[3] === 'approved')
			)
		},
	})
	void queryClient.invalidateQueries({ queryKey: srpKeys.pendingPayoutTotal() })
}

// ===== Query Hooks =====

export function useRecentLosses(daysBack: number = 30) {
	return useQuery({
		queryKey: srpKeys.losses(daysBack),
		queryFn: () => api.getRecentLosses(daysBack),
		staleTime: 1000 * 60 * 5,
	})
}

export function useMyRequests(
	params: { limit?: number; offset?: number; status?: RequestStatus } = {}
) {
	return useQuery({
		queryKey: srpKeys.myRequests(params),
		queryFn: () => api.getMyRequests(params),
		staleTime: 1000 * 60,
	})
}

export function useRequest(id: string | undefined) {
	return useQuery({
		queryKey: srpKeys.request(id!),
		queryFn: () => api.getRequest(id!),
		enabled: !!id,
		staleTime: 1000 * 30,
	})
}

export function usePendingRequests(
	params: { corporationId?: string; limit?: number; offset?: number } = {}
) {
	return useQuery({
		queryKey: srpKeys.pendingRequests(params),
		queryFn: () => api.getPendingRequests(params),
		staleTime: 1000 * 30,
	})
}

export function useRequestsByStatus(
	status: RequestStatus,
	params: {
		limit?: number
		offset?: number
		characterName?: string
		shipTypeName?: string
		solarSystemName?: string
		dateFrom?: string
		dateTo?: string
	} = {},
	options?: {
		enabled?: boolean
	}
) {
	return useQuery({
		queryKey: srpKeys.requestsByStatus(status, params),
		queryFn: () => api.getRequestsByStatus({ status, ...params }),
		staleTime: 1000 * 30,
		enabled: options?.enabled ?? true,
	})
}

export function usePendingPayments(
	params: { corporationId?: string; limit?: number; offset?: number } = {}
) {
	return useQuery({
		queryKey: srpKeys.pendingPayments(params),
		queryFn: () => api.getPendingPayments(params),
		staleTime: 1000 * 30,
	})
}

export function usePendingPayoutTotal(params: { corporationId?: string } = {}) {
	return useQuery({
		queryKey: srpKeys.pendingPayoutTotal(params),
		queryFn: () => api.getPendingPayoutTotal(params),
		staleTime: 1000 * 30,
	})
}

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

export function useSRPConfig() {
	return useQuery({
		queryKey: srpKeys.config(),
		queryFn: () => api.getSRPConfig(),
		staleTime: 1000 * 60 * 10,
	})
}

export function useSRPPolicies() {
	return useQuery({
		queryKey: srpKeys.policies(),
		queryFn: () => api.getSRPPolicies(),
		staleTime: 1000 * 60 * 5,
	})
}

export function useSRPStats(params?: {
	startDate?: string
	endDate?: string
	corporationId?: string
}) {
	return useQuery({
		queryKey: srpKeys.stats(params),
		queryFn: () => api.getSRPStats(params),
		staleTime: 1000 * 60 * 5,
	})
}

// ===== Mutation Hooks =====

export function useRefreshKillmails() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: () => api.refreshLosses(),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: srpKeys.losses() })
		},
	})
}

export function useKillmailPreview(
	killmailId: string | null,
	killmailHash: string | null,
	characterId: string | null
) {
	return useQuery({
		queryKey: ['srp', 'killmail-preview', killmailId, killmailHash, characterId],
		queryFn: () => api.getKillmailPreview(killmailId!, killmailHash!, characterId!),
		enabled: !!killmailId && !!killmailHash && !!characterId,
		staleTime: 1000 * 60 * 10,
	})
}

export function useCreateRequest() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (data: {
			characterId: string
			killmailId: string
			killmailHash: string
			contextText?: string
		}) => api.createSRPRequest(data),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: srpKeys.requests() })
			void queryClient.invalidateQueries({ queryKey: srpKeys.losses() })
		},
	})
}

export function useSubmitReview() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: SRPReviewSubmission }) =>
			api.submitReview(id, data),
		onSuccess: (_data: any, variables: { id: string; data: SRPReviewSubmission }) => {
			void queryClient.invalidateQueries({ queryKey: srpKeys.request(variables.id) })
			void queryClient.invalidateQueries({ queryKey: srpKeys.allRequests() })
			void queryClient.invalidateQueries({ queryKey: srpKeys.payments() })
			invalidateSrpQueueBadgeQueries(queryClient)
		},
	})
}

export function useUpdateReviewState() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({
			id,
			newState,
			notes,
		}: {
			id: string
			newState: RequestStatus
			notes?: string
		}) => api.updateReviewState(id, { newState, notes }),
		onSuccess: (_data: any, variables: { id: string; newState: RequestStatus; notes?: string }) => {
			void queryClient.invalidateQueries({ queryKey: srpKeys.request(variables.id) })
			void queryClient.invalidateQueries({ queryKey: srpKeys.allRequests() })
			void queryClient.invalidateQueries({ queryKey: srpKeys.payments() })
			invalidateSrpQueueBadgeQueries(queryClient)
		},
	})
}

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
			void queryClient.invalidateQueries({ queryKey: srpKeys.request(variables.id) })
			void queryClient.invalidateQueries({ queryKey: srpKeys.pending() })
			void queryClient.invalidateQueries({ queryKey: srpKeys.payments() })
			invalidateSrpQueueBadgeQueries(queryClient)
		},
	})
}

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
			void queryClient.invalidateQueries({ queryKey: srpKeys.request(variables.id) })
			void queryClient.invalidateQueries({ queryKey: srpKeys.pending() })
			invalidateSrpQueueBadgeQueries(queryClient)
		},
	})
}

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
			void queryClient.invalidateQueries({ queryKey: srpKeys.comments(variables.requestId, false) })
			void queryClient.invalidateQueries({ queryKey: srpKeys.comments(variables.requestId, true) })
		},
	})
}

export function useUpdateComment() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id, content }: { id: string; content: string }) =>
			api.updateComment(id, content),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: srpKeys.all })
		},
	})
}

export function useDeleteComment() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (id: string) => api.deleteComment(id),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: srpKeys.all })
		},
	})
}

export function useMarkPaid() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (id: string) => api.markPaid(id),
		onSuccess: (_data: any, id: string) => {
			void queryClient.invalidateQueries({ queryKey: srpKeys.request(id) })
			void queryClient.invalidateQueries({ queryKey: srpKeys.payments() })
			void queryClient.invalidateQueries({ queryKey: srpKeys.allRequests() })
			invalidateSrpQueueBadgeQueries(queryClient)
		},
	})
}

export function useUpdateSRPConfig() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (data: Partial<SRPConfigResponse>) => api.updateSRPConfig(data),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: srpKeys.config() })
		},
	})
}

export function useCreatePolicy() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (data: any) => api.createSRPPolicy(data),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: srpKeys.policies() })
		},
	})
}

export function useUpdatePolicy() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: any }) => api.updateSRPPolicy(id, data),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: srpKeys.policies() })
		},
	})
}

export function useDeletePolicy() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (id: string) => api.deleteSRPPolicy(id),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: srpKeys.policies() })
		},
	})
}
