import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

import type {
	BroadcastTarget,
	BroadcastTemplate,
	BroadcastWithDetails,
	CreateBroadcastTargetRequest,
	CreateBroadcastTemplateRequest,
	CreateBroadcastRequest,
	UpdateBroadcastTargetRequest,
	UpdateBroadcastTemplateRequest,
	BroadcastStatus,
} from '@/lib/api'

// Query keys
export const broadcastKeys = {
	all: ['broadcasts'] as const,
	targets: () => [...broadcastKeys.all, 'targets'] as const,
	target: (id: string) => [...broadcastKeys.targets(), id] as const,
	targetsByGroup: (groupId: string) => [...broadcastKeys.targets(), 'group', groupId] as const,
	templates: () => [...broadcastKeys.all, 'templates'] as const,
	template: (id: string) => [...broadcastKeys.templates(), id] as const,
	templatesByGroup: (groupId: string) => [...broadcastKeys.templates(), 'group', groupId] as const,
	broadcasts: () => [...broadcastKeys.all, 'list'] as const,
	broadcast: (id: string) => [...broadcastKeys.all, id] as const,
	broadcastsByGroup: (groupId: string, status?: BroadcastStatus) =>
		[...broadcastKeys.broadcasts(), 'group', groupId, status] as const,
	deliveries: (broadcastId: string) => [...broadcastKeys.all, broadcastId, 'deliveries'] as const,
}

// ===== Broadcast Targets =====

/**
 * Fetch all broadcast targets, optionally filtered by group
 */
export function useBroadcastTargets(groupId?: string) {
	return useQuery({
		queryKey: groupId ? broadcastKeys.targetsByGroup(groupId) : broadcastKeys.targets(),
		queryFn: () => api.getBroadcastTargets(groupId),
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
			// Invalidate group-specific list
			if (variables.groupId) {
				queryClient.invalidateQueries({ queryKey: broadcastKeys.targetsByGroup(variables.groupId) })
			}
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
 * Fetch all broadcast templates, optionally filtered by target type and group
 */
export function useBroadcastTemplates(targetType?: string, groupId?: string) {
	return useQuery({
		queryKey: groupId ? broadcastKeys.templatesByGroup(groupId) : broadcastKeys.templates(),
		queryFn: () => api.getBroadcastTemplates(targetType, groupId),
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
			// Invalidate group-specific list
			if (variables.groupId) {
				queryClient.invalidateQueries({ queryKey: broadcastKeys.templatesByGroup(variables.groupId) })
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
export function useBroadcasts(groupId?: string, status?: BroadcastStatus) {
	return useQuery({
		queryKey: groupId
			? broadcastKeys.broadcastsByGroup(groupId, status)
			: broadcastKeys.broadcasts(),
		queryFn: () => api.getBroadcasts(groupId, status),
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
		onSuccess: (_, variables) => {
			// Invalidate all broadcasts lists
			queryClient.invalidateQueries({ queryKey: broadcastKeys.broadcasts() })
			// Invalidate group-specific list
			if (variables.groupId) {
				queryClient.invalidateQueries({
					queryKey: broadcastKeys.broadcastsByGroup(variables.groupId),
				})
			}
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
			// Invalidate all broadcasts lists
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
