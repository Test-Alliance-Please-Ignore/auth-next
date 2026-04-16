import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { billsApi } from '@/lib/bills-api'

import type {
	Bill,
	BillListSortDirection,
	BillListSortField,
	BillPartyDirection,
	BillSchedule,
	BillTemplate,
	BillWithDetails,
	CreateBillFromTemplateInput,
	CreateBillInput,
	CreateScheduleInput,
	CreateTemplateInput,
	EntitySearchType,
	EntityType,
	GroupBillAggregate,
	GroupBillOperationResult,
	UpdateBillInput,
	UpdateScheduleInput,
	UpdateTemplateInput,
} from '@repo/bills'

// Query keys
export const billKeys = {
	all: ['bills'] as const,
	lists: () => [...billKeys.all, 'list'] as const,
	list: (filters?: Record<string, unknown>) => [...billKeys.lists(), filters] as const,
	details: () => [...billKeys.all, 'detail'] as const,
	detail: (id: string) => [...billKeys.details(), id] as const,
	statistics: () => [...billKeys.all, 'statistics'] as const,
}

export const templateKeys = {
	all: ['templates'] as const,
	lists: () => [...templateKeys.all, 'list'] as const,
	details: () => [...templateKeys.all, 'detail'] as const,
	detail: (id: string) => [...templateKeys.details(), id] as const,
}

export const scheduleKeys = {
	all: ['schedules'] as const,
	lists: () => [...scheduleKeys.all, 'list'] as const,
	list: (filters?: Record<string, unknown>) => [...scheduleKeys.lists(), filters] as const,
	details: () => [...scheduleKeys.all, 'detail'] as const,
	detail: (id: string) => [...scheduleKeys.details(), id] as const,
	logs: (scheduleId: string) => [...scheduleKeys.detail(scheduleId), 'logs'] as const,
	statistics: () => [...scheduleKeys.all, 'statistics'] as const,
}

// ===== Bills Hooks =====

/**
 * Fetch bills with optional filters
 */
export function useBills(filters?: {
	status?: string
	payerId?: string
	payeeId?: string
	payerType?: string
	payeeType?: string
	issuerId?: string
	dueAfter?: string
	dueBefore?: string
	createdAfter?: string
	createdBefore?: string
	sortBy?: BillListSortField
	sortDir?: BillListSortDirection
	limit?: number
	offset?: number
	coalesced?: boolean
}) {
	return useQuery({
		queryKey: billKeys.list(filters),
		queryFn: () => billsApi.listBills(filters),
		staleTime: 1000 * 30, // 30 seconds
	})
}

export function useBillPartySearch(params: {
	q: string
	direction?: BillPartyDirection
	entityType?: EntityType
	limit?: number
	enabled?: boolean
}) {
	return useQuery({
		queryKey: [...billKeys.all, 'party-search', params] as const,
		queryFn: () =>
			billsApi.searchBillParties({
				q: params.q,
				direction: params.direction,
				entityType: params.entityType,
				limit: params.limit,
			}),
		enabled: params.enabled ?? params.q.trim().length >= 2,
		staleTime: 1000 * 60 * 2,
	})
}

export function useBillEntitySearch(params: {
	q: string
	entityType: EntitySearchType
	limit?: number
	enabled?: boolean
}) {
	return useQuery({
		queryKey: [...billKeys.all, 'entity-search', params] as const,
		queryFn: () =>
			billsApi.searchEntities({
				q: params.q,
				entityType: params.entityType,
				limit: params.limit,
			}),
		enabled: params.enabled ?? params.q.trim().length >= 2,
		staleTime: 1000 * 60 * 2,
	})
}

/**
 * Fetch a single bill by ID
 */
export function useBill(id: string) {
	return useQuery({
		queryKey: billKeys.detail(id),
		queryFn: () => billsApi.getBill(id),
		enabled: !!id,
	})
}

export const groupBillKeys = {
	aggregate: (groupBillId: string) => ['group-bill', groupBillId] as const,
}

/**
 * Fetch the aggregate view for a group bill
 */
export function useGroupBillAggregate(groupBillId: string | undefined) {
	return useQuery({
		queryKey: groupBillId ? groupBillKeys.aggregate(groupBillId) : ([] as unknown[]),
		queryFn: () => billsApi.getGroupBillAggregate(groupBillId!),
		enabled: Boolean(groupBillId),
		staleTime: 1000 * 30,
	})
}

/**
 * Issue all draft sub-bills in a group bill at once
 */
export function useIssueGroupBill() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (groupBillId: string) => billsApi.issueGroupBill(groupBillId),
		onSuccess: (_result: GroupBillOperationResult, groupBillId) => {
			void queryClient.invalidateQueries({ queryKey: billKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: billKeys.statistics() })
			void queryClient.invalidateQueries({ queryKey: groupBillKeys.aggregate(groupBillId) })
		},
	})
}

/**
 * Cancel all eligible sub-bills in a group bill at once
 */
export function useCancelGroupBill() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (groupBillId: string) => billsApi.cancelGroupBill(groupBillId),
		onSuccess: (_result: GroupBillOperationResult, groupBillId) => {
			void queryClient.invalidateQueries({ queryKey: billKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: billKeys.statistics() })
			void queryClient.invalidateQueries({ queryKey: groupBillKeys.aggregate(groupBillId) })
		},
	})
}

/**
 * Revert all eligible sub-bills in a group bill back to draft
 */
export function useRevertGroupBillToDraft() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (groupBillId: string) => billsApi.revertGroupBillToDraft(groupBillId),
		onSuccess: (_result: GroupBillOperationResult, groupBillId) => {
			void queryClient.invalidateQueries({ queryKey: billKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: billKeys.statistics() })
			void queryClient.invalidateQueries({ queryKey: groupBillKeys.aggregate(groupBillId) })
		},
	})
}

/**
 * Delete all draft sub-bills in a group bill at once
 */
export function useDeleteGroupBill() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (groupBillId: string) => billsApi.deleteGroupBill(groupBillId),
		onSuccess: (_result: GroupBillOperationResult, groupBillId) => {
			void queryClient.invalidateQueries({ queryKey: billKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: billKeys.statistics() })
			queryClient.removeQueries({ queryKey: groupBillKeys.aggregate(groupBillId) })
		},
	})
}

/**
 * Update all eligible sub-bills in a group bill at once
 */
export function useUpdateGroupBill() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ groupBillId, data }: { groupBillId: string; data: UpdateBillInput }) =>
			billsApi.updateGroupBill(groupBillId, data),
		onSuccess: (_result: GroupBillOperationResult, { groupBillId }) => {
			void queryClient.invalidateQueries({ queryKey: billKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: groupBillKeys.aggregate(groupBillId) })
		},
	})
}

/**
 * Create a new bill (or group bill fan-out)
 */
export function useCreateBill() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (
			data: CreateBillInput & {
				groupBillOptions?: {
					includeOwner: boolean
					includeAdmins: boolean
					includeMembers: boolean
				}
			}
		) => billsApi.createBill(data),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: billKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: billKeys.statistics() })
		},
	})
}

/**
 * Update an existing bill
 */
export function useUpdateBill() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: UpdateBillInput }) =>
			billsApi.updateBill(id, data),
		onSuccess: (updatedBill) => {
			void queryClient.invalidateQueries({ queryKey: billKeys.lists() })
			queryClient.setQueryData(billKeys.detail(updatedBill.id), updatedBill)
		},
	})
}

/**
 * Delete a bill
 */
export function useDeleteBill() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => billsApi.deleteBill(id),
		onSuccess: (_, deletedId) => {
			void queryClient.invalidateQueries({ queryKey: billKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: billKeys.statistics() })
			queryClient.removeQueries({ queryKey: billKeys.detail(deletedId) })
		},
	})
}

/**
 * Issue a bill (change from draft to issued)
 */
export function useIssueBill() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => billsApi.issueBill(id),
		onSuccess: (updatedBill) => {
			void queryClient.invalidateQueries({ queryKey: billKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: billKeys.statistics() })
			queryClient.setQueryData(billKeys.detail(updatedBill.id), updatedBill)
		},
	})
}

/**
 * Cancel a bill
 */
export function useCancelBill() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => billsApi.cancelBill(id),
		onSuccess: (updatedBill) => {
			void queryClient.invalidateQueries({ queryKey: billKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: billKeys.statistics() })
			queryClient.setQueryData(billKeys.detail(updatedBill.id), updatedBill)
		},
	})
}

/**
 * Mark a bill as paid
 */
export function useMarkBillPaid() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => billsApi.markBillPaid(id),
		onSuccess: (updatedBill) => {
			void queryClient.invalidateQueries({ queryKey: billKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: billKeys.statistics() })
			// Mark-paid response can be a partial bill shape without full payment relation data.
			// Trigger an immediate detail refetch so payment history appears without manual reload.
			void queryClient.invalidateQueries({
				queryKey: billKeys.detail(updatedBill.id),
				refetchType: 'active',
			})
		},
	})
}

/**
 * Revert a bill back to draft
 */
export function useRevertBillToDraft() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => billsApi.revertBillToDraft(id),
		onSuccess: (updatedBill) => {
			void queryClient.invalidateQueries({ queryKey: billKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: billKeys.statistics() })
			queryClient.setQueryData(billKeys.detail(updatedBill.id), updatedBill)
		},
	})
}

/**
 * Pay a bill using payment token
 */
export function usePayBill() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (paymentToken: string) => billsApi.payBill(paymentToken),
		onSuccess: (updatedBill) => {
			void queryClient.invalidateQueries({ queryKey: billKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: billKeys.statistics() })
			queryClient.setQueryData(billKeys.detail(updatedBill.id), updatedBill)
		},
	})
}

/**
 * Regenerate payment token for a bill
 */
export function useRegeneratePaymentToken() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (billId: string) => billsApi.regeneratePaymentToken(billId),
		onSuccess: (_, billId) => {
			void queryClient.invalidateQueries({ queryKey: billKeys.detail(billId) })
		},
	})
}

/**
 * Get bill statistics
 */
export function useBillStatistics() {
	return useQuery({
		queryKey: billKeys.statistics(),
		queryFn: () => billsApi.getBillStatistics(),
		staleTime: 1000 * 60, // 1 minute
	})
}

// ===== Templates Hooks =====

/**
 * Fetch all templates
 */
export function useTemplates() {
	return useQuery({
		queryKey: templateKeys.lists(),
		queryFn: () => billsApi.listTemplates(),
		staleTime: 1000 * 60, // 1 minute
	})
}

/**
 * Fetch a single template by ID
 */
export function useTemplate(id: string) {
	return useQuery({
		queryKey: templateKeys.detail(id),
		queryFn: () => billsApi.getTemplate(id),
		enabled: !!id,
	})
}

/**
 * Create a new template
 */
export function useCreateTemplate() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreateTemplateInput) => billsApi.createTemplate(data),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: templateKeys.lists() })
		},
	})
}

/**
 * Update an existing template
 */
export function useUpdateTemplate() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: UpdateTemplateInput }) =>
			billsApi.updateTemplate(id, data),
		onSuccess: (updatedTemplate) => {
			void queryClient.invalidateQueries({ queryKey: templateKeys.lists() })
			queryClient.setQueryData(templateKeys.detail(updatedTemplate.id), updatedTemplate)
		},
	})
}

/**
 * Delete a template
 */
export function useDeleteTemplate() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => billsApi.deleteTemplate(id),
		onSuccess: (_, deletedId) => {
			void queryClient.invalidateQueries({ queryKey: templateKeys.lists() })
			queryClient.removeQueries({ queryKey: templateKeys.detail(deletedId) })
		},
	})
}

/**
 * Clone an existing template
 */
export function useCloneTemplate() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: { sourceTemplateId: string; name: string; description?: string }) =>
			billsApi.cloneTemplate(data.sourceTemplateId, data.name, data.description),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: templateKeys.lists() })
		},
	})
}

/**
 * Clone a bill as a template
 */
export function useCloneBillAsTemplate() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: { sourceBillId: string; name: string; description?: string }) =>
			billsApi.cloneBillAsTemplate(data.sourceBillId, data.name, data.description),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: templateKeys.lists() })
		},
	})
}

/**
 * Create a bill from a template
 */
export function useCreateBillFromTemplate() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreateBillFromTemplateInput) => billsApi.createBillFromTemplate(data),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: billKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: billKeys.statistics() })
		},
	})
}

// ===== Schedules Hooks =====

/**
 * Fetch schedules with optional filters
 */
export function useSchedules(filters?: {
	frequency?: string
	isActive?: boolean
	templateId?: string
}) {
	return useQuery({
		queryKey: scheduleKeys.list(filters),
		queryFn: () => billsApi.listSchedules(filters),
		staleTime: 1000 * 30, // 30 seconds
	})
}

/**
 * Fetch a single schedule by ID
 */
export function useSchedule(id: string) {
	return useQuery({
		queryKey: scheduleKeys.detail(id),
		queryFn: () => billsApi.getSchedule(id),
		enabled: !!id,
	})
}

/**
 * Create a new schedule
 */
export function useCreateSchedule() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreateScheduleInput) => billsApi.createSchedule(data),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: scheduleKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: scheduleKeys.statistics() })
		},
	})
}

/**
 * Update an existing schedule
 */
export function useUpdateSchedule() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: UpdateScheduleInput }) =>
			billsApi.updateSchedule(id, data),
		onSuccess: (updatedSchedule) => {
			void queryClient.invalidateQueries({ queryKey: scheduleKeys.lists() })
			queryClient.setQueryData(scheduleKeys.detail(updatedSchedule.id), updatedSchedule)
		},
	})
}

/**
 * Delete a schedule
 */
export function useDeleteSchedule() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => billsApi.deleteSchedule(id),
		onSuccess: (_, deletedId) => {
			void queryClient.invalidateQueries({ queryKey: scheduleKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: scheduleKeys.statistics() })
			queryClient.removeQueries({ queryKey: scheduleKeys.detail(deletedId) })
		},
	})
}

/**
 * Pause a schedule
 */
export function usePauseSchedule() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => billsApi.pauseSchedule(id),
		onSuccess: (updatedSchedule) => {
			void queryClient.invalidateQueries({ queryKey: scheduleKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: scheduleKeys.statistics() })
			queryClient.setQueryData(scheduleKeys.detail(updatedSchedule.id), updatedSchedule)
		},
	})
}

/**
 * Resume a schedule
 */
export function useResumeSchedule() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => billsApi.resumeSchedule(id),
		onSuccess: (updatedSchedule) => {
			void queryClient.invalidateQueries({ queryKey: scheduleKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: scheduleKeys.statistics() })
			queryClient.setQueryData(scheduleKeys.detail(updatedSchedule.id), updatedSchedule)
		},
	})
}

/**
 * Get execution logs for a schedule
 */
export function useScheduleExecutionLogs(scheduleId: string, limit?: number) {
	return useQuery({
		queryKey: scheduleKeys.logs(scheduleId),
		queryFn: () => billsApi.getScheduleExecutionLogs(scheduleId, limit),
		enabled: !!scheduleId,
	})
}

/**
 * Get schedule statistics
 */
export function useScheduleStatistics() {
	return useQuery({
		queryKey: scheduleKeys.statistics(),
		queryFn: () => billsApi.getScheduleStatistics(),
		staleTime: 1000 * 60, // 1 minute
	})
}
