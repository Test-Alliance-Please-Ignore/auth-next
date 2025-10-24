import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'

import { apiClient } from '@/lib/api'

interface DiscordOAuthMessage {
	type: 'discord-oauth-success' | 'discord-oauth-error'
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
			// Generate PKCE parameters
			const { codeVerifier, codeChallenge } = await generatePKCE()

			// Get state from backend (still need this for CSRF protection)
			const response = await apiClient.startDiscordLinking()
			const state = (response as { url: string; state: string }).state

			// Store code verifier in sessionStorage (will be read by callback page)
			sessionStorage.setItem(`discord_code_verifier_${state}`, codeVerifier)

			// Build OAuth URL with PKCE parameters
			const params = new URLSearchParams({
				client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
				redirect_uri: window.location.origin + '/discord/callback',
				response_type: 'code',
				scope: 'identify email guilds.join',
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
					void queryClient.refetchQueries({ queryKey: ['auth', 'session'] })
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
