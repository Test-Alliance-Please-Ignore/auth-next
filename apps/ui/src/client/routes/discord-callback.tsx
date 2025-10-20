import { CheckCircle2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Discord OAuth callback page
 * This page is shown in the popup window after Discord OAuth completes
 * It sends a message to the parent window and auto-closes
 */
export default function DiscordCallbackPage() {
	const [searchParams] = useSearchParams()
	const [isClosing, setIsClosing] = useState(false)
	const error = searchParams.get('error')

	useEffect(() => {
		// Send message to parent window
		if (window.opener) {
			if (error) {
				window.opener.postMessage(
					{
						type: 'discord-oauth-error',
						error: error,
					},
					window.location.origin
				)
			} else {
				window.opener.postMessage(
					{
						type: 'discord-oauth-success',
					},
					window.location.origin
				)
			}
		}

		// Auto-close window after 2 seconds
		const timer = setTimeout(() => {
			setIsClosing(true)
			// Give the UI a moment to show "Closing..." before actually closing
			setTimeout(() => {
				window.close()
			}, 500)
		}, 2000)

		return () => clearTimeout(timer)
	}, [error])

	return (
		<div className="min-h-screen flex items-center justify-center p-4 bg-background">
			<Card className="w-full max-w-md card-gradient border-border/50 shadow-[0_8px_30px_rgb(0,0,0,0.4)]">
				<CardHeader>
					<div className="flex flex-col items-center gap-4">
						{error ? (
							<div className="flex items-center justify-center w-16 h-16 rounded-full bg-destructive/20">
								<XCircle className="h-10 w-10 text-destructive" />
							</div>
						) : (
							<div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20">
								<CheckCircle2 className="h-10 w-10 text-green-500" />
							</div>
						)}
						<div className="text-center">
							<CardTitle className="text-2xl mb-2">
								{error ? 'Discord Linking Failed' : 'Discord Linked Successfully'}
							</CardTitle>
							<CardDescription>
								{error
									? 'There was an error linking your Discord account.'
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
