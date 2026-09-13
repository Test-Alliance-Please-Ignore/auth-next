import { MemberAvatar } from '@/components/member-avatar'
import { Badge } from '@/components/ui/badge'
import { TableCell, TableRow } from '@/components/ui/table'
import { formatDate, useAppTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

import type { ReactNode } from 'react'
import type { GroupMember, GroupWithDetails } from '@/lib/api'

interface MemberRowProps {
	member: GroupMember
	group: GroupWithDetails
	adminUserIds?: Set<string>
	currentUserId?: string
	/** Optional actions to display in the last column */
	actions?: ReactNode
}

/**
 * Reusable member row component for displaying group member information
 * Handles avatar, name, role badges, join date, and optional action buttons
 */
export function MemberRow({
	member,
	group,
	adminUserIds = new Set(),
	currentUserId,
	actions,
}: MemberRowProps) {
	const { t } = useAppTranslation()
	const isOwner = member.userId === group.ownerId
	const isAdmin = adminUserIds.has(member.userId)
	const isCurrentUser = currentUserId === member.userId

	return (
		<TableRow className={cn(isCurrentUser && 'bg-primary/5')}>
			{/* Avatar */}
			<TableCell className="py-2 px-2">
				<MemberAvatar
					characterId={member.mainCharacterId}
					characterName={member.mainCharacterName}
				/>
			</TableCell>

			{/* Member Name */}
			<TableCell className="font-medium">
				{member.mainCharacterName || t('groupDetail.unknownUser')}
			</TableCell>

			{/* Role Badges */}
			<TableCell>
				<div className="flex gap-2">
					{isOwner && <Badge>{t('groupDetail.roles.owner')}</Badge>}
					{isAdmin && !isOwner && <Badge variant="secondary">{t('groupDetail.roles.admin')}</Badge>}
					{!isOwner && !isAdmin && <Badge variant="ghost">{t('groupDetail.roles.member')}</Badge>}
				</div>
			</TableCell>

			{/* Join Date */}
			<TableCell className="text-sm text-muted-foreground">{formatDate(member.joinedAt)}</TableCell>

			{/* Actions (optional) */}
			{actions && <TableCell className="text-right">{actions}</TableCell>}
		</TableRow>
	)
}
