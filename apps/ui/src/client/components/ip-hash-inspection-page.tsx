import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppTranslation } from '@/i18n'

import type { IpHashUserMatch, UserIpHistoryEntry } from '@/lib/api'

export function IpHashInspectionPage({
	hash,
	matches,
	isLoading,
	backTo,
	backLabel,
	buildUserLink,
	loadUserHashes,
	buildHashLink,
}: {
	hash: string
	matches: IpHashUserMatch[]
	isLoading: boolean
	backTo: string
	backLabel: string
	buildUserLink: (userId: string) => string
	loadUserHashes: (userId: string) => Promise<{ entries: UserIpHistoryEntry[] }>
	buildHashLink: (ipHash: string) => string
}) {
	const { t } = useAppTranslation()
	const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
	const [userHashesByUserId, setUserHashesByUserId] = useState<
		Record<string, UserIpHistoryEntry[]>
	>({})
	const [loadErrors, setLoadErrors] = useState<Record<string, string | true>>({})
	const [loadingUserId, setLoadingUserId] = useState<string | null>(null)

	const onExpandUser = async (userId: string) => {
		if (expandedUserId === userId) {
			setExpandedUserId(null)
			return
		}
		setExpandedUserId(userId)
		if (userHashesByUserId[userId]) return
		setLoadingUserId(userId)
		setLoadErrors((previous) => {
			const { [userId]: _error, ...remaining } = previous
			return remaining
		})
		try {
			const response = await loadUserHashes(userId)
			setUserHashesByUserId((prev) => ({ ...prev, [userId]: response.entries }))
		} catch (error) {
			setLoadErrors((previous) => ({
				...previous,
				[userId]: error instanceof Error ? error.message : true,
			}))
		} finally {
			setLoadingUserId((current) => (current === userId ? null : current))
		}
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold">{t('admin.users.ip.inspection')}</h1>
					<p className="font-mono text-xs text-muted-foreground break-all">{hash}</p>
				</div>
				<Button asChild variant="ghost">
					<Link to={backTo}>{backLabel}</Link>
				</Button>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{t('admin.users.ip.matchedUsers')}</CardTitle>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<p className="text-sm text-muted-foreground">{t('admin.users.ip.loadingMatches')}</p>
					) : matches.length === 0 ? (
						<p className="text-sm text-muted-foreground">{t('admin.users.ip.noMatches')}</p>
					) : (
						<div className="space-y-2">
							{matches.map((match) => (
								<div key={match.userId} className="rounded border p-3">
									<div className="flex items-center justify-between gap-2">
										<div className="flex min-w-0 items-center gap-2">
											<AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
											<Link
												to={buildUserLink(match.userId)}
												target="_blank"
												rel="noreferrer"
												className="truncate text-sm font-semibold text-destructive hover:underline"
											>
												{match.mainCharacterName ?? match.mainCharacterId}
											</Link>
										</div>
										<div className="flex items-center gap-2">
											{match.isAdmin && <Badge variant="secondary">{t('admin.shell.admin')}</Badge>}
											<span className="text-xs text-muted-foreground">
												{t('admin.users.ip.sightings', { count: match.seenCount })}
											</span>
											<Button
												size="sm"
												variant="primary"
												onClick={() => void onExpandUser(match.userId)}
											>
												{t('admin.users.ip.otherHashes')}
											</Button>
										</div>
									</div>

									{expandedUserId === match.userId && (
										<div className="mt-2 space-y-1">
											{loadingUserId === match.userId ? (
												<p className="text-xs text-muted-foreground">
													{t('admin.users.ip.loadingHashes')}
												</p>
											) : loadErrors[match.userId] ? (
												<p role="alert" className="text-xs text-destructive">
													{typeof loadErrors[match.userId] === 'string'
														? loadErrors[match.userId]
														: t('admin.users.ip.loadError')}
												</p>
											) : (
												(userHashesByUserId[match.userId] ?? [])
													.filter((entry) => entry.ipAddressHash !== hash)
													.map((entry) => (
														<Link
															key={entry.ipAddressHash}
															to={buildHashLink(entry.ipAddressHash)}
															className="block rounded px-2 py-1 font-mono text-xs hover:bg-muted/50"
														>
															{entry.ipAddressHash}
														</Link>
													))
											)}
										</div>
									)}
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
