import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { getThirdPartyAppScopeMetadata } from '@repo/admin'

import { MemberAvatar } from '@/components/member-avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingPage } from '@/components/ui/loading'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { apiClient } from '@/lib/api'

interface OAuthAuthorizePreview {
	requestUrl: string
	clientId: string
	clientName: string | null
	scope: string[]
	state: string | null
}

interface OAuthAuthorizeResolution {
	redirectTo: string
}

export default function OAuthAuthorizePage() {
	usePageTitle('Authorize Application')
	const location = useLocation()
	const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth()
	const [submittingAction, setSubmittingAction] = useState<'approve' | 'deny' | null>(null)
	const [error, setError] = useState<string | null>(null)

	const requestUrl = useMemo(() => {
		const origin = typeof window !== 'undefined' ? window.location.origin : ''
		return `${origin}${location.pathname}${location.search}${location.hash}`
	}, [location.hash, location.pathname, location.search])

	const [preview, setPreview] = useState<OAuthAuthorizePreview | null>(null)
	const [isPreviewLoading, setIsPreviewLoading] = useState(false)
	const requestedScopes = useMemo(
		() => preview?.scope.map((scope) => getThirdPartyAppScopeMetadata(scope)) ?? [],
		[preview?.scope]
	)

	useEffect(() => {
		if (!isAuthenticated) {
			setPreview(null)
			setIsPreviewLoading(false)
			return
		}

		let cancelled = false
		setIsPreviewLoading(true)
		setError(null)
		void apiClient
			.get<OAuthAuthorizePreview>(
				`/oauth/authorize?requestUrl=${encodeURIComponent(requestUrl)}`
			)
			.then((result) => {
				if (!cancelled) setPreview(result)
			})
			.catch((err) => {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : 'Unable to load authorization request.')
				}
			})
			.finally(() => {
				if (!cancelled) setIsPreviewLoading(false)
			})

		return () => {
			cancelled = true
		}
	}, [isAuthenticated, requestUrl])

	const handleAction = async (action: 'approve' | 'deny') => {
		setSubmittingAction(action)
		try {
			const result = await apiClient.post<OAuthAuthorizeResolution>('/oauth/authorize', {
				requestUrl,
				action,
			})
			window.location.assign(result.redirectTo)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Unable to complete authorization.')
		} finally {
			setSubmittingAction(null)
		}
	}

	const signedInName =
		user?.characters.find((character) => character.characterId === user.mainCharacterId)
			?.characterName ?? user?.id

	if (isAuthLoading) {
		return <LoadingPage label="Loading authorization..." />
	}

	if (!isAuthenticated) {
		const loginUrl = `/login?redirect=${encodeURIComponent(requestUrl)}`
		return (
			<div className="flex min-h-screen items-center justify-center bg-background p-4">
				<Card variant="elevated" className="w-full max-w-md">
					<CardHeader>
						<div className="flex flex-col items-center gap-4">
							<div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/20">
								<ShieldCheck className="h-10 w-10 text-primary" />
							</div>
							<div className="text-center">
								<CardTitle className="mb-2 text-2xl">Sign in required</CardTitle>
								<CardDescription>
									You need to sign in before authorizing this application.
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<Button asChild className="w-full">
							<a href={loginUrl}>Sign in with EVE</a>
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	if (isPreviewLoading) {
		return <LoadingPage label="Loading authorization request..." />
	}

	if (error || !preview) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background p-4">
				<Card variant="elevated" className="w-full max-w-md">
					<CardHeader>
						<div className="flex flex-col items-center gap-4">
							<div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/20">
								<XCircle className="h-10 w-10 text-destructive" />
							</div>
							<div className="text-center">
								<CardTitle className="mb-2 text-2xl">Authorization unavailable</CardTitle>
								<CardDescription>
									{error ?? 'We could not load the OAuth request details for this application.'}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<a href="/" className="text-sm font-medium text-primary hover:underline">
							Return to Home
						</a>
					</CardContent>
				</Card>
			</div>
		)
	}

	const { clientName, clientId, state } = preview

	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-4">
			<Card variant="elevated" className="w-full max-w-md">
				<CardHeader>
					<div className="flex flex-col items-center gap-4">
						<div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/20">
							<CheckCircle2 className="h-10 w-10 text-primary" />
						</div>
						<div className="text-center">
							<CardTitle className="mb-2 text-2xl">Authorize Application</CardTitle>
							<CardDescription>
								Allow this application to access your account and linked character data.
							</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent className="space-y-5">
					<div className="space-y-3 rounded-lg border border-border/60 bg-card/60 p-4">
						<div className="flex items-start justify-between gap-4">
							<span className="text-sm text-muted-foreground">Client</span>
							<span className="text-right text-sm font-medium text-foreground">
								{clientName ?? clientId}
							</span>
						</div>
						<div className="space-y-2">
							<div className="flex items-start justify-between gap-4">
								<span className="text-sm text-muted-foreground">Requested scopes</span>
								<span className="text-right text-sm font-medium text-foreground">
									{requestedScopes.length}
								</span>
							</div>
							<details className="group rounded-md bg-background/70 px-3 py-2">
								<summary className="cursor-pointer text-sm font-medium text-foreground">
									View requested access
								</summary>
								<ul className="mt-3 space-y-2">
									{requestedScopes.map((scopeInfo) => (
										<li key={scopeInfo.scope} className="rounded-md border border-border/60 px-3 py-2">
											<div className="text-sm font-medium text-foreground">{scopeInfo.name}</div>
											<p className="mt-1 text-xs leading-5 text-muted-foreground">
												{scopeInfo.description}
											</p>
											<p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
												{scopeInfo.scope}
											</p>
										</li>
									))}
								</ul>
							</details>
						</div>
						{state ? (
							<div className="flex items-start justify-between gap-4">
								<span className="text-sm text-muted-foreground">State</span>
								<span className="text-right font-mono text-xs text-muted-foreground">{state}</span>
							</div>
						) : null}
						<div className="flex items-center justify-between gap-4">
							<span className="text-sm text-muted-foreground">Signed in as</span>
							<div className="flex items-center gap-3 text-right">
								<span className="text-sm font-medium text-foreground">{signedInName}</span>
								<MemberAvatar
									characterId={user?.mainCharacterId}
									characterName={signedInName}
									size="sm"
									imageSize={64}
									className="rounded-full"
								/>
							</div>
						</div>
					</div>

					<div className="flex gap-3">
						<Button
							variant="secondary"
							className="flex-1"
							onClick={() => handleAction('deny')}
							disabled={submittingAction !== null}
						>
							{submittingAction === 'deny' ? 'Working...' : 'Deny'}
						</Button>
						<Button className="flex-1" onClick={() => handleAction('approve')} disabled={submittingAction !== null}>
							{submittingAction === 'approve' ? 'Working...' : 'Approve'}
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
