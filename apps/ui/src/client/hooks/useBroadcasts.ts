import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

import type {
	BroadcastStatus,
	BroadcastTarget,
	BroadcastTemplate,
	BroadcastWithDetails,
	CreateBroadcastRequest,
	CreateBroadcastTargetRequest,
	CreateBroadcastTemplateRequest,
	UpdateBroadcastTargetRequest,
	UpdateBroadcastTemplateRequest,
} from '@/lib/api'

// Query keys
export const broadcastKeys = {
	all: ['broadcasts'] as const,
	targets: () => [...broadcastKeys.all, 'targets'] as const,
	target: (id: string) => [...broadcastKeys.targets(), id] as const,
	templates: () => [...broadcastKeys.all, 'templates'] as const,
	template: (id: string) => [...broadcastKeys.templates(), id] as const,
	templatesFiltered: (targetType?: string, targetId?: string) =>
		[...broadcastKeys.templates(), 'filter', targetType ?? 'all', targetId ?? 'all'] as const,
	templatesByTarget: (targetId: string) => [...broadcastKeys.templates(), 'target', targetId] as const,
	broadcasts: () => [...broadcastKeys.all, 'list'] as const,
	broadcastsPage: (
		permissionId: string | undefined,
		status: BroadcastStatus | undefined,
		mine: boolean | undefined,
		limit: number,
		offset: number,
		targetId: string | undefined
	) =>
		[
			...broadcastKeys.broadcasts(),
			permissionId ?? 'all',
			status ?? 'all',
			mine ? 'mine' : 'all',
			limit,
			offset,
			targetId ?? 'all',
		] as const,
	broadcast: (id: string) => [...broadcastKeys.all, id] as const,
	broadcastsByPermission: (permissionId: string, status?: BroadcastStatus) =>
		[...broadcastKeys.broadcasts(), 'permission', permissionId, status] as const,
	deliveries: (broadcastId: string) => [...broadcastKeys.all, broadcastId, 'deliveries'] as const,
}

// ===== Broadcast Targets =====

/**
 * Fetch all broadcast targets
 */
export function useBroadcastTargets() {
	return useQuery({
		queryKey: broadcastKeys.targets(),
		queryFn: () => api.getBroadcastTargets(),
		staleTime: 1000 * 60, // 1 minute
	})
}

/**
 * Fetch a single broadcast target by ID
 */
export function useBroadcastTarget(id: string) {
	return useQuery({
		queryKey: broadcastKeys.target(id),
		queryFn: () => api.getBroadcastTarget(id),
		staleTime: 1000 * 60,
	})
}

/**
 * Create a new broadcast target
 */
export function useCreateBroadcastTarget() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreateBroadcastTargetRequest) => api.createBroadcastTarget(data),
		onSuccess: (_, variables) => {
			// Invalidate all targets lists
			queryClient.invalidateQueries({ queryKey: broadcastKeys.targets() })
		},
	})
}

/**
 * Update a broadcast target
 */
export function useUpdateBroadcastTarget() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: UpdateBroadcastTargetRequest }) =>
			api.updateBroadcastTarget(id, data),
		onSuccess: (_, variables) => {
			// Invalidate all targets lists
			queryClient.invalidateQueries({ queryKey: broadcastKeys.targets() })
			// Invalidate specific target
			queryClient.invalidateQueries({ queryKey: broadcastKeys.target(variables.id) })
		},
	})
}

/**
 * Delete a broadcast target
 */
export function useDeleteBroadcastTarget() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => api.deleteBroadcastTarget(id),
		onSuccess: () => {
			// Invalidate all targets lists
			queryClient.invalidateQueries({ queryKey: broadcastKeys.targets() })
		},
	})
}

// ===== Broadcast Templates =====

/**
 * Fetch all broadcast templates, optionally filtered by target type and target
 */
export function useBroadcastTemplates(targetType?: string, targetId?: string) {
	return useQuery({
		queryKey: broadcastKeys.templatesFiltered(targetType, targetId),
		queryFn: () => api.getBroadcastTemplates(targetType, targetId),
		staleTime: 1000 * 60,
	})
}

/**
 * Fetch a single broadcast template by ID
 */
export function useBroadcastTemplate(id: string) {
	return useQuery({
		queryKey: broadcastKeys.template(id),
		queryFn: () => api.getBroadcastTemplate(id),
		staleTime: 1000 * 60,
	})
}

/**
 * Create a new broadcast template
 */
export function useCreateBroadcastTemplate() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreateBroadcastTemplateRequest) => api.createBroadcastTemplate(data),
		onSuccess: (_, variables) => {
			// Invalidate all templates lists
			queryClient.invalidateQueries({ queryKey: broadcastKeys.templates() })
			// Invalidate target-specific list
			if (variables.targetId) {
				queryClient.invalidateQueries({
					queryKey: broadcastKeys.templatesByTarget(variables.targetId),
				})
			}
		},
	})
}

/**
 * Update a broadcast template
 */
export function useUpdateBroadcastTemplate() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: UpdateBroadcastTemplateRequest }) =>
			api.updateBroadcastTemplate(id, data),
		onSuccess: (_, variables) => {
			// Invalidate all templates lists
			queryClient.invalidateQueries({ queryKey: broadcastKeys.templates() })
			// Invalidate specific template
			queryClient.invalidateQueries({ queryKey: broadcastKeys.template(variables.id) })
		},
	})
}

/**
 * Delete a broadcast template
 */
export function useDeleteBroadcastTemplate() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => api.deleteBroadcastTemplate(id),
		onSuccess: () => {
			// Invalidate all templates lists
			queryClient.invalidateQueries({ queryKey: broadcastKeys.templates() })
		},
	})
}

// ===== Broadcasts =====

/**
 * Fetch all broadcasts, optionally filtered by group and status
 */
export function useBroadcasts(
	permissionId?: string,
	status?: BroadcastStatus,
	options?: { limit?: number; offset?: number; mine?: boolean; targetId?: string }
) {
	const limit = options?.limit ?? 25
	const offset = options?.offset ?? 0
	const mine = options?.mine ?? false
	const targetId = options?.targetId

	return useQuery({
		queryKey: broadcastKeys.broadcastsPage(permissionId, status, mine, limit, offset, targetId),
		queryFn: () => api.getBroadcasts(permissionId, status, { limit, offset, mine, targetId }),
		staleTime: 1000 * 30, // 30 seconds
	})
}

/**
 * Fetch a single broadcast by ID with full details
 */
export function useBroadcast(id: string) {
	return useQuery({
		queryKey: broadcastKeys.broadcast(id),
		queryFn: () => api.getBroadcast(id),
		staleTime: 1000 * 30,
	})
}

/**
 * Create a new broadcast
 */
export function useCreateBroadcast() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreateBroadcastRequest) => api.createBroadcast(data),
		onSuccess: () => {
			// Invalidate all broadcasts lists
			queryClient.invalidateQueries({ queryKey: broadcastKeys.broadcasts() })
		},
	})
}

/**
 * Send a broadcast immediately
 */
export function useSendBroadcast() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => api.sendBroadcast(id),
		onSuccess: (_, id) => {
			// Invalidate all broadcasts lists
			queryClient.invalidateQueries({ queryKey: broadcastKeys.broadcasts() })
			// Invalidate specific broadcast
			queryClient.invalidateQueries({ queryKey: broadcastKeys.broadcast(id) })
			// Invalidate deliveries
			queryClient.invalidateQueries({ queryKey: broadcastKeys.deliveries(id) })
		},
	})
}

/**
 * Delete a broadcast
 */
export function useDeleteBroadcast() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => api.deleteBroadcast(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: broadcastKeys.broadcasts() })
		},
	})
}

export function useRescindBroadcast() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, rescindMessage }: { id: string; rescindMessage?: string }) =>
			api.rescindBroadcast(id, rescindMessage),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: broadcastKeys.broadcasts() })
		},
	})
}

/**
 * Fetch broadcast deliveries
 */
export function useBroadcastDeliveries(broadcastId: string) {
	return useQuery({
		queryKey: broadcastKeys.deliveries(broadcastId),
		queryFn: () => api.getBroadcastDeliveries(broadcastId),
		staleTime: 1000 * 30,
	})
}
