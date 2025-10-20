import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'

import { apiClient } from '@/lib/api'

interface DiscordOAuthMessage {
	type: 'discord-oauth-success' | 'discord-oauth-error'
	error?: string
}

/**
 * Hook to handle Discord account linking via popup OAuth flow
 */
export function useDiscordLink() {
	const queryClient = useQueryClient()
	const popupRef = useRef<Window | null>(null)
	const messageHandlerRef = useRef<((event: MessageEvent) => void) | null>(null)

	// Cleanup function to remove event listener and close popup
	const cleanup = useCallback(() => {
		if (messageHandlerRef.current) {
			window.removeEventListener('message', messageHandlerRef.current)
			messageHandlerRef.current = null
		}
		if (popupRef.current && !popupRef.current.closed) {
			popupRef.current.close()
			popupRef.current = null
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
			// Get Discord OAuth URL from API
			const response = await apiClient.startDiscordLinking()
			return response.url
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
				throw new Error('Popup blocked. Please allow popups for this site.')
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
					// Success - force immediate refetch of user data to get updated Discord info
					queryClient.refetchQueries({ queryKey: ['auth', 'session'] })
					cleanup()
				} else if (data.type === 'discord-oauth-error') {
					console.error('Discord OAuth error:', data.error)
					cleanup()
				}
			}

			messageHandlerRef.current = messageHandler
			window.addEventListener('message', messageHandler)

			// Monitor popup closure (user manually closed it)
			const checkPopupClosed = setInterval(() => {
				if (popup.closed) {
					clearInterval(checkPopupClosed)
					cleanup()
				}
			}, 500)
		},
		onError: (error) => {
			console.error('Failed to start Discord linking:', error)
			cleanup()
		},
	})

	return mutation
}
