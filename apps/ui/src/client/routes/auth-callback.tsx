import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { apiClient } from '@/lib/api'

interface CallbackResponse {
	success?: boolean
	user?: {
		id: string
		requiresClaimMain?: boolean
	}
	requiresClaimMain?: boolean
	characterInfo?: {
		characterOwnerHash: string
		characterId: number
		characterName: string
	}
	characterLinked?: boolean
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
	const [searchParams] = useSearchParams()
	const navigate = useNavigate()
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

			// Mark as called before making the request
			hasCalledCallback.current = true

			try {
				// Call the callback endpoint
				const response = await apiClient.get<CallbackResponse>(
					`/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state || '')}`
				)

				if (response.characterLinked) {
					// Character was successfully linked - redirect to dashboard
					void navigate('/dashboard')
				} else if (response.requiresClaimMain && response.characterInfo) {
					// New user - redirect to claim-main page
					void navigate('/claim-main', {
						state: {
							characterInfo: response.characterInfo,
						},
					})
				} else if (response.success) {
					// Existing user logging in - session cookie set by server
					// Use redirect URL if present, otherwise go to dashboard
					const destination = response.redirectUrl || '/dashboard'

					// If redirect URL starts with /invite/, /login, or other server routes,
					// do a full page reload instead of SPA navigation
					if (destination.startsWith('/invite/') || destination.startsWith('/login')) {
						window.location.href = destination
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
	}, [searchParams, navigate])

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
