import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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
	const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
	const [userHashesByUserId, setUserHashesByUserId] = useState<Record<string, UserIpHistoryEntry[]>>({})
	const [loadingUserId, setLoadingUserId] = useState<string | null>(null)

	const onExpandUser = async (userId: string) => {
		if (expandedUserId === userId) {
			setExpandedUserId(null)
			return
		}
		setExpandedUserId(userId)
		if (userHashesByUserId[userId]) return
		setLoadingUserId(userId)
		try {
			const response = await loadUserHashes(userId)
			setUserHashesByUserId((prev) => ({ ...prev, [userId]: response.entries }))
		} finally {
			setLoadingUserId(null)
		}
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold">IP Hash Inspection</h1>
					<p className="font-mono text-xs text-muted-foreground break-all">{hash}</p>
				</div>
				<Button asChild variant="ghost">
					<Link to={backTo}>{backLabel}</Link>
				</Button>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Matched Users</CardTitle>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<p className="text-sm text-muted-foreground">Loading matches...</p>
					) : matches.length === 0 ? (
						<p className="text-sm text-muted-foreground">No users found for this hash.</p>
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
											{match.isAdmin && <Badge variant="secondary">Admin</Badge>}
											<span className="text-xs text-muted-foreground">{match.seenCount} sightings</span>
											<Button size="sm" variant="primary" onClick={() => void onExpandUser(match.userId)}>
												Show Other Hashes
											</Button>
										</div>
									</div>

									{expandedUserId === match.userId && (
										<div className="mt-2 space-y-1">
											{loadingUserId === match.userId ? (
												<p className="text-xs text-muted-foreground">Loading hashes...</p>
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
