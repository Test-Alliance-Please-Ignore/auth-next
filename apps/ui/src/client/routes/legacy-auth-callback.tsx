import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAuth } from '@/hooks/useAuth'

/**
 * Legacy Auth OAuth callback page
 * This page handles the OAuth redirect from the legacy auth server
 * The server processes the callback and redirects here with success/error
 */
export default function LegacyAuthCallbackPage() {
	usePageTitle('Linking Legacy Account')
	const [searchParams] = useSearchParams()
	const { refetch } = useAuth()
	const [isProcessing, setIsProcessing] = useState(true)
	const [error, setError] = useState<string | null>(searchParams.get('error'))
	const success = searchParams.get('success')
	const username = searchParams.get('username')

	useEffect(() => {
		async function handleCallback() {
			// If there's an error parameter, show it immediately
			if (error) {
				setIsProcessing(false)
				return
			}

			// If success, refresh user data and redirect
			if (success) {
				// Refresh user data to get updated legacy auth info
				await refetch()

				// Brief delay to show success message
				await new Promise((resolve) => setTimeout(resolve, 1500))

				// Redirect to dashboard
				window.location.href = '/dashboard'
			} else {
				// No success or error - something went wrong
				setError('Unknown error occurred')
				setIsProcessing(false)
			}
		}

		void handleCallback()
	}, [error, success, refetch])

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
									? 'Legacy Account Linking Failed'
									: isProcessing
										? 'Linking Legacy Account...'
										: 'Legacy Account Linked Successfully'}
							</CardTitle>
							<CardDescription>
								{error
									? 'There was an error linking your legacy account.'
									: isProcessing
										? 'Processing your account link...'
										: username
											? `Successfully linked to ${username}`
											: 'Redirecting you to dashboard...'}
							</CardDescription>
						</div>
					</div>
				</CardHeader>
				{error && (
					<CardContent>
						<div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 space-y-3">
							<p className="text-sm text-destructive">Error: {error}</p>
							<a
								href="/dashboard"
								className="inline-block text-sm text-primary hover:underline font-medium"
							>
								Return to Dashboard
							</a>
						</div>
					</CardContent>
				)}
			</Card>
		</div>
	)
}

