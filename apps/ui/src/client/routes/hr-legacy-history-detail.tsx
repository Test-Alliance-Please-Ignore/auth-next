import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'

import { MemberAvatar } from '@/components/member-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingPage } from '@/components/ui/loading'
import { useHrAccessibleCorporations } from '@/features/hr'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { api } from '@/lib/api'
import { corporationLogoUrl } from '@/lib/eve-images'
import { ArrowLeft } from 'lucide-react'

function formatLegacyEventType(eventType: string): string {
	return eventType
		.replace(/[_-]+/g, ' ')
		.trim()
		.replace(/\b\w/g, (char) => char.toUpperCase())
}

export default function HrLegacyHistoryDetailPage() {
	usePageTitle('HR - Legacy History Detail')
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { hasAnyPermission } = useUserPermissions()
	const isAuditor = hasAnyPermission('urn:hr:auditor')
	const canCheckAccessibleCorporations = isAuthenticated && !user?.is_admin && !isAuditor
	const {
		data: accessibleCorporations,
		isLoading: accessibleCorporationsLoading,
	} = useHrAccessibleCorporations({
		enabled: canCheckAccessibleCorporations,
	})
	const { legacyApplicationId } = useParams<{ legacyApplicationId: string }>()
	const [searchParams] = useSearchParams()
	const returnTo = searchParams.get('returnTo') || '/hr/legacy-history'
	const canAccessLegacyHistory =
		user?.is_admin === true ||
		isAuditor ||
		(accessibleCorporations?.some((corp) => corp.isMemberCorporation) ?? false)

	const detailQuery = useQuery({
		queryKey: ['hr', 'legacy-history-detail', legacyApplicationId],
		queryFn: () => api.getLegacyHistoryApplication(legacyApplicationId as string),
		enabled: Boolean(legacyApplicationId) && canAccessLegacyHistory,
	})

	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/dashboard" replace />
	}

	if (authLoading || accessibleCorporationsLoading) {
		return <LoadingPage label="Loading legacy history detail..." />
	}

	if (!canAccessLegacyHistory) {
		return <Navigate to="/dashboard" replace />
	}

	const selected = detailQuery.data?.application
	const events = detailQuery.data?.events ?? []
	const modernUserMatch = detailQuery.data?.modernUserMatch ?? null
	const actorMatches = detailQuery.data?.actorMatches ?? {}
	const actorLegacyCharacterNames = detailQuery.data?.actorLegacyCharacterNames ?? {}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between gap-3">
				<div>
					<h2 className="text-2xl font-semibold">Legacy Application Detail</h2>
					<p className="text-sm text-muted-foreground mt-1">Read-only legacy history and timeline.</p>
				</div>
				<Button asChild variant="ghost">
					<Link to={returnTo}>
						<ArrowLeft className="h-4 w-4" />
						Back to Search
					</Link>
				</Button>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Application</CardTitle>
					<CardDescription>{selected?.legacyApplicationId ?? legacyApplicationId ?? 'Unknown'}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{selected ? (
						<>
							<div className="text-sm space-y-1">
								<div className="flex items-start gap-3 rounded-md border p-3">
									<MemberAvatar
										characterId={selected.characterId ?? undefined}
										characterName={selected.characterName ?? undefined}
										size="lg"
										imageSize={128}
									/>
									<div className="min-w-0 flex-1 space-y-1">
										<div className="flex items-center gap-2">
											{modernUserMatch ? (
												<Link
													to={`/hr/users/${modernUserMatch.userId}`}
													className="truncate text-lg font-bold"
												>
													{selected.characterName ?? 'Unknown'}
												</Link>
											) : (
												<span className="truncate text-lg font-bold">
													{selected.characterName ?? 'Unknown'}
												</span>
											)}
											{modernUserMatch ? (
												<Badge variant="secondary">TANG User</Badge>
											) : (
												<Badge variant="warning">Legacy-only identity</Badge>
											)}
										</div>
										<div className="flex items-center gap-2">
											<span className="text-xs text-muted-foreground">Applied to:</span>
											{selected.corporationId ? (
												<img
													src={corporationLogoUrl(selected.corporationId, 32)}
													alt={`${selected.corporationName ?? 'Corporation'} logo`}
													className="size-5 rounded-sm border border-border/60 object-cover"
													loading="lazy"
												/>
											) : null}
											<span className="-ml-1 font-bold">
												{selected.corporationName ?? 'Unknown'}
											</span>
										</div>
										{!modernUserMatch ? (
											<div className="text-xs text-muted-foreground">
												Legacy User ID: <span className="font-mono">{selected.legacyAuthUserId ?? 'N/A'}</span>
											</div>
										) : null}
									</div>
								</div>
							</div>

							<div className="space-y-2">
								<div className="text-sm font-medium">Event Timeline (Read-only)</div>
								<div className="space-y-2">
									{events.map((event) => (
										<div key={event.id} className="rounded border p-2 bg-muted/20">
											<div className="flex items-center justify-between gap-2">
												<Badge variant="secondary">{formatLegacyEventType(event.eventType)}</Badge>
												<span className="text-xs text-muted-foreground">
													{event.eventAt ? new Date(event.eventAt).toLocaleString() : 'Unknown time'}
												</span>
											</div>
											{event.message ? (
												<p className="text-sm mt-1 whitespace-pre-wrap break-words">{event.message}</p>
											) : null}
											<div className="mt-1 text-xs text-muted-foreground">
												<span className="mr-2">Actor:</span>
												{event.legacyActorUserId && actorMatches[event.legacyActorUserId] ? (
													<>
														<Link
															to={`/hr/users/${actorMatches[event.legacyActorUserId].userId}`}
															className="font-semibold text-foreground underline underline-offset-2"
														>
															{actorMatches[event.legacyActorUserId].mainCharacterName ??
																actorMatches[event.legacyActorUserId].userId}
														</Link>
														<Badge variant="secondary" className="ml-2">
															TANG User
														</Badge>
													</>
												) : (
													<>
														<span className="font-semibold text-foreground">
															{event.legacyActorUserId
																? (actorLegacyCharacterNames[event.legacyActorUserId] ??
																	event.legacyActorUserId)
																: 'unknown'}
														</span>
														{event.legacyActorUserId ? (
															<Badge variant="warning" className="ml-2">
																Legacy User
															</Badge>
														) : null}
													</>
												)}
												{event.legacyActorUserId ? null : (
													<Badge variant="secondary" className="ml-2">
														Unmapped legacy actor
													</Badge>
												)}
											</div>
										</div>
									))}
									{events.length === 0 ? (
										<div className="text-sm text-muted-foreground">No legacy events.</div>
									) : null}
								</div>
							</div>
						</>
					) : (
						<div className="text-sm text-muted-foreground">
							{detailQuery.isLoading ? 'Loading...' : 'Legacy application not found.'}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
