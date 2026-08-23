import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import { usePageTitle } from '@/hooks/usePageTitle'
import { apiClient } from '@/lib/api'
import { shouldUseFullPageAuthRedirect } from '@/lib/auth-redirect'

interface CallbackResponse {
	success?: boolean
	user?: {
		id: string
		requiresClaimMain?: boolean
	}
	requiresClaimMain?: boolean
	/** Single-use ticket naming the character SSO just verified; redeemed at /auth/claim-main. */
	claimTicket?: string
	characterInfo?: {
		characterOwnerHash: string
		characterId: number
		characterName: string
	}
	characterLinked?: boolean
	tokenUpdated?: boolean
	character?: {
		id: string
		characterId: number
		characterName: string
		is_primary: boolean
		linkedAt: Date
	}
	redirectUrl?: string
}

export default function AuthCallbackPage() {
	usePageTitle('Authenticating')
	const [searchParams] = useSearchParams()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const [error, setError] = useState<string | null>(null)
	const hasCalledCallback = useRef(false)

	useEffect(() => {
		// Prevent double-calling in React Strict Mode
		if (hasCalledCallback.current) {
			return
		}

		const handleCallback = async () => {
			const code = searchParams.get('code')
			const state = searchParams.get('state')

			if (!code) {
				setError('No authorization code received')
				return
			}

			// The server requires a state parameter and rejects the callback without one, so
			// surface a real error here rather than sending an empty string it will refuse.
			if (!state) {
				setError('No state parameter received')
				return
			}

			// Mark as called before making the request
			hasCalledCallback.current = true

			try {
				// Call the callback endpoint
				const response = await apiClient.get<CallbackResponse>(
					`/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
				)

				// The app's session query can have completed before this callback set the
				// session cookie. Reset and await it before navigating, otherwise a cached
				// unauthenticated response can redirect a valid deep link to the dashboard.
				const refreshSession = async () => {
					await queryClient.resetQueries({ queryKey: ['auth', 'session'] })
				}

				if (response.characterLinked) {
					// Character was successfully linked (new link or token refresh).
					// Always flag dashboard to refetch auth/session immediately so linked characters
					// and token state are reflected without waiting for stale cache expiry.
					await refreshSession()
					const destination = '/dashboard?tokenUpdated=1'
					void navigate(destination)
				} else if (response.requiresClaimMain && response.characterInfo && response.claimTicket) {
					// New user - redirect to claim-main page. characterInfo is for display; the
					// ticket is the only thing that actually authorizes the claim.
					void navigate('/claim-main', {
						state: {
							characterInfo: response.characterInfo,
							claimTicket: response.claimTicket,
						},
					})
				} else if (response.success) {
					// Existing user logging in - session cookie set by server
					// Use redirect URL if present, otherwise go to dashboard
					await refreshSession()
					const destination = response.redirectUrl || '/dashboard'

					// Absolute destinations, including the third-party OAuth /authorize URL, must
					// use a browser navigation. React Router treats an absolute URL passed to
					// navigate() as a route-relative path (for example, /auth/callback/https:/...).
					if (shouldUseFullPageAuthRedirect(destination)) {
						window.location.assign(destination)
					} else {
						void navigate(destination)
					}
				} else {
					setError('Unexpected response from server')
				}
			} catch (err) {
				console.error('Auth callback error:', err)
				setError('Failed to complete authentication')
			}
		}

		void handleCallback()
	}, [navigate, queryClient, searchParams])

	if (error) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<div className="text-center">
					<h1 className="text-2xl font-bold text-destructive mb-4">Authentication Failed</h1>
					<p className="text-muted-foreground mb-6">{error}</p>
					<button
						onClick={() => navigate('/')}
						className="px-6 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
					>
						Return to Home
					</button>
				</div>
			</div>
		)
	}

	return (
		<div className="min-h-screen flex items-center justify-center">
			<div className="text-center">
				<div className="mb-4">
					<svg
						className="animate-spin h-12 w-12 mx-auto text-primary"
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
					>
						<circle
							className="opacity-25"
							cx="12"
							cy="12"
							r="10"
							stroke="currentColor"
							strokeWidth="4"
						></circle>
						<path
							className="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
						></path>
					</svg>
				</div>
				<h2 className="text-xl font-semibold mb-2">Completing authentication...</h2>
				<p className="text-muted-foreground">
					Please wait while we verify your EVE Online identity
				</p>
			</div>
		</div>
	)
}
