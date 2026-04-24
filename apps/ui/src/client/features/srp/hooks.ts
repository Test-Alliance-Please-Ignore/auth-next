import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'

import { NotFoundError, api } from '@/lib/api'

import { srpKeys } from './query-keys'
import {
	isSrpLossesQueryKey,
	isSrpMyRequestsQueryKey,
	patchLossesByRequestStatus,
	patchLossesForRequest,
	patchMyRequestsStatus,
	prependMyRequest,
} from './state/cache-updates'
import {
	mergeLossesWithOverlay,
	mergeRequestsWithOverlay,
	reconcileOverlayFromServerLosses,
	removeOverlayByRequestId,
	updateOverlayRequestStatus,
	upsertLossRequestOverlay,
	useLossRequestOverlaySnapshot,
} from './state/loss-request-overlay-store'

import type {
	CommentVisibility,
	RequestStatus,
	SRPConfigResponse,
	SRPRequestResponse,
	SRPPaymentMismatchAlert,
	SRPReviewSubmission,
} from './types'
import type { FittingWithItems } from '@/lib/api'
import type { LossListEntry, MyRequestsQueryData } from './state/cache-updates'

function setLossStateAcrossCaches(
	queryClient: ReturnType<typeof useQueryClient>,
	request: { killmailId: string; requestId: string; requestStatus: string }
): void {
	queryClient.setQueriesData(
		{
			predicate: (query) => isSrpLossesQueryKey(query.queryKey),
		},
		(old) => patchLossesForRequest(old as LossListEntry[] | undefined, request)
	)
}

function setRequestStatusAcrossCaches(
	queryClient: ReturnType<typeof useQueryClient>,
	request: SRPRequestResponse
): void {
	queryClient.setQueryData(srpKeys.request(request.id), request)
	queryClient.setQueriesData(
		{
			predicate: (query) => isSrpLossesQueryKey(query.queryKey),
		},
		(old) =>
			patchLossesByRequestStatus(
				old as LossListEntry[] | undefined,
				request.id,
				request.requestStatus
			)
	)
	queryClient.setQueriesData(
		{
			predicate: (query) => isSrpMyRequestsQueryKey(query.queryKey),
		},
		(old) => patchMyRequestsStatus(old as MyRequestsQueryData | undefined, request)
	)
}

function invalidateLossQueries(queryClient: ReturnType<typeof useQueryClient>) {
	void queryClient.invalidateQueries({
		predicate: (query) => isSrpLossesQueryKey(query.queryKey),
	})
}

function invalidateSrpQueueBadgeQueries(queryClient: ReturnType<typeof useQueryClient>) {
	// Queue pages use requests/by-status with arbitrary status + filter objects.
	// Remove all cached variants so navigating back always fetches fresh queue data.
	queryClient.removeQueries({
		predicate: (query) => {
			const key = query.queryKey
			return (
				Array.isArray(key) &&
				key[0] === 'srp' &&
				key[1] === 'requests' &&
				key[2] === 'by-status'
			)
		},
	})

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
	void queryClient.invalidateQueries({ queryKey: srpKeys.pending() })
	void queryClient.invalidateQueries({ queryKey: srpKeys.payments() })
	void queryClient.invalidateQueries({ queryKey: srpKeys.pendingPayoutTotal() })
}

// ===== Query Hooks =====

export function useRecentLosses(daysBack: number = 30) {
	const overlay = useLossRequestOverlaySnapshot()
	const query = useQuery({
		queryKey: srpKeys.losses(daysBack),
		queryFn: () => api.getRecentLosses(daysBack),
		staleTime: 1000 * 60 * 5,
	})
	useEffect(() => {
		if (!query.data) return
		reconcileOverlayFromServerLosses(query.data)
	}, [query.data])
	const mergedData = useMemo(() => mergeLossesWithOverlay(query.data), [query.data, overlay])
	return {
		...query,
		data: mergedData,
	}
}

export function useMyRequests(
	params: { limit?: number; offset?: number; status?: RequestStatus } = {}
) {
	const overlay = useLossRequestOverlaySnapshot()
	const query = useQuery({
		queryKey: srpKeys.myRequests(params),
		queryFn: () => api.getMyRequests(params),
		staleTime: 1000 * 60,
	})
	const mergedData = useMemo(() => {
		if (!query.data) return query.data
		return {
			...query.data,
			requests: mergeRequestsWithOverlay(query.data.requests),
		}
	}, [query.data, overlay])
	return {
		...query,
		data: mergedData,
	}
}

export function useRequest(id: string | undefined) {
	const query = useQuery({
		queryKey: srpKeys.request(id!),
		queryFn: () => api.getRequest(id!),
		enabled: !!id,
		staleTime: 1000 * 30,
	})
	useEffect(() => {
		if (!id) return
		if (!(query.error instanceof NotFoundError)) return
		removeOverlayByRequestId(id)
	}, [id, query.error])
	return query
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

export function useSrpPaymentMismatchAlerts(
	params: { includeAcknowledged?: boolean; limit?: number; offset?: number } = {},
	options?: { enabled?: boolean }
) {
	return useQuery({
		queryKey: srpKeys.paymentAlerts(params),
		queryFn: () => api.getSrpPaymentMismatchAlerts(params),
		staleTime: 1000 * 30,
		enabled: options?.enabled ?? true,
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
			invalidateLossQueries(queryClient)
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

export function useDoctrineFittingsForShip(shipTypeId: string | undefined) {
	return useQuery<FittingWithItems[]>({
		queryKey: srpKeys.doctrineFittingsByShip(shipTypeId ?? ''),
		enabled: Boolean(shipTypeId),
		staleTime: 1000 * 60 * 5,
		queryFn: async () => {
			if (!shipTypeId) return []
			const candidates = await api.getFittings({ shipTypeId })
			if (candidates.length === 0) return []
			const uniqueCandidateIds = [...new Set(candidates.map((fitting) => fitting.id))]
			const full = await Promise.all(uniqueCandidateIds.map((fittingId) => api.getFitting(fittingId)))
			const uniqueById = new Map(full.map((fitting) => [fitting.id, fitting]))
			return [...uniqueById.values()]
		},
	})
}

export function useCreateRequest() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (data: {
			characterId: string
			killmailId: string
			killmailHash: string
			contextText: string
		}) => api.createSRPRequest(data),
		onSuccess: (request: SRPRequestResponse) => {
			upsertLossRequestOverlay({
				killmailId: request.id,
				requestId: request.id,
				requestStatus: request.requestStatus,
			})
			setLossStateAcrossCaches(queryClient, {
				killmailId: request.id,
				requestId: request.id,
				requestStatus: request.requestStatus,
			})
			queryClient.setQueryData(srpKeys.request(request.id), request)
			queryClient.setQueriesData(
				{
					predicate: (query) => isSrpMyRequestsQueryKey(query.queryKey),
				},
				(old) => prependMyRequest(old as MyRequestsQueryData | undefined, request)
			)
			void queryClient.invalidateQueries({ queryKey: srpKeys.requests() })
			invalidateLossQueries(queryClient)
		},
	})
}

export function useSubmitReview() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: SRPReviewSubmission }) =>
			api.submitReview(id, data),
		onSuccess: (request: SRPRequestResponse) => {
			updateOverlayRequestStatus({
				requestId: request.id,
				requestStatus: request.requestStatus,
			})
			setRequestStatusAcrossCaches(queryClient, request)
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
		onSuccess: (request: SRPRequestResponse) => {
			updateOverlayRequestStatus({
				requestId: request.id,
				requestStatus: request.requestStatus,
			})
			setRequestStatusAcrossCaches(queryClient, request)
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
		onSuccess: (request: SRPRequestResponse) => {
			updateOverlayRequestStatus({
				requestId: request.id,
				requestStatus: request.requestStatus,
			})
			setRequestStatusAcrossCaches(queryClient, request)
			void queryClient.invalidateQueries({ queryKey: srpKeys.payments() })
			void queryClient.invalidateQueries({ queryKey: srpKeys.allRequests() })
			invalidateSrpQueueBadgeQueries(queryClient)
		},
	})
}

export function useAcknowledgeSrpPaymentMismatchAlert() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (alertId: string) => api.acknowledgeSrpPaymentMismatchAlert(alertId),
		onSuccess: (alert: SRPPaymentMismatchAlert) => {
			void queryClient.invalidateQueries({ queryKey: srpKeys.paymentAlerts() })
			void queryClient.invalidateQueries({ queryKey: srpKeys.request(alert.requestId) })
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
