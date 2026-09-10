import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router'

import { MemberAvatar } from '@/components/member-avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingPage } from '@/components/ui/loading'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { i18n, useAppTranslation } from '@/i18n'
import { apiClient } from '@/lib/api'

import type { AppTranslator } from '@/i18n'

interface OAuthAuthorizePreview {
	requestUrl: string
	clientId: string
	clientName: string | null
	scope: string[]
	state: string | null
	requiresFreshSession?: boolean
}

interface OAuthAuthorizeResolution {
	redirectTo: string
}

function getLocalizedScopeMetadata(scope: string, t: AppTranslator) {
	if (scope === 'profile') {
		return {
			scope,
			name: t('oauthAuthorize.identityScopes.profileName'),
			description: t('oauthAuthorize.identityScopes.profileDescription'),
		}
	}
	if (scope === 'groups') {
		return {
			scope,
			name: t('oauthAuthorize.identityScopes.groupsName'),
			description: t('oauthAuthorize.identityScopes.groupsDescription'),
		}
	}
	if (scope === 'permissions') {
		return {
			scope,
			name: t('oauthAuthorize.identityScopes.permissionsName'),
			description: t('oauthAuthorize.identityScopes.permissionsDescription'),
		}
	}
	if (scope.startsWith('esi:')) {
		return {
			scope,
			name: t('oauthAuthorize.esiScopeName'),
			description: t('oauthAuthorize.esiScopeDescription', { scope }),
		}
	}
	return {
		scope,
		name: scope,
		description: t('oauthAuthorize.unknownScopeDescription'),
	}
}

export default function OAuthAuthorizePage() {
	const { t } = useAppTranslation()
	usePageTitle(t('oauthAuthorize.title'))
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
		() => preview?.scope.map((scope) => getLocalizedScopeMetadata(scope, t)) ?? [],
		[preview?.scope, t]
	)
	const requiresFreshSession = preview?.requiresFreshSession ?? false
	const requiresFreshSessionError =
		error?.toLowerCase().includes('reauthentication required') ?? false
	const loginUrl = useMemo(() => {
		const params = new URLSearchParams({ redirect: requestUrl })
		if (requiresFreshSession || requiresFreshSessionError) {
			params.set('reauth', '1')
		}
		return `/login?${params.toString()}`
	}, [requestUrl, requiresFreshSession, requiresFreshSessionError])

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
			.get<OAuthAuthorizePreview>(`/oauth/authorize?requestUrl=${encodeURIComponent(requestUrl)}`)
			.then((result) => {
				if (!cancelled) setPreview(result)
			})
			.catch((err) => {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : i18n.t('oauthAuthorize.loadFallback'))
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
			setError(err instanceof Error ? err.message : t('oauthAuthorize.completeFallback'))
		} finally {
			setSubmittingAction(null)
		}
	}

	const signedInName =
		user?.characters.find((character) => character.characterId === user.mainCharacterId)
			?.characterName ?? user?.id

	if (isAuthLoading) {
		return <LoadingPage label={t('oauthAuthorize.loading')} />
	}

	if (!isAuthenticated) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background p-4">
				<Card variant="elevated" className="w-full max-w-md">
					<CardHeader>
						<div className="flex flex-col items-center gap-4">
							<div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/20">
								<ShieldCheck className="h-10 w-10 text-primary" />
							</div>
							<div className="text-center">
								<CardTitle className="mb-2 text-2xl">
									{t('oauthAuthorize.signInRequired')}
								</CardTitle>
								<CardDescription>{t('oauthAuthorize.signInDescription')}</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<Button asChild className="w-full">
							<a href={loginUrl}>{t('oauthAuthorize.signInWithEve')}</a>
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	if (isPreviewLoading) {
		return <LoadingPage label={t('oauthAuthorize.loadingRequest')} />
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
								<CardTitle className="mb-2 text-2xl">{t('oauthAuthorize.unavailable')}</CardTitle>
								<CardDescription>
									{error ?? t('oauthAuthorize.unavailableDescription')}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div className="flex flex-col gap-3">
							{requiresFreshSessionError ? (
								<>
									<Button asChild className="w-full">
										<a href={loginUrl}>{t('oauthAuthorize.signInAgain')}</a>
									</Button>
									<a
										href="/"
										className="text-center text-sm font-medium text-primary hover:underline"
									>
										{t('oauthAuthorize.returnHome')}
									</a>
								</>
							) : (
								<a href="/" className="text-sm font-medium text-primary hover:underline">
									{t('oauthAuthorize.returnHome')}
								</a>
							)}
						</div>
					</CardContent>
				</Card>
			</div>
		)
	}

	const { clientName, clientId } = preview

	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-4">
			<Card variant="elevated" className="w-full max-w-md">
				<CardHeader>
					<div className="flex flex-col items-center gap-4">
						<div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/20">
							<CheckCircle2 className="h-10 w-10 text-primary" />
						</div>
						<div className="text-center">
							<CardTitle className="mb-2 text-2xl">{t('oauthAuthorize.heading')}</CardTitle>
							<CardDescription>{t('oauthAuthorize.description')}</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent className="space-y-5">
					<div className="space-y-4 rounded-lg border border-border/60 bg-card/60 p-4">
						<div className="rounded-md border border-primary/20 bg-primary/10 px-4 py-4 text-center shadow-sm">
							<h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
								{clientName ?? clientId}
							</h2>
							<p className="mt-2 text-sm text-muted-foreground">{t('oauthAuthorize.review')}</p>
						</div>
						<details className="group overflow-hidden rounded-md border border-border/60 bg-background/70">
							<summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50">
								<span>{t('oauthAuthorize.requestedAccess')}</span>
								<span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
									{t('oauthAuthorize.scopes', { count: requestedScopes.length })}
								</span>
							</summary>
							<div className="border-t border-border/60">
								<Table>
									<TableHeader>
										<TableRow className="hover:bg-transparent">
											<TableHead className="h-9 px-3 text-[11px] uppercase tracking-wide">
												{t('oauthAuthorize.name')}
											</TableHead>
											<TableHead className="h-9 px-3 text-[11px] uppercase tracking-wide">
												{t('oauthAuthorize.scopeDescription')}
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{requestedScopes.map((scopeInfo) => (
											<TableRow key={scopeInfo.scope} className="align-top">
												<TableCell className="px-3 py-2 align-top text-sm font-medium text-foreground">
													{scopeInfo.name}
												</TableCell>
												<TableCell className="px-3 py-2 align-top text-xs leading-5 text-muted-foreground">
													{scopeInfo.description}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						</details>
						<div className="flex items-center justify-between gap-4">
							<span className="text-sm text-muted-foreground">
								{t('oauthAuthorize.signedInAs')}
							</span>
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
							{submittingAction === 'deny' ? t('oauthAuthorize.working') : t('oauthAuthorize.deny')}
						</Button>
						<Button
							className="flex-1"
							onClick={() => handleAction('approve')}
							disabled={submittingAction !== null || requiresFreshSession}
						>
							{submittingAction === 'approve'
								? t('oauthAuthorize.working')
								: t('oauthAuthorize.approve')}
						</Button>
					</div>
					{requiresFreshSession ? (
						<div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
							<p className="font-medium text-foreground">
								{t('oauthAuthorize.reauthenticationRequired')}
							</p>
							<p className="mt-1 text-muted-foreground">
								{t('oauthAuthorize.reauthenticationDescription')}
							</p>
							<Button asChild className="mt-3 w-full">
								<a href={loginUrl}>{t('oauthAuthorize.signInAgain')}</a>
							</Button>
						</div>
					) : null}
				</CardContent>
			</Card>
		</div>
	)
}
