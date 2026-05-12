import { formatDistanceToNow } from 'date-fns'
import { Link2, Loader2, Users } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import type { IpHashUserMatch, UserIpHistoryEntry } from '@/lib/api'

export function IpHistoryCard({
	title,
	entries,
	selectedHash,
	onSelectHash,
	matches,
	matchesLoading,
	buildUserLink,
	getUserIpHistory,
}: {
	title: string
	entries: UserIpHistoryEntry[]
	selectedHash: string | null
	onSelectHash: (ipHash: string) => void
	matches: IpHashUserMatch[]
	matchesLoading?: boolean
	buildUserLink: (userId: string) => string
	getUserIpHistory: (userId: string) => Promise<{ entries: UserIpHistoryEntry[] }>
}) {
	const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
	const [userHashesByUserId, setUserHashesByUserId] = useState<Record<string, UserIpHistoryEntry[]>>({})
	const [loadingUserHashesFor, setLoadingUserHashesFor] = useState<string | null>(null)

	const toggleUserHashes = async (userId: string) => {
		if (expandedUserId === userId) {
			setExpandedUserId(null)
			return
		}
		setExpandedUserId(userId)
		if (userHashesByUserId[userId]) return
		setLoadingUserHashesFor(userId)
		try {
			const result = await getUserIpHistory(userId)
			setUserHashesByUserId((prev) => ({ ...prev, [userId]: result.entries }))
		} finally {
			setLoadingUserHashesFor(null)
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-base">
					<Link2 className="h-4 w-4" />
					{title}
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				{entries.length === 0 ? (
					<p className="text-sm text-muted-foreground">No IP history found.</p>
				) : (
					<div className="space-y-2">
						{entries.map((entry) => (
							<div
								key={entry.ipAddressHash}
								className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
							>
								<div className="min-w-0">
									<p className="truncate font-mono text-xs">{entry.ipAddressHash}</p>
									<p className="text-xs text-muted-foreground">
										Seen {entry.seenCount} times · last{' '}
										{formatDistanceToNow(new Date(entry.lastSeenAt), { addSuffix: true })}
									</p>
									<p className="text-xs text-muted-foreground">
										{Math.max(0, entry.distinctUserCount - 1)} additional matches
									</p>
								</div>
								<Button
									variant={selectedHash === entry.ipAddressHash ? 'secondary' : 'ghost'}
									size="sm"
									onClick={() => onSelectHash(entry.ipAddressHash)}
								>
									<Users className="mr-1.5 h-3.5 w-3.5" />
									Matches
								</Button>
							</div>
						))}
					</div>
				)}
				{selectedHash && (
					<div className="space-y-2 rounded-md border p-3">
						<div className="flex items-center justify-between gap-2">
							<p className="truncate font-mono text-xs">{selectedHash}</p>
							<Badge variant="secondary">{matches.length} users</Badge>
						</div>
						{matchesLoading ? (
							<p className="text-sm text-muted-foreground">Loading matches...</p>
						) : matches.length === 0 ? (
							<p className="text-sm text-muted-foreground">No other user matches found.</p>
						) : (
							<div className="space-y-1.5">
								{matches.map((match) => (
									<div key={match.userId} className="rounded border p-2">
										<div className="flex items-center justify-between gap-2">
											<a
												href={buildUserLink(match.userId)}
												target="_blank"
												rel="noreferrer"
												className="min-w-0 truncate text-sm hover:underline"
											>
												{match.mainCharacterName ?? match.mainCharacterId}
												{match.isAdmin ? ' (Admin)' : ''}
											</a>
											<div className="flex items-center gap-2">
												<span className="text-xs text-muted-foreground">
													{match.seenCount} sightings
												</span>
												<Button
													size="sm"
													variant="ghost"
													onClick={() => void toggleUserHashes(match.userId)}
												>
													Other Hashes
												</Button>
											</div>
										</div>
										{expandedUserId === match.userId && (
											<div className="mt-2 space-y-1">
												{loadingUserHashesFor === match.userId ? (
													<p className="flex items-center gap-2 text-xs text-muted-foreground">
														<Loader2 className="h-3 w-3 animate-spin" />
														Loading hashes...
													</p>
												) : (
													(userHashesByUserId[match.userId] ?? [])
														.filter((entry) => entry.ipAddressHash !== selectedHash)
														.map((entry) => (
															<button
																key={entry.ipAddressHash}
																type="button"
																className="block w-full rounded px-2 py-1 text-left font-mono text-xs hover:bg-muted/50"
																onClick={() => onSelectHash(entry.ipAddressHash)}
															>
																{entry.ipAddressHash}
															</button>
														))
												)}
											</div>
										)}
									</div>
								))}
							</div>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	)
}
