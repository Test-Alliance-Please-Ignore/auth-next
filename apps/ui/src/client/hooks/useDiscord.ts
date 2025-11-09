import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/lib/api'

import type {
	AssignRoleRequest,
	AttachDiscordServerRequest,
	CreateDiscordRoleRequest,
	CreateDiscordServerRequest,
	UpdateDiscordRoleRequest,
	UpdateDiscordServerAttachmentRequest,
	UpdateDiscordServerRequest,
} from '@/lib/api'

/**
 * Generate PKCE code verifier and challenge
 */
async function generatePKCE() {
	// Generate random code verifier (43-128 characters)
	const array = new Uint8Array(32)
	crypto.getRandomValues(array)
	const codeVerifier = btoa(String.fromCharCode(...array))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '')

	// Generate code challenge from verifier
	const encoder = new TextEncoder()
	const data = encoder.encode(codeVerifier)
	const hash = await crypto.subtle.digest('SHA-256', data)
	const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '')

	return { codeVerifier, codeChallenge }
}

/**
 * Hook to handle Discord account linking via full-page redirect OAuth flow with PKCE
 */
export function useDiscordLink() {
	const mutation = useMutation({
		mutationFn: async () => {
			// Generate PKCE parameters
			const { codeVerifier, codeChallenge } = await generatePKCE()

			// Get state from backend (for CSRF protection)
			const response = await apiClient.startDiscordLinking()
			const state = response.state

			// Store code verifier in localStorage (will be read by callback page)
			localStorage.setItem(`discord_code_verifier_${state}`, codeVerifier)

			// Store current URL as return destination after OAuth completes
			localStorage.setItem('discord_return_url', window.location.pathname)

			// Build OAuth URL with PKCE parameters
			const params = new URLSearchParams({
				client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
				redirect_uri: window.location.origin + '/discord/callback',
				response_type: 'code',
				scope: 'identify guilds guilds.join',
				state: state,
				code_challenge: codeChallenge,
				code_challenge_method: 'S256',
			})

			return `https://discord.com/oauth2/authorize?${params.toString()}`
		},
		onSuccess: (oauthUrl) => {
			// Redirect to Discord OAuth page
			window.location.href = oauthUrl
		},
		onError: (error) => {
			console.error('Failed to start Discord linking:', error)
		},
	})

	return mutation
}

// ===== Discord Registry Hooks =====

// Query keys
export const discordKeys = {
	all: ['admin', 'discord'] as const,
	servers: () => [...discordKeys.all, 'servers'] as const,
	corporationServers: (corporationId: string) =>
		['admin', 'corporations', corporationId, 'discord-servers'] as const,
}

/**
 * Fetch all Discord servers from the registry
 */
export function useDiscordServers() {
	return useQuery({
		queryKey: discordKeys.servers(),
		queryFn: () => apiClient.getDiscordServers(),
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}

/**
 * Create a new Discord server in the registry
 */
export function useCreateDiscordServer() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreateDiscordServerRequest) => apiClient.createDiscordServer(data),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: discordKeys.servers(),
				refetchType: 'active',
			})
		},
	})
}

/**
 * Update a Discord server in the registry
 */
export function useUpdateDiscordServer() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ serverId, data }: { serverId: string; data: UpdateDiscordServerRequest }) =>
			apiClient.updateDiscordServer(serverId, data),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: discordKeys.servers(),
				refetchType: 'active',
			})
		},
	})
}

/**
 * Delete a Discord server from the registry
 */
export function useDeleteDiscordServer() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (serverId: string) => apiClient.deleteDiscordServer(serverId),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: discordKeys.servers(),
				refetchType: 'active',
			})
		},
	})
}

/**
 * Create a Discord role for a server
 */
export function useCreateDiscordRole() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ serverId, data }: { serverId: string; data: CreateDiscordRoleRequest }) =>
			apiClient.createDiscordRole(serverId, data),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: discordKeys.servers(),
				refetchType: 'active',
			})
		},
	})
}

/**
 * Update a Discord role
 */
export function useUpdateDiscordRole() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			serverId,
			roleId,
			data,
		}: {
			serverId: string
			roleId: string
			data: UpdateDiscordRoleRequest
		}) => apiClient.updateDiscordRole(serverId, roleId, data),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: discordKeys.servers(),
				refetchType: 'active',
			})
		},
	})
}

/**
 * Delete a Discord role
 */
export function useDeleteDiscordRole() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ serverId, roleId }: { serverId: string; roleId: string }) =>
			apiClient.deleteDiscordRole(serverId, roleId),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: discordKeys.servers(),
				refetchType: 'active',
			})
		},
	})
}

// ===== Corporation Discord Server Attachment Hooks =====

/**
 * Fetch all Discord server attachments for a corporation
 */
export function useCorporationDiscordServers(corporationId: string) {
	return useQuery({
		queryKey: discordKeys.corporationServers(corporationId),
		queryFn: () => apiClient.getCorporationDiscordServers(corporationId),
		enabled: !!corporationId,
		staleTime: 1000 * 60, // 1 minute
	})
}

/**
 * Attach a Discord server to a corporation
 */
export function useAttachDiscordServer() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			corporationId,
			data,
		}: {
			corporationId: string
			data: AttachDiscordServerRequest
		}) => apiClient.attachDiscordServerToCorporation(corporationId, data),
		onSuccess: (_, { corporationId }) => {
			void queryClient.invalidateQueries({
				queryKey: discordKeys.corporationServers(corporationId),
				refetchType: 'active',
			})
		},
	})
}

/**
 * Update a corporation Discord server attachment
 */
export function useUpdateCorporationDiscordServer() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			corporationId,
			attachmentId,
			data,
		}: {
			corporationId: string
			attachmentId: string
			data: UpdateDiscordServerAttachmentRequest
		}) => apiClient.updateCorporationDiscordServer(corporationId, attachmentId, data),
		onSuccess: (_, { corporationId }) => {
			void queryClient.invalidateQueries({
				queryKey: discordKeys.corporationServers(corporationId),
				refetchType: 'active',
			})
		},
	})
}

/**
 * Detach a Discord server from a corporation
 */
export function useDetachDiscordServer() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			corporationId,
			attachmentId,
		}: {
			corporationId: string
			attachmentId: string
		}) => apiClient.detachDiscordServerFromCorporation(corporationId, attachmentId),
		onSuccess: (_, { corporationId }) => {
			void queryClient.invalidateQueries({
				queryKey: discordKeys.corporationServers(corporationId),
				refetchType: 'active',
			})
		},
	})
}

/**
 * Assign a role to a corporation Discord server attachment
 */
export function useAssignRoleToCorporationServer() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			corporationId,
			attachmentId,
			data,
		}: {
			corporationId: string
			attachmentId: string
			data: AssignRoleRequest
		}) => apiClient.assignRoleToCorporationDiscordServer(corporationId, attachmentId, data),
		onSuccess: (_, { corporationId }) => {
			void queryClient.invalidateQueries({
				queryKey: discordKeys.corporationServers(corporationId),
				refetchType: 'active',
			})
		},
	})
}

/**
 * Unassign a role from a corporation Discord server attachment
 */
export function useUnassignRoleFromCorporationServer() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			corporationId,
			attachmentId,
			roleAssignmentId,
		}: {
			corporationId: string
			attachmentId: string
			roleAssignmentId: string
		}) =>
			apiClient.unassignRoleFromCorporationDiscordServer(
				corporationId,
				attachmentId,
				roleAssignmentId
			),
		onSuccess: (_, { corporationId }) => {
			void queryClient.invalidateQueries({
				queryKey: discordKeys.corporationServers(corporationId),
				refetchType: 'active',
			})
		},
	})
}

// ===== Group Discord Server Attachment Hooks =====

/**
 * Fetch all Discord server attachments for a group
 */
export function useGroupDiscordServers(groupId: string) {
	return useQuery({
		queryKey: ['admin', 'groups', groupId, 'discord-servers'],
		queryFn: () => apiClient.getGroupDiscordServers(groupId),
		enabled: !!groupId,
		staleTime: 1000 * 60, // 1 minute
	})
}

/**
 * Attach a Discord server to a group
 */
export function useAttachDiscordServerToGroup() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ groupId, data }: { groupId: string; data: AttachDiscordServerRequest }) =>
			apiClient.attachDiscordServerToGroup(groupId, data),
		onSuccess: (_, { groupId }) => {
			void queryClient.invalidateQueries({
				queryKey: ['admin', 'groups', groupId, 'discord-servers'],
				refetchType: 'active',
			})
		},
	})
}

/**
 * Update a group Discord server attachment
 */
export function useUpdateGroupDiscordServer() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			groupId,
			attachmentId,
			data,
		}: {
			groupId: string
			attachmentId: string
			data: UpdateDiscordServerAttachmentRequest
		}) => apiClient.updateGroupDiscordServer(groupId, attachmentId, data),
		onSuccess: (_, { groupId }) => {
			void queryClient.invalidateQueries({
				queryKey: ['admin', 'groups', groupId, 'discord-servers'],
				refetchType: 'active',
			})
		},
	})
}

/**
 * Detach a Discord server from a group
 */
export function useDetachDiscordServerFromGroup() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ groupId, attachmentId }: { groupId: string; attachmentId: string }) =>
			apiClient.detachDiscordServerFromGroup(groupId, attachmentId),
		onSuccess: (_, { groupId }) => {
			void queryClient.invalidateQueries({
				queryKey: ['admin', 'groups', groupId, 'discord-servers'],
				refetchType: 'active',
			})
		},
	})
}

/**
 * Assign a role to a group Discord server attachment
 */
export function useAssignRoleToGroupServer() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			groupId,
			attachmentId,
			data,
		}: {
			groupId: string
			attachmentId: string
			data: AssignRoleRequest
		}) => apiClient.assignRoleToGroupDiscordServer(groupId, attachmentId, data),
		onSuccess: (_, { groupId }) => {
			void queryClient.invalidateQueries({
				queryKey: ['admin', 'groups', groupId, 'discord-servers'],
				refetchType: 'active',
			})
		},
	})
}

/**
 * Unassign a role from a group Discord server attachment
 */
export function useUnassignRoleFromGroupServer() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			groupId,
			attachmentId,
			roleAssignmentId,
		}: {
			groupId: string
			attachmentId: string
			roleAssignmentId: string
		}) => apiClient.unassignRoleFromGroupDiscordServer(groupId, attachmentId, roleAssignmentId),
		onSuccess: (_, { groupId }) => {
			void queryClient.invalidateQueries({
				queryKey: ['admin', 'groups', groupId, 'discord-servers'],
				refetchType: 'active',
			})
		},
	})
}

/**
 * Refresh Discord role assignments for all group members on a specific server
 */
export function useRefreshGroupDiscordServerRoles() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ groupId, attachmentId }: { groupId: string; attachmentId: string }) =>
			apiClient.refreshGroupDiscordServerRoles(groupId, attachmentId),
		onSuccess: (_, { groupId }) => {
			void queryClient.invalidateQueries({
				queryKey: ['admin', 'groups', groupId, 'discord-servers'],
				refetchType: 'active',
			})
		},
	})
}

/**
 * Refresh all members for a Discord server
 */
export function useRefreshDiscordServerMembers() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (serverId: string) => apiClient.refreshDiscordServerMembers(serverId),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: discordKeys.servers(),
				refetchType: 'active',
			})
		},
	})
}
