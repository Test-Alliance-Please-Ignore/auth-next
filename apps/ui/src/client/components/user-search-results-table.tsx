import { ExternalLink, Users } from 'lucide-react'
import { Link } from 'react-router'

import { MemberAvatar } from '@/components/member-avatar'
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
import { useAppTranslation } from '@/i18n'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

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
	mainCharacterIsBlacklisted?: boolean
	matchedCharacterIsBlacklisted?: boolean | null
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
	const { t } = useAppTranslation()

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>{t('hrpages.user')}</TableHead>
					<TableHead>{t('hrpages.characters')}</TableHead>
					<TableHead>Discord</TableHead>
					<TableHead>{t('hrpages.status')}</TableHead>
					<TableHead>{t('hr.searchLastUpdated')}</TableHead>
					<TableHead>{t('hrpages.created')}</TableHead>
					<TableHead className="text-right">{t('hrpages.actions')}</TableHead>
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
						: user.mainCharacterName || user.matchedCharacterName || t('hr.search.unknownCharacter')
					const isDisplayedCharacterBlacklisted = isAltMatch
						? user.matchedCharacterIsBlacklisted
						: user.mainCharacterIsBlacklisted

					return (
						<TableRow key={user.id}>
							<TableCell>
								<div className="flex items-center gap-3">
									<MemberAvatar
										characterId={portraitCharacterId}
										characterName={displayName}
										isBlacklisted={Boolean(isDisplayedCharacterBlacklisted)}
										size="auto"
										className="h-10 w-10 rounded-full"
									/>
									<div>
										<Link
											to={userDetailsPath(user.id)}
											className={cn(
												'inline-flex items-center gap-2 font-medium text-primary transition-colors hover:text-primary/80 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
												isDisplayedCharacterBlacklisted && 'text-red-500'
											)}
										>
											{displayName}
											{isAltMatch && <Badge variant="default">{t('hr.search.alt')}</Badge>}
											{isDisplayedCharacterBlacklisted && (
												<Badge variant="destructive">{t('hr.search.blocklisted')}</Badge>
											)}
										</Link>
										<div className="text-xs text-muted-foreground">
											{t('hrpages.idValue1', { value1: `${user.id.slice(0, 8)}...` })}
										</div>
									</div>
								</div>
							</TableCell>
							<TableCell>
								<div className="text-sm">
									{t('hr.search.character', { count: user.characterCount })}
								</div>
							</TableCell>
							<TableCell>
								{user.discordUserId ? (
									<div className="flex items-center justify-between gap-2">
										<div className="min-w-0">
											<div className="text-sm font-medium truncate">
												{user.discordUsername || t('hr.search.discordLinked')}
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
												title={t('hr.refreshDiscordRoles')}
												aria-label={t('hr.refreshDiscordRoles')}
											>
												<Users className="h-4 w-4" />
											</Button>
										)}
									</div>
								) : (
									<span className="text-sm text-muted-foreground">{t('hrpages.notLinked')}</span>
								)}
							</TableCell>
							<TableCell>
								{user.is_admin && <Badge variant="default">{t('hr.search.admin')}</Badge>}
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
									<Button variant="ghost" size="sm" aria-label={t('hr.viewUser')}>
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
