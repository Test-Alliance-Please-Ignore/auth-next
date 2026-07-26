import { ExternalLink, Users } from 'lucide-react'
import { Link } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'
import { characterPortraitUrl } from '@/lib/eve-images'

type SearchResultUser = {
	id: string
	mainCharacterId: string
	mainCharacterName: string | null
	characterCount: number
	is_admin: boolean
	discordUserId: string | null
	discordUsername: string | null
	matchedCharacterId: string | null
	matchedCharacterName: string | null
	createdAt: string
	updatedAt: string
}

interface UserSearchResultsTableProps {
	users: SearchResultUser[]
	userDetailsPath: (userId: string) => string
	onRefreshDiscordAccess?: (userId: string) => void
	refreshingDiscordUserId?: string | null
}

export function UserSearchResultsTable({
	users,
	userDetailsPath,
	onRefreshDiscordAccess,
	refreshingDiscordUserId,
}: UserSearchResultsTableProps) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>User</TableHead>
					<TableHead>Characters</TableHead>
					<TableHead>Discord</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Last Updated</TableHead>
					<TableHead>Created</TableHead>
					<TableHead className="text-right">Actions</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{users.map((user) => {
					const portraitCharacterId = user.matchedCharacterId || user.mainCharacterId
					const isAltMatch =
						!!user.matchedCharacterId &&
						user.matchedCharacterId !== user.mainCharacterId &&
						!!user.matchedCharacterName
					const displayName = isAltMatch
						? `${user.matchedCharacterName}${user.mainCharacterName ? ` (${user.mainCharacterName})` : ''}`
						: user.mainCharacterName || user.matchedCharacterName || 'Unknown Character'

					return (
						<TableRow key={user.id}>
							<TableCell>
								<div className="flex items-center gap-3">
									<img
										src={characterPortraitUrl(portraitCharacterId, 64)}
										alt={displayName}
										className="h-10 w-10 rounded-full"
									/>
									<div>
										<Link
											to={userDetailsPath(user.id)}
											className="inline-flex items-center gap-2 font-medium hover:text-primary transition-colors"
										>
											{displayName}
											{isAltMatch && <Badge variant="default">Alt</Badge>}
										</Link>
										<div className="text-xs text-muted-foreground">ID: {user.id.slice(0, 8)}...</div>
									</div>
								</div>
							</TableCell>
							<TableCell>
								<div className="text-sm">
									{user.characterCount} character{user.characterCount !== 1 ? 's' : ''}
								</div>
							</TableCell>
							<TableCell>
								{user.discordUserId ? (
									<div className="flex items-center justify-between gap-2">
										<div className="min-w-0">
											<div className="text-sm font-medium truncate">
												{user.discordUsername || 'Discord Linked'}
											</div>
											<div className="font-mono text-xs text-muted-foreground truncate">
												{user.discordUserId}
											</div>
										</div>
										{onRefreshDiscordAccess && (
											<Button
												variant="ghost"
												size="sm"
												onClick={() => onRefreshDiscordAccess(user.id)}
												disabled={refreshingDiscordUserId === user.id}
												title="Refresh Discord roles"
											>
												<Users className="h-4 w-4" />
											</Button>
										)}
									</div>
								) : (
									<span className="text-sm text-muted-foreground">Not linked</span>
								)}
							</TableCell>
							<TableCell>
								{user.is_admin && <Badge variant="default">Admin</Badge>}
							</TableCell>
							<TableCell>
								<div className="text-sm" title={formatDateTime(user.updatedAt)}>
									{formatRelativeTime(user.updatedAt)}
								</div>
							</TableCell>
							<TableCell>
								<div className="text-sm" title={formatDateTime(user.createdAt)}>
									{formatRelativeTime(user.createdAt)}
								</div>
							</TableCell>
							<TableCell className="text-right">
								<Link to={userDetailsPath(user.id)}>
									<Button variant="ghost" size="sm">
										<ExternalLink className="h-4 w-4" />
									</Button>
								</Link>
							</TableCell>
						</TableRow>
					)
				})}
			</TableBody>
		</Table>
	)
}
