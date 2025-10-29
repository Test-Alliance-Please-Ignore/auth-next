import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

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

interface DiscordOAuthMessage {
	type: 'discord-oauth-success' | 'discord-oauth-error' | 'discord-oauth-ack'
	error?: string
}

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
 * Hook to handle Discord account linking via popup OAuth flow with PKCE
 */
export function useDiscordLink() {
	const queryClient = useQueryClient()
	const popupRef = useRef<Window | null>(null)
	const messageHandlerRef = useRef<((event: MessageEvent) => void) | null>(null)
	const intervalRef = useRef<number | null>(null)
	const timeoutRef = useRef<number | null>(null)
	const [linkError, setLinkError] = useState<string | null>(null)

	// Cleanup function to remove event listener, close popup, and clear timers
	const cleanup = useCallback(() => {
		if (messageHandlerRef.current) {
			window.removeEventListener('message', messageHandlerRef.current)
			messageHandlerRef.current = null
		}
		if (popupRef.current && !popupRef.current.closed) {
			popupRef.current.close()
			popupRef.current = null
		}
		if (intervalRef.current !== null) {
			clearInterval(intervalRef.current)
			intervalRef.current = null
		}
		if (timeoutRef.current !== null) {
			clearTimeout(timeoutRef.current)
			timeoutRef.current = null
		}
	}, [])

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			cleanup()
		}
	}, [cleanup])

	const mutation = useMutation({
		mutationFn: async () => {
			// Clear previous error state
			setLinkError(null)

			// Generate PKCE parameters
			const { codeVerifier, codeChallenge } = await generatePKCE()

			// Get state from backend (still need this for CSRF protection)
			const response = await apiClient.startDiscordLinking()
			const state = response.state

			// Store code verifier in localStorage (will be read by callback page)
			// Note: localStorage is shared across windows/tabs, sessionStorage is not
			localStorage.setItem(`discord_code_verifier_${state}`, codeVerifier)

			// Build OAuth URL with PKCE parameters
			const params = new URLSearchParams({
				client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
				redirect_uri: window.location.origin + '/discord/callback',
				response_type: 'code',
				scope: 'identify guilds.join',
				state: state,
				code_challenge: codeChallenge,
				code_challenge_method: 'S256',
			})

			return `https://discord.com/oauth2/authorize?${params.toString()}`
		},
		onSuccess: (oauthUrl) => {
			// Calculate centered popup position
			const width = 600
			const height = 700
			const left = window.screen.width / 2 - width / 2
			const top = window.screen.height / 2 - height / 2

			// Open popup window
			const popup = window.open(
				oauthUrl,
				'discord-oauth',
				`width=${width},height=${height},left=${left},top=${top},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes`
			)

			if (!popup) {
				const errorMsg = 'Popup blocked. Please allow popups for this site.'
				setLinkError(errorMsg)
				throw new Error(errorMsg)
			}

			popupRef.current = popup

			// Create message handler for communication from popup
			const messageHandler = (event: MessageEvent<DiscordOAuthMessage>) => {
				// Verify origin matches current window origin for security
				if (event.origin !== window.location.origin) {
					return
				}

				const data = event.data

				if (data.type === 'discord-oauth-success') {
					// Send acknowledgment back to popup
					popup.postMessage({ type: 'discord-oauth-ack' }, window.location.origin)

					// Success - force immediate refetch of user data to get updated Discord info
					void queryClient.refetchQueries({ queryKey: ['auth', 'session'] })
					cleanup()
				} else if (data.type === 'discord-oauth-error') {
					// Send acknowledgment back to popup
					popup.postMessage({ type: 'discord-oauth-ack' }, window.location.origin)

					// Set error state for UI display
					const errorMsg = data.error || 'Unknown error occurred during Discord linking'
					setLinkError(errorMsg)
					console.error('Discord OAuth error:', errorMsg)
					cleanup()
				}
			}

			messageHandlerRef.current = messageHandler
			window.addEventListener('message', messageHandler)

			// Monitor popup closure (user manually closed it)
			intervalRef.current = window.setInterval(() => {
				if (popup.closed) {
					cleanup()
				}
			}, 500)

			// 2-minute timeout for OAuth flow
			timeoutRef.current = window.setTimeout(
				() => {
					const errorMsg = 'Discord linking timed out after 2 minutes. Please try again.'
					setLinkError(errorMsg)
					console.warn(errorMsg)
					cleanup()
				},
				2 * 60 * 1000
			) // 2 minutes
		},
		onError: (error) => {
			const errorMsg = error instanceof Error ? error.message : 'Failed to start Discord linking'
			setLinkError(errorMsg)
			console.error('Failed to start Discord linking:', error)
			cleanup()
		},
	})

	return {
		...mutation,
		linkError,
		clearError: () => setLinkError(null),
	}
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
