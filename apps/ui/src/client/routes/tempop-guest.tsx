import { useQuery } from '@tanstack/react-query'
import { LogIn, Mic } from 'lucide-react'
import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { OneTimeCredentialsCard } from '@/features/mumble/components/credentials-card'
import { usePageTitle } from '@/hooks/usePageTitle'
import { apiClient } from '@/lib/api'
import toast from '@/lib/toast'

const ERROR_MESSAGES: Record<string, string> = {
	sso: 'EVE login failed. Please try again.',
	expired: 'This temp-op link has expired.',
	blacklisted: 'This character is not permitted to join this voice server.',
	provision: 'Could not create your voice account. Please try again.',
	invalid: 'This link is invalid.',
}

function MessageCard({ title, message }: { title: string; message: string }) {
	return (
		<Card variant="default" className="border-destructive/50">
			<CardHeader>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent className="text-sm text-muted-foreground">{message}</CardContent>
		</Card>
	)
}

export default function TempopGuestPage() {
	usePageTitle('Join voice')
	const { key = '' } = useParams<{ key: string }>()
	const [searchParams] = useSearchParams()
	const provisioned = searchParams.get('provisioned') === '1'
	const handoff = searchParams.get('h')
	const errorCode = searchParams.get('error')
	const [starting, setStarting] = useState(false)

	const infoQuery = useQuery({
		queryKey: ['tempop-info', key],
		queryFn: () => apiClient.getTempopInfo(key),
		enabled: key.length > 0 && !provisioned,
		retry: false,
	})

	// One-time handoff exchange — single use. The handoff is consumed server-side
	// on first fetch, and we drop the result from cache as soon as the page
	// unmounts (gcTime: 0) so the password can't be re-shown on back-navigation
	// or remount; a remount re-fetches and the now-consumed handoff returns 404.
	// We never refetch within the same view, so the credentials stay visible
	// while the page is open.
	const credentialsQuery = useQuery({
		queryKey: ['tempop-credentials', key, handoff],
		queryFn: () => apiClient.getTempopCredentials(key, handoff ?? ''),
		enabled: provisioned && !!handoff,
		retry: false,
		gcTime: 0,
		refetchOnWindowFocus: false,
		refetchOnMount: false,
	})

	const handleIdentify = async () => {
		setStarting(true)
		try {
			const { authorizationUrl } = await apiClient.startTempopSso(key)
			window.location.href = authorizationUrl
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to start EVE login')
			setStarting(false)
		}
	}

	let content: React.ReactNode
	if (errorCode) {
		content = (
			<MessageCard
				title="Unable to join"
				message={ERROR_MESSAGES[errorCode] ?? 'Something went wrong. Please try again.'}
			/>
		)
	} else if (provisioned) {
		if (credentialsQuery.isLoading) {
			content = <p className="text-muted-foreground">Preparing your credentials…</p>
		} else if (credentialsQuery.data) {
			content = <OneTimeCredentialsCard credentials={credentialsQuery.data} />
		} else {
			content = (
				<MessageCard
					title="Credentials unavailable"
					message="Your one-time credentials have expired. Open the temp-op link again to retry."
				/>
			)
		}
	} else if (infoQuery.isLoading) {
		content = <p className="text-muted-foreground">Loading…</p>
	} else if (infoQuery.error || !infoQuery.data?.valid) {
		content = (
			<MessageCard
				title={infoQuery.data?.expired ? 'Link expired' : 'Invalid link'}
				message={
					infoQuery.data?.expired
						? 'This temp-op link has expired.'
						: 'This temp-op link is invalid or no longer available.'
				}
			/>
		)
	} else {
		content = (
			<Card variant="default">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Mic className="h-5 w-5" />
						Join voice
					</CardTitle>
					<CardDescription>
						Sign in with EVE to receive a temporary Mumble account for this operation. We only read
						your character name and affiliation for display — no other access is requested.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button onClick={handleIdentify} disabled={starting} className="gap-2">
						<LogIn className="h-4 w-4" />
						{starting ? 'Redirecting…' : 'Identify with EVE'}
					</Button>
				</CardContent>
			</Card>
		)
	}

	return (
		<Container>
			<PageHeader title="Mumble temp-op" description="Temporary voice access" />
			<div className="mt-4 max-w-xl space-y-4">{content}</div>
		</Container>
	)
}
