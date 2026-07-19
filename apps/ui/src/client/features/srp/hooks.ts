import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'

import { NotFoundError, api } from '@/lib/api'

import { srpKeys } from './query-keys'
import {
	isSrpLossesQueryKey,
	isSrpMyRequestsQueryKey,
	patchLossesByRequestStatus,
	patchLossesForRequest,
	patchMyRequestsStatus,
	prependMyRequest,
	removeLossByKillmailId,
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
import {
	restoreReviewQueueStateFromRollback,
	snapshotReviewQueueStateForRollback,
	transitionRequestStatusAcrossReviewQueueSnapshots,
	upsertRequestAcrossReviewQueueSnapshots,
} from './state/review-queue-snapshot-store'

import type {
	CommentVisibility,
	RequestListResponse,
	RequestStatus,
	RecentLossesResponse,
	SRPCommentResponse,
	SRPConfigResponse,
	SRPRequestResponse,
	SRPPaymentMismatchAlert,
	SRPReviewSubmission,
} from './types'
import type { FittingWithItems } from '@/lib/api'
import type { LossListEntry, MyRequestsQueryData, RecentLossesQueryData } from './state/cache-updates'

function setLossStateAcrossCaches(
	queryClient: ReturnType<typeof useQueryClient>,
	request: { killmailId: string; requestId: string; requestStatus: string }
): void {
	queryClient.setQueriesData(
		{
			predicate: (query) => isSrpLossesQueryKey(query.queryKey),
		},
		(old) =>
			patchLossesForRequest(
				old as LossListEntry[] | RecentLossesQueryData | undefined,
				request
			)
	)
}

function setRequestStatusAcrossCaches(
	queryClient: ReturnType<typeof useQueryClient>,
	request: SRPRequestResponse
): void {
	queryClient.setQueryData(srpKeys.request(request.id), (existing: SRPRequestResponse | undefined) =>
		existing ? { ...existing, ...request } : request
	)
	queryClient.setQueriesData(
		{
			predicate: (query) => isSrpLossesQueryKey(query.queryKey),
		},
		(old) =>
			patchLossesByRequestStatus(
				old as LossListEntry[] | RecentLossesQueryData | undefined,
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

function refreshQueuePagesHard(queryClient: ReturnType<typeof useQueryClient>) {
	// Queue pages now use both the legacy shared by-status queries and the
	// dedicated review queue query family.
	queryClient.removeQueries({
		predicate: (query) => {
			const key = query.queryKey
			return (
				Array.isArray(key) &&
				key[0] === 'srp' &&
				key[1] === 'requests' &&
				(key[2] === 'by-status' || key[2] === 'review-by-status')
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
				(key[2] === 'by-status' || key[2] === 'review-by-status') &&
				(key[3] === 'pending' || key[3] === 'approved' || key[3] === 'paid')
			)
		},
	})
	void queryClient.invalidateQueries({ queryKey: srpKeys.pending() })
	void queryClient.invalidateQueries({ queryKey: srpKeys.payments() })
	void queryClient.invalidateQueries({ queryKey: srpKeys.pendingPayoutTotal() })
}

function refreshQueueBadgesSoft(
	queryClient: ReturnType<typeof useQueryClient>,
	statuses: RequestStatus[]
) {
	void queryClient.invalidateQueries({
		predicate: (query) => {
			const key = query.queryKey
			return (
				Array.isArray(key) &&
				key[0] === 'srp' &&
				key[1] === 'requests' &&
				(key[2] === 'by-status' || key[2] === 'review-by-status') &&
				typeof key[3] === 'string' &&
				statuses.includes(key[3] as RequestStatus)
			)
		},
	})
}

function adjustPendingPayoutTotalCaches(
	queryClient: ReturnType<typeof useQueryClient>,
	delta: number
) {
	queryClient.setQueriesData(
		{
			predicate: (query) => {
				const key = query.queryKey
				return (
					Array.isArray(key) &&
					key[0] === 'srp' &&
					key[1] === 'payments' &&
					key[2] === 'pending-total'
				)
			},
		},
		(old) => {
			const current = old as { pendingPayoutTotal?: string } | undefined
			if (!current || typeof current.pendingPayoutTotal !== 'string') return old
			const currentNum = Number.parseFloat(current.pendingPayoutTotal)
			if (!Number.isFinite(currentNum)) return old
			const next = Math.max(0, currentNum + delta)
			return { ...current, pendingPayoutTotal: String(next) }
		}
	)
}

// ===== Query Hooks =====

export function useRecentLosses(
	params: { limit?: number; offset?: number } = {},
	options: { enabled?: boolean } = {}
) {
	const overlay = useLossRequestOverlaySnapshot()
	const query = useQuery<RecentLossesResponse>({
		queryKey: srpKeys.losses(params),
		queryFn: () => api.getRecentLosses(params),
		staleTime: 1000 * 60 * 5,
		enabled: options.enabled ?? true,
	})
	useEffect(() => {
		if (!query.data?.losses) return
		reconcileOverlayFromServerLosses(query.data.losses)
	}, [query.data])
	const mergedData = useMemo(() => {
		if (!query.data) return query.data
		return {
			...query.data,
			losses: mergeLossesWithOverlay(query.data.losses ?? []),
		}
	}, [query.data, overlay])
	return {
		...query,
		data: mergedData,
		failedCharacters: query.data?.failedCharacters ?? [],
	}
}

export function useRecentLossRefreshStatus() {
	const queryClient = useQueryClient()
	const handledCompletionWorkflowIdRef = useRef<string | null>(null)
	const query = useQuery({
		queryKey: srpKeys.lossRefreshStatus(),
		queryFn: () => api.getRecentLossRefreshStatus(),
		staleTime: 0,
		refetchInterval: (query) => {
			const data = query.state.data
			return data?.status?.status === 'queued' || data?.status?.status === 'running' ? 5000 : false
		},
		refetchOnWindowFocus: false,
	})

	useEffect(() => {
		if (!query.data?.status) return
		if (query.data.status.status !== 'completed' && query.data.status.status !== 'failed') return
		if (handledCompletionWorkflowIdRef.current === query.data.status.workflowInstanceId) return
		handledCompletionWorkflowIdRef.current = query.data.status.workflowInstanceId
		invalidateLossQueries(queryClient)
	}, [query.data, queryClient])

	return query
}

export function useMyRequests(
	params: { limit?: number; offset?: number; status?: RequestStatus } = {},
	options: { enabled?: boolean } = {}
) {
	const overlay = useLossRequestOverlaySnapshot()
	const query = useQuery<RequestListResponse>({
		queryKey: srpKeys.myRequests(params),
		queryFn: () => api.getMyRequests(params),
		staleTime: 1000 * 60,
		enabled: options.enabled ?? true,
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

export function usePendingPayments(
	params: { corporationId?: string; limit?: number; offset?: number } = {},
	options?: {
		enabled?: boolean
		refetchOnWindowFocus?: boolean
		refetchOnReconnect?: boolean
	}
) {
	return useQuery({
		queryKey: srpKeys.pendingPayments(params),
		queryFn: () => api.getPendingPayments(params),
		staleTime: 1000 * 30,
		enabled: options?.enabled ?? true,
		refetchOnWindowFocus: options?.refetchOnWindowFocus,
		refetchOnReconnect: options?.refetchOnReconnect,
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
			void queryClient.invalidateQueries({ queryKey: srpKeys.lossRefreshStatus() })
		},
	})
}

export function useRefreshSrpRecentLossesForAllKnownUsers() {
	return useMutation({
		mutationFn: () => api.refreshSrpRecentLossesForAllKnownUsers(),
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
			try {
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
			} catch (error) {
				console.error('[SRP] Failed to sync create-request caches after successful submit', {
					requestId: request.id,
					characterId: request.characterId,
					killmailId: request.id,
					requestStatus: request.requestStatus,
					error,
				})
			}
		},
	})
}

export function useDismissRecentLoss() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ killmailId }: { killmailId: string }) => api.dismissRecentLoss(killmailId),
		onMutate: async ({ killmailId }) => {
			const previousLosses = queryClient.getQueriesData({
				predicate: (query) => isSrpLossesQueryKey(query.queryKey),
			})
			queryClient.setQueriesData(
				{
					predicate: (query) => isSrpLossesQueryKey(query.queryKey),
				},
				(old) =>
					removeLossByKillmailId(
						old as LossListEntry[] | RecentLossesQueryData | undefined,
						killmailId
					)
			)
			return { previousLosses }
		},
		onError: (_error, _variables, context) => {
			for (const [queryKey, previous] of context?.previousLosses ?? []) {
				queryClient.setQueryData(queryKey, previous)
			}
		},
		onSuccess: () => {
			invalidateLossQueries(queryClient)
		},
	})
}

export function useSubmitReview() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: SRPReviewSubmission }) =>
			api.submitReview(id, data),
		onMutate: async ({ id, data }) => {
			const previous = snapshotReviewQueueStateForRollback()
			const optimisticStatus: RequestStatus =
				data.outcome === 'approved'
					? 'approved'
					: data.outcome === 'needs_context'
						? 'needs_context'
						: 'rejected'
			transitionRequestStatusAcrossReviewQueueSnapshots(id, optimisticStatus)
			const existing = queryClient.getQueryData<SRPRequestResponse>(srpKeys.request(id))
			if (existing) {
				upsertRequestAcrossReviewQueueSnapshots({
					...existing,
					requestStatus: optimisticStatus,
				})
			}
			return { previous }
		},
		onError: (_error, _variables, context) => {
			if (context?.previous) {
				restoreReviewQueueStateFromRollback(context.previous)
			}
		},
		onSuccess: (request: SRPRequestResponse) => {
			updateOverlayRequestStatus({
				requestId: request.id,
				requestStatus: request.requestStatus,
			})
			upsertRequestAcrossReviewQueueSnapshots(request)
			setRequestStatusAcrossCaches(queryClient, request)
			void queryClient.invalidateQueries({ queryKey: srpKeys.allRequests() })
			void queryClient.invalidateQueries({ queryKey: srpKeys.payments() })
			refreshQueuePagesHard(queryClient)
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
		onMutate: async ({ id, newState }) => {
			const previous = snapshotReviewQueueStateForRollback()
			transitionRequestStatusAcrossReviewQueueSnapshots(id, newState)
			const existing = queryClient.getQueryData<SRPRequestResponse>(srpKeys.request(id))
			if (existing) {
				upsertRequestAcrossReviewQueueSnapshots({
					...existing,
					requestStatus: newState,
				})
			}
			return { previous }
		},
		onError: (_error, _variables, context) => {
			if (context?.previous) {
				restoreReviewQueueStateFromRollback(context.previous)
			}
		},
		onSuccess: (request: SRPRequestResponse) => {
			updateOverlayRequestStatus({
				requestId: request.id,
				requestStatus: request.requestStatus,
			})
			upsertRequestAcrossReviewQueueSnapshots(request)
			setRequestStatusAcrossCaches(queryClient, request)
			void queryClient.invalidateQueries({ queryKey: srpKeys.allRequests() })
			void queryClient.invalidateQueries({ queryKey: srpKeys.payments() })
			refreshQueuePagesHard(queryClient)
		},
	})
}

export function useWithdrawRequest() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
			api.withdrawSRPRequest(id, notes ? { notes } : undefined),
		onSuccess: (request: SRPRequestResponse) => {
			updateOverlayRequestStatus({
				requestId: request.id,
				requestStatus: request.requestStatus,
			})
			setRequestStatusAcrossCaches(queryClient, request)
			void queryClient.invalidateQueries({ queryKey: srpKeys.requests() })
			invalidateLossQueries(queryClient)
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
			refreshQueuePagesHard(queryClient)
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
			refreshQueuePagesHard(queryClient)
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
		onMutate: async ({
			requestId,
			data,
		}: {
			requestId: string
			data: { content: string; visibility: CommentVisibility }
		}) => {
			const previousPublic = queryClient.getQueryData<SRPCommentResponse[]>(
				srpKeys.comments(requestId, false)
			)
			const previousInternal = queryClient.getQueryData<SRPCommentResponse[]>(
				srpKeys.comments(requestId, true)
			)
			const nowIso = new Date().toISOString()
			const tempId = `temp-${crypto.randomUUID()}`
			const optimisticComment: SRPCommentResponse = {
				id: tempId,
				requestId,
				authorUserId: 'me',
				authorCharacterName: 'You',
				content: data.content,
				visibility: data.visibility,
				isEdited: false,
				createdAt: nowIso,
			}

			queryClient.setQueryData<SRPCommentResponse[]>(srpKeys.comments(requestId, true), (old = []) => [
				...old,
				optimisticComment,
			])
			if (data.visibility === 'public') {
				queryClient.setQueryData<SRPCommentResponse[]>(srpKeys.comments(requestId, false), (old = []) => [
					...old,
					optimisticComment,
				])
			}

			return { previousPublic, previousInternal, requestId, tempId }
		},
		onError: (_error, _variables, context) => {
			if (!context) return
			queryClient.setQueryData(srpKeys.comments(context.requestId, false), context.previousPublic)
			queryClient.setQueryData(srpKeys.comments(context.requestId, true), context.previousInternal)
		},
		onSuccess: (
			comment: SRPCommentResponse,
			variables: { requestId: string; data: { content: string; visibility: CommentVisibility } },
			context: { previousPublic?: SRPCommentResponse[]; previousInternal?: SRPCommentResponse[]; requestId: string; tempId: string } | undefined
		) => {
			if (context) {
				queryClient.setQueryData<SRPCommentResponse[]>(srpKeys.comments(variables.requestId, true), (old = []) =>
					old.map((row) => (row.id === context.tempId ? comment : row))
				)
				if (variables.data.visibility === 'public') {
					queryClient.setQueryData<SRPCommentResponse[]>(
						srpKeys.comments(variables.requestId, false),
						(old = []) => old.map((row) => (row.id === context.tempId ? comment : row))
					)
				}
			}
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
		onMutate: async (id: string) => {
			const previous = snapshotReviewQueueStateForRollback()
			const previousPendingTotals = queryClient.getQueriesData({
				predicate: (query) => {
					const key = query.queryKey
					return (
						Array.isArray(key) &&
						key[0] === 'srp' &&
						key[1] === 'payments' &&
						key[2] === 'pending-total'
					)
				},
			})
			transitionRequestStatusAcrossReviewQueueSnapshots(id, 'paid')
			let approvedAmountDelta = 0
			const pendingPaymentQueries = queryClient.getQueriesData<{ requests?: SRPRequestResponse[] }>({
				predicate: (query) => {
					const key = query.queryKey
					return (
						Array.isArray(key) &&
						key[0] === 'srp' &&
						key[1] === 'payments' &&
						key[2] === 'pending'
					)
				},
			})
			for (const [, value] of pendingPaymentQueries) {
				const request = value?.requests?.find((entry) => entry.id === id)
				if (!request) continue
				const amount = Number.parseFloat(request.approvedAmount ?? '0')
				if (Number.isFinite(amount)) {
					approvedAmountDelta = amount
				}
				break
			}
			if (approvedAmountDelta > 0) {
				adjustPendingPayoutTotalCaches(queryClient, -approvedAmountDelta)
			}
			const existing = queryClient.getQueryData<SRPRequestResponse>(srpKeys.request(id))
			if (existing) {
				upsertRequestAcrossReviewQueueSnapshots({
					...existing,
					requestStatus: 'paid',
				})
			}
			return { previous, previousPendingTotals }
		},
		onError: (_error, _variables, context) => {
			if (context?.previous) {
				restoreReviewQueueStateFromRollback(context.previous)
			}
			for (const [queryKey, previousValue] of context?.previousPendingTotals ?? []) {
				queryClient.setQueryData(queryKey, previousValue)
			}
		},
		onSuccess: (request: SRPRequestResponse) => {
			updateOverlayRequestStatus({
				requestId: request.id,
				requestStatus: request.requestStatus,
			})
			upsertRequestAcrossReviewQueueSnapshots(request)
			setRequestStatusAcrossCaches(queryClient, request)
			refreshQueueBadgesSoft(queryClient, ['approved', 'pending', 'paid'])
			void queryClient.invalidateQueries({ queryKey: srpKeys.pendingPayoutTotal() })
		},
	})
}

export function useVerifyPaid() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id }: { id: string }) => api.verifyPaid(id),
		onSuccess: (request: SRPRequestResponse) => {
			updateOverlayRequestStatus({
				requestId: request.id,
				requestStatus: request.requestStatus,
			})
			upsertRequestAcrossReviewQueueSnapshots(request)
			setRequestStatusAcrossCaches(queryClient, request)
			refreshQueueBadgesSoft(queryClient, ['approved', 'pending', 'paid'])
			void queryClient.invalidateQueries({ queryKey: srpKeys.pendingPayoutTotal() })
			void queryClient.invalidateQueries({ queryKey: srpKeys.request(request.id) })
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

export function useSrpWalletHistory(params: {
	reason?: string
	recipientId?: string
	alertsOnly?: boolean
	dateFrom?: string
	dateTo?: string
	limit?: number
	offset?: number
}) {
	return useQuery({
		queryKey: srpKeys.walletHistory(params),
		queryFn: () => api.getSrpWalletHistory(params),
		staleTime: 1000 * 30,
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
