import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { billsApi } from '@/lib/bills-api'

import type {
	Bill,
	BillSchedule,
	BillTemplate,
	CreateBillFromTemplateInput,
	CreateBillInput,
	CreateScheduleInput,
	CreateTemplateInput,
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
	payerType?: string
	issuerId?: string
	limit?: number
	offset?: number
}) {
	return useQuery({
		queryKey: billKeys.list(filters),
		queryFn: () => billsApi.listBills(filters),
		staleTime: 1000 * 30, // 30 seconds
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

/**
 * Create a new bill
 */
export function useCreateBill() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreateBillInput) => billsApi.createBill(data),
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
