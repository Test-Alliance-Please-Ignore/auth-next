import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { apiClient } from '@/lib/api'

/**
 * Discord OAuth callback page (PKCE flow)
 * This page is shown in the popup window after Discord OAuth completes
 * It exchanges the code for tokens client-side, then sends them to the backend
 */
export default function DiscordCallbackPage() {
	const [searchParams] = useSearchParams()
	const [isClosing, setIsClosing] = useState(false)
	const [isProcessing, setIsProcessing] = useState(false)
	const [error, setError] = useState<string | null>(searchParams.get('error'))
	const code = searchParams.get('code')
	const state = searchParams.get('state')

	useEffect(() => {
		async function handleCallback() {
			// If there's an error parameter, show it immediately
			if (error) {
				notifyParentAndClose(false, error)
				return
			}

			// If no code, something went wrong
			if (!code || !state) {
				const errorMsg = 'Missing code or state parameter'
				setError(errorMsg)
				notifyParentAndClose(false, errorMsg)
				return
			}

			setIsProcessing(true)

			try {
				// Get code verifier from sessionStorage (set by parent window)
				const codeVerifier = sessionStorage.getItem(`discord_code_verifier_${state}`)

				if (!codeVerifier) {
					throw new Error('Code verifier not found - please try again')
				}

				const redirectUri = window.location.origin + '/discord/callback'
				console.log('Discord token exchange params:', {
					client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
					redirect_uri: redirectUri,
					has_code: !!code,
					has_code_verifier: !!codeVerifier,
				})

				// Exchange code for tokens client-side (avoids Cloudflare IP blocking)
				const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
					},
					body: new URLSearchParams({
						client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
						code,
						grant_type: 'authorization_code',
						redirect_uri: redirectUri,
						code_verifier: codeVerifier,
					}),
				})

				if (!tokenResponse.ok) {
					const errorText = await tokenResponse.text()
					console.error('Discord token exchange error:', {
						status: tokenResponse.status,
						statusText: tokenResponse.statusText,
						error: errorText,
					})
					throw new Error(`Token exchange failed (${tokenResponse.status}): ${errorText}`)
				}

				const tokens = (await tokenResponse.json()) as {
					access_token: string
					refresh_token: string
					expires_in: number
					scope: string
				}

				// Send tokens to backend for validation and storage
				await apiClient.post('/discord/callback/tokens', {
					accessToken: tokens.access_token,
					refreshToken: tokens.refresh_token,
					expiresIn: tokens.expires_in,
					scope: tokens.scope,
					state,
				})

				// Clean up code verifier
				sessionStorage.removeItem(`discord_code_verifier_${state}`)

				// Success!
				notifyParentAndClose(true)
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : 'Unknown error occurred'
				console.error('Discord callback error:', err)
				setError(errorMsg)
				notifyParentAndClose(false, errorMsg)
			}
		}

		function notifyParentAndClose(success: boolean, errorMessage?: string) {
			// Send message to parent window
			if (window.opener) {
				if (success) {
					window.opener.postMessage(
						{
							type: 'discord-oauth-success',
						},
						window.location.origin
					)
				} else {
					window.opener.postMessage(
						{
							type: 'discord-oauth-error',
							error: errorMessage || 'Unknown error',
						},
						window.location.origin
					)
				}
			}

			// Auto-close window after 2 seconds
			const timer = setTimeout(() => {
				setIsClosing(true)
				setTimeout(() => {
					window.close()
				}, 500)
			}, 2000)

			return () => clearTimeout(timer)
		}

		void handleCallback()
	}, [code, state, error])

	return (
		<div className="min-h-screen flex items-center justify-center p-4 bg-background">
			<Card variant="elevated" className="w-full max-w-md">
				<CardHeader>
					<div className="flex flex-col items-center gap-4">
						{error ? (
							<div className="flex items-center justify-center w-16 h-16 rounded-full bg-destructive/20">
								<XCircle className="h-10 w-10 text-destructive" />
							</div>
						) : isProcessing ? (
							<div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/20">
								<Loader2 className="h-10 w-10 text-primary animate-spin" />
							</div>
						) : (
							<div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20">
								<CheckCircle2 className="h-10 w-10 text-green-500" />
							</div>
						)}
						<div className="text-center">
							<CardTitle className="text-2xl mb-2">
								{error
									? 'Discord Linking Failed'
									: isProcessing
										? 'Linking Discord Account...'
										: 'Discord Linked Successfully'}
							</CardTitle>
							<CardDescription>
								{error
									? 'There was an error linking your Discord account.'
									: isProcessing
										? 'Please wait while we complete the linking process.'
										: isClosing
											? 'Closing window...'
											: 'You can close this window now.'}
							</CardDescription>
						</div>
					</div>
				</CardHeader>
				{error && (
					<CardContent>
						<div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
							<p className="text-sm text-destructive">Error: {error}</p>
						</div>
					</CardContent>
				)}
			</Card>
		</div>
	)
}
