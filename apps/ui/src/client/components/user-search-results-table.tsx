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
					<TableHead>{t('admin.users.account.user')}</TableHead>
					<TableHead>{t('admin.users.account.characters')}</TableHead>
					<TableHead>{t('admin.nav.discord')}</TableHead>
					<TableHead>{t('admin.users.account.status')}</TableHead>
					<TableHead>{t('admin.users.account.lastUpdated')}</TableHead>
					<TableHead>{t('admin.users.account.created')}</TableHead>
					<TableHead className="text-right">{t('admin.fields.actions')}</TableHead>
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
						: user.mainCharacterName ||
							user.matchedCharacterName ||
							t('admin.users.account.unknownCharacter')
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
												'inline-flex items-center gap-2 font-medium hover:text-primary transition-colors',
												isDisplayedCharacterBlacklisted && 'text-red-500'
											)}
										>
											{displayName}
											{isAltMatch && (
												<Badge variant="default">{t('common.characterIdentity.alt')}</Badge>
											)}
											{isDisplayedCharacterBlacklisted && (
												<Badge variant="destructive">{t('admin.users.account.blocklisted')}</Badge>
											)}
										</Link>
										<div className="text-xs text-muted-foreground">
											{t('admin.users.account.shortId', { id: user.id.slice(0, 8) })}
										</div>
									</div>
								</div>
							</TableCell>
							<TableCell>
								<div className="text-sm">
									{t('admin.users.account.characterCount', { count: user.characterCount })}
								</div>
							</TableCell>
							<TableCell>
								{user.discordUserId ? (
									<div className="flex items-center justify-between gap-2">
										<div className="min-w-0">
											<div className="text-sm font-medium truncate">
												{user.discordUsername || t('admin.users.discord.linked')}
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
												title={t('admin.users.discord.refreshRoles')}
											>
												<Users className="h-4 w-4" />
											</Button>
										)}
									</div>
								) : (
									<span className="text-sm text-muted-foreground">
										{t('admin.users.discord.notLinked')}
									</span>
								)}
							</TableCell>
							<TableCell>
								{user.is_admin && <Badge variant="default">{t('admin.shell.admin')}</Badge>}
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
									<Button
										variant="ghost"
										size="sm"
										aria-label={t('admin.users.account.viewDetails')}
									>
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
