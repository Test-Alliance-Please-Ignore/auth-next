import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/lib/api'

import type {
	AttachDiscordCommandToServerRequest,
	CreateDiscordCommandCategoryRequest,
	CreateDiscordCommandRequest,
	UpdateDiscordCommandCategoryRequest,
	UpdateDiscordCommandRequest,
} from '@/lib/api'

export const discordCommandKeys = {
	all: ['admin', 'discord', 'commands'] as const,
	categories: () => [...discordCommandKeys.all, 'categories'] as const,
	list: () => [...discordCommandKeys.all, 'list'] as const,
	servers: (commandId: string) => [...discordCommandKeys.all, 'servers', commandId] as const,
}

export function useDiscordCommandCategories() {
	return useQuery({
		queryKey: discordCommandKeys.categories(),
		queryFn: () => apiClient.getDiscordCommandCategories(),
		staleTime: 1000 * 60 * 5,
	})
}

export function useDiscordCommands() {
	return useQuery({
		queryKey: discordCommandKeys.list(),
		queryFn: () => apiClient.getDiscordCommands(),
		staleTime: 1000 * 60,
	})
}

export function useDiscordCommandServers(commandId: string) {
	return useQuery({
		queryKey: discordCommandKeys.servers(commandId),
		queryFn: () => apiClient.getDiscordCommandServers(commandId),
		enabled: !!commandId,
	})
}

export function useCreateDiscordCommandCategory() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (data: CreateDiscordCommandCategoryRequest) =>
			apiClient.createDiscordCommandCategory(data),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: discordCommandKeys.categories() })
		},
	})
}

export function useUpdateDiscordCommandCategory() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: UpdateDiscordCommandCategoryRequest }) =>
			apiClient.updateDiscordCommandCategory(id, data),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: discordCommandKeys.categories() })
		},
	})
}

export function useDeleteDiscordCommandCategory() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (id: string) => apiClient.deleteDiscordCommandCategory(id),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: discordCommandKeys.categories() })
			void queryClient.invalidateQueries({ queryKey: discordCommandKeys.list() })
		},
	})
}

export function useCreateDiscordCommand() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (data: CreateDiscordCommandRequest) => apiClient.createDiscordCommand(data),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: discordCommandKeys.list() })
		},
	})
}

export function useUpdateDiscordCommand() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: UpdateDiscordCommandRequest }) =>
			apiClient.updateDiscordCommand(id, data),
		onSuccess: (_, variables) => {
			void queryClient.invalidateQueries({ queryKey: discordCommandKeys.list() })
			void queryClient.invalidateQueries({ queryKey: discordCommandKeys.servers(variables.id) })
		},
	})
}

export function useDeleteDiscordCommand() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (id: string) => apiClient.deleteDiscordCommand(id),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: discordCommandKeys.list() })
		},
	})
}

export function useAttachDiscordCommandToServer() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({
			commandId,
			data,
		}: {
			commandId: string
			data: AttachDiscordCommandToServerRequest
		}) => apiClient.attachDiscordCommandToServer(commandId, data),
		onSuccess: (_, variables) => {
			void queryClient.invalidateQueries({ queryKey: discordCommandKeys.list() })
			void queryClient.invalidateQueries({ queryKey: discordCommandKeys.servers(variables.commandId) })
		},
	})
}

export function useDetachDiscordCommandFromServer() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ commandId, serverId }: { commandId: string; serverId: string }) =>
			apiClient.detachDiscordCommandFromServer(commandId, serverId),
		onSuccess: (_, variables) => {
			void queryClient.invalidateQueries({ queryKey: discordCommandKeys.list() })
			void queryClient.invalidateQueries({ queryKey: discordCommandKeys.servers(variables.commandId) })
		},
	})
}

export function useSyncDiscordCommand() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (commandId: string) => apiClient.syncDiscordCommand(commandId),
		onSuccess: (_, commandId) => {
			void queryClient.invalidateQueries({ queryKey: discordCommandKeys.list() })
			void queryClient.invalidateQueries({ queryKey: discordCommandKeys.servers(commandId) })
		},
	})
}

export function useRegisterDiscordCommand() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (commandId: string) => apiClient.registerDiscordCommand(commandId),
		onSuccess: (_, commandId) => {
			void queryClient.invalidateQueries({ queryKey: discordCommandKeys.list() })
			void queryClient.invalidateQueries({ queryKey: discordCommandKeys.servers(commandId) })
		},
	})
}
